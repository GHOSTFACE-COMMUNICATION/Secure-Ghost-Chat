import { Router, type IRouter, type Request, type Response } from "express";
import { db, prekeysTable, identityKeysTable, deviceTokensTable, pool } from "@workspace/db";
import { eq, and, count as drizzleCount } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { normalizeAlias } from "../utils/alias";
import { toErrorMessage } from "../utils/error";
import { ensureDeliveryId, generateDeliveryId } from "../utils/delivery";

const router: IRouter = Router();

const OPK_LOW_WATERMARK = 3;

// ── Simple in-memory rate limiter for /register ───────────────────────────────
// Limits registration attempts per IP to 5 per 15 minutes to reduce pre-registration attacks.
// SECURITY NOTE: This app uses alias-based identity (no password/JWT).  An adversary who
// pre-registers a target alias before the real user can substitute their own IK/SPK.
// Mitigations:
//   1. First-writer wins (409 on duplicate userId).
//   2. IP-rate-limiting reduces automated pre-registration.
//   3. Users should verify safety numbers out-of-band (Signal's TOFU model).
const REGISTER_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const REGISTER_RATE_LIMIT_MAX = 5;
const registrationAttempts = new Map<string, { count: number; resetAt: number }>();

function checkRegisterRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = registrationAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    registrationAttempts.set(ip, { count: 1, resetAt: now + REGISTER_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= REGISTER_RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Validate a hex string with an exact expected length in chars. */
function isValidHex(k: unknown, chars: number): k is string {
  return typeof k === "string" && k.length === chars && /^[0-9a-f]+$/i.test(k);
}

/** Validate a 64-char hex string (32-byte X25519 or Ed25519 public key). */
function isValidPubKey(k: unknown): k is string {
  return isValidHex(k, 64);
}

/** Validate a 128-char hex string (64-byte Ed25519 signature). */
function isValidSignature(k: unknown): k is string {
  return isValidHex(k, 128);
}

/** Validate a 2368-char hex string (1184-byte ML-KEM-768 public key). */
function isValidPqkemPubKey(k: unknown): k is string {
  return isValidHex(k, 2368);
}

/**
 * Middleware: verify the Bearer token in the Authorization header matches the
 * stored device token for the userId in the path parameter.
 *
 * Attach as route-level middleware on all mutating prekey operations.
 */
async function requireDeviceAuth(req: Request, res: Response, next: () => void): Promise<void> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (!token) {
    res.status(401).json({ error: "Authorization: Bearer <token> header required" });
    return;
  }

  const userId = req.params["userId"] as string;
  const hash = hashToken(token);

  const [row] = await db
    .select()
    .from(deviceTokensTable)
    .where(and(eq(deviceTokensTable.userId, userId), eq(deviceTokensTable.tokenHash, hash)));

  if (!row) {
    res.status(403).json({ error: "Invalid or mismatched device token for userId" });
    return;
  }

  next();
}

// ── POST /api/prekeys/register — register a device (get a token + store IK/SPK) ──
//
// Called once on first use. Generates and returns a device token that must be
// passed as Bearer on all subsequent mutating requests for this userId.
// If the userId is already registered, returns 409 Conflict (idempotent-safe).
router.post("/prekeys/register", async (req: Request, res: Response) => {
  try {
    // Rate-limit registrations per IP to mitigate pre-registration alias squatting
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      "unknown";
    if (!checkRegisterRateLimit(ip)) {
      return res.status(429).json({ error: "Too many registration attempts. Try again later." });
    }

    const {
      userId,
      ikPublicKey,
      spkPublicKey,
      ikSignPublicKey,
      spkSignature,
      pqkemPublicKey,
      pqkemSignature,
    } = req.body as {
      userId?: string;
      ikPublicKey?: string;
      spkPublicKey?: string;
      ikSignPublicKey?: string;
      spkSignature?: string;
      pqkemPublicKey?: string;
      pqkemSignature?: string;
    };

    if (!userId || typeof userId !== "string" || userId.length > 128) {
      return res.status(400).json({ error: "userId required (max 128 chars)" });
    }
    if (!isValidPubKey(ikPublicKey)) {
      return res.status(400).json({ error: "ikPublicKey must be a 64-char hex string" });
    }
    if (!isValidPubKey(spkPublicKey)) {
      return res.status(400).json({ error: "spkPublicKey must be a 64-char hex string" });
    }
    if (ikSignPublicKey !== undefined && !isValidPubKey(ikSignPublicKey)) {
      return res
        .status(400)
        .json({ error: "ikSignPublicKey must be a 64-char hex string (Ed25519 pub key)" });
    }
    if (spkSignature !== undefined && !isValidSignature(spkSignature)) {
      return res
        .status(400)
        .json({ error: "spkSignature must be a 128-char hex string (Ed25519 signature)" });
    }
    if (pqkemPublicKey !== undefined && !isValidPqkemPubKey(pqkemPublicKey)) {
      return res
        .status(400)
        .json({ error: "pqkemPublicKey must be a 2368-char hex string (ML-KEM-768 pub key)" });
    }
    if (pqkemSignature !== undefined && !isValidSignature(pqkemSignature)) {
      return res
        .status(400)
        .json({ error: "pqkemSignature must be a 128-char hex string (Ed25519 signature)" });
    }

    // Normalize and validate alias format
    const normalizedUserId = normalizeAlias(userId);
    if (!normalizedUserId || normalizedUserId.length < 3) {
      return res.status(400).json({ error: "userId must be at least 3 valid characters" });
    }

    // Check for existing registration
    const [existing] = await db
      .select()
      .from(deviceTokensTable)
      .where(eq(deviceTokensTable.userId, normalizedUserId));

    // First-writer-wins: an existing registration for this alias is refused
    // outright, with no reissue path. The previous "demo recovery" upsert
    // here let ANY caller reissue keys for ANY already-registered alias with
    // zero proof of prior ownership — i.e. anyone could silently hijack an
    // existing identity by re-POSTing its alias. registerWithServer() on the
    // client already treats a non-2xx response as "registration didn't
    // happen" and gives up quietly (see AppContext.tsx), so a device that
    // truly lost its SecureStore (token + private keys) has no way to prove
    // it was the prior owner and correctly cannot reclaim the alias — that's
    // the same TOFU tradeoff Signal makes, not a regression. Recovery in
    // that case means picking a new alias; existing peers see it as a
    // safety-number change, not a silent takeover.
    if (existing) {
      return res.status(409).json({ error: "Alias already registered" });
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const deliveryId = generateDeliveryId();
    await db.transaction(async (tx) => {
      await tx.insert(deviceTokensTable).values({ userId: normalizedUserId, tokenHash });
      await tx.insert(identityKeysTable).values({
        userId: normalizedUserId,
        deliveryId,
        ikPublicKey,
        spkPublicKey,
        ikSignPublicKey: ikSignPublicKey ?? null,
        spkSignature: spkSignature ?? null,
        pqkemPublicKey: pqkemPublicKey ?? null,
        pqkemSignature: pqkemSignature ?? null,
      });
    });

    // Return the plain-text token — client must store this securely
    return res.status(201).json({ token, userId: normalizedUserId, deliveryId });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── PUT /api/prekeys/:userId/rekey — rotate identity keys for existing user ────
// Used when a client loses its local private keys (e.g. SecureStore cleared)
// but still holds a valid device token. Replaces IK/SPK in identity_keys so
// the client can resume real X3DH sessions. All existing open sessions with
// this user will be invalidated on the receiver side (they'll see a new X3DH
// header on the next message and rebuild their Bob session).
// Requires: Authorization: Bearer <device-token>
router.put(
  "/prekeys/:userId/rekey",
  (req, res, next) => requireDeviceAuth(req, res, next),
  async (req: Request, res: Response) => {
    try {
      const userId = req.params["userId"] as string;
      const {
        ikPublicKey,
        spkPublicKey,
        ikSignPublicKey,
        spkSignature,
        pqkemPublicKey,
        pqkemSignature,
      } = req.body as {
        ikPublicKey?: string;
        spkPublicKey?: string;
        ikSignPublicKey?: string;
        spkSignature?: string;
        pqkemPublicKey?: string;
        pqkemSignature?: string;
      };

      if (!isValidPubKey(ikPublicKey)) {
        return res.status(400).json({ error: "ikPublicKey must be a 64-char hex string" });
      }
      if (!isValidPubKey(spkPublicKey)) {
        return res.status(400).json({ error: "spkPublicKey must be a 64-char hex string" });
      }
      if (ikSignPublicKey !== undefined && !isValidPubKey(ikSignPublicKey)) {
        return res.status(400).json({ error: "ikSignPublicKey must be a 64-char hex string" });
      }
      if (spkSignature !== undefined && !isValidSignature(spkSignature)) {
        return res.status(400).json({ error: "spkSignature must be a 128-char hex string" });
      }
      if (pqkemPublicKey !== undefined && !isValidPqkemPubKey(pqkemPublicKey)) {
        return res.status(400).json({ error: "pqkemPublicKey must be a 2368-char hex string" });
      }
      if (pqkemSignature !== undefined && !isValidSignature(pqkemSignature)) {
        return res.status(400).json({ error: "pqkemSignature must be a 128-char hex string" });
      }

      await db
        .update(identityKeysTable)
        .set({
          ikPublicKey,
          spkPublicKey,
          ikSignPublicKey: ikSignPublicKey ?? null,
          spkSignature: spkSignature ?? null,
          pqkemPublicKey: pqkemPublicKey ?? null,
          pqkemSignature: pqkemSignature ?? null,
        })
        .where(eq(identityKeysTable.userId, userId));

      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: toErrorMessage(err) });
    }
  },
);

// ── POST /api/prekeys/:userId — upload a batch of one-time prekeys ────────────
// Requires: Authorization: Bearer <device-token>
router.post(
  "/prekeys/:userId",
  (req, res, next) => requireDeviceAuth(req, res, next),
  async (req: Request, res: Response) => {
    try {
      const userId = req.params["userId"] as string;
      const { keys } = req.body as { keys?: string[] };

      if (!Array.isArray(keys) || keys.length === 0) {
        return res.status(400).json({ error: "keys must be a non-empty array of hex strings" });
      }
      if (keys.length > 100) {
        return res.status(400).json({ error: "Cannot upload more than 100 keys at once" });
      }

      const invalid = keys.find((k) => !isValidPubKey(k));
      if (invalid !== undefined) {
        return res.status(400).json({ error: "Each key must be a 64-char hex string (32 bytes)" });
      }

      const rows = keys.map((publicKey) => ({ userId, publicKey }));
      await db.insert(prekeysTable).values(rows);

      const [{ value: remaining }] = await db
        .select({ value: drizzleCount() })
        .from(prekeysTable)
        .where(and(eq(prekeysTable.userId, userId), eq(prekeysTable.consumed, false)));

      return res.status(201).json({ uploaded: keys.length, remaining: Number(remaining) });
    } catch (err) {
      return res.status(500).json({ error: toErrorMessage(err) });
    }
  },
);

// ── GET /api/prekeys/:userId/bundle — fetch a full prekey bundle ──────────────
//
// Returns a complete X3DH prekey bundle for initiating a session with userId:
//   { ikPublicKey, spkPublicKey, opk: string | null, remaining, lowSupply }
//
// OPK is atomically consumed via PostgreSQL UPDATE...RETURNING with a subquery
// and SKIP LOCKED to ensure exactly-once delivery under concurrent requests.
// Falls back to { opk: null } (3-DH) if no OPKs remain.
//
// This endpoint is intentionally readable without auth (Alice needs Bob's keys).
router.get("/prekeys/:userId/bundle", async (req: Request, res: Response) => {
  try {
    const userId = req.params["userId"] as string;

    // Fetch user's identity key bundle (IK + SPK)
    const [identityKey] = await db
      .select()
      .from(identityKeysTable)
      .where(eq(identityKeysTable.userId, userId));

    if (!identityKey) {
      return res.status(404).json({ error: "User not registered or no identity keys found" });
    }

    // Opaque routing token Alice will address her messages to (instead of Bob's
    // alias). Backfill lazily for rows that predate task #128.
    const deliveryId = identityKey.deliveryId ?? (await ensureDeliveryId(userId));

    // Atomic: pick the lowest-id unconsumed OPK and mark it consumed in one statement.
    // SKIP LOCKED ensures concurrent requests don't race on the same row.
    const result = await pool.query<{ public_key: string }>(
      `UPDATE prekeys
         SET consumed = true
       WHERE id = (
         SELECT id FROM prekeys
          WHERE user_id = $1 AND consumed = false
          ORDER BY id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       RETURNING public_key`,
      [userId],
    );

    const opk = result.rowCount === 1 ? result.rows[0].public_key : null;

    const [{ value: remaining }] = await db
      .select({ value: drizzleCount() })
      .from(prekeysTable)
      .where(and(eq(prekeysTable.userId, userId), eq(prekeysTable.consumed, false)));

    const remainingNum = Number(remaining);
    return res.json({
      deliveryId,
      ikPublicKey: identityKey.ikPublicKey,
      spkPublicKey: identityKey.spkPublicKey,
      ikSignPublicKey: identityKey.ikSignPublicKey ?? undefined,
      spkSignature: identityKey.spkSignature ?? undefined,
      pqkemPublicKey: identityKey.pqkemPublicKey ?? undefined,
      pqkemSignature: identityKey.pqkemSignature ?? undefined,
      opk,
      remaining: remainingNum,
      lowSupply: remainingNum < OPK_LOW_WATERMARK,
    });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── GET /api/prekeys/:userId/count — check remaining OPK count ────────────────
// Requires: Authorization: Bearer <device-token>
router.get(
  "/prekeys/:userId/count",
  (req, res, next) => requireDeviceAuth(req, res, next),
  async (req: Request, res: Response) => {
    try {
      const userId = req.params["userId"] as string;

      const [{ value: remaining }] = await db
        .select({ value: drizzleCount() })
        .from(prekeysTable)
        .where(and(eq(prekeysTable.userId, userId), eq(prekeysTable.consumed, false)));

      const remainingNum = Number(remaining);
      return res.json({ remaining: remainingNum, lowSupply: remainingNum < OPK_LOW_WATERMARK });
    } catch (err) {
      return res.status(500).json({ error: toErrorMessage(err) });
    }
  },
);

export default router;
