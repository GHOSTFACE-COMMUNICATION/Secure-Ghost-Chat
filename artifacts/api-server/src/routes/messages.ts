import { Router, type IRouter, type Request, type Response } from "express";
import { db, messagesTable, identityKeysTable, deviceTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createHash } from "crypto";
import { RateLimiter, GlobalLimiter, getIpKey } from "../lib/rateLimiter";
import { normalizeAlias } from "../utils/alias";
import { toErrorMessage } from "../utils/error";
import { markMessagesDelivered } from "../utils/markDelivered";
import { ensureDeliveryId } from "../utils/delivery";

const router: IRouter = Router();

// 120 message-pending polls per minute PER ALIAS (2/sec — ample for normal use).
// Keyed per user, not per IP: mobile carrier NAT puts thousands of subscribers
// behind one address, and our own VPN egresses them all from a single endpoint,
// so an IP key would have real users sharing one person's budget.
const pendingPollLimiter = new RateLimiter({ windowMs: 60_000, max: 120 });

// Failed-auth gate, per IP. Deliberately NOT a general request gate: a coarse
// per-IP ceiling sized to survive carrier NAT would have to be so high it
// protects nothing. Only requests that fail authentication charge this bucket,
// so legitimate NATed users never touch it, while an unauthenticated flood is
// cut off before it reaches the device-token lookup below.
const authFailureGate = new RateLimiter({ windowMs: 60_000, max: 30 });

// 60 user-exists lookups per minute per IP (prevents alias enumeration).
// This endpoint is unauthenticated by nature — it IS the enumeration surface,
// so there is no alias to key on and it has to stay IP-keyed. Raised from 60 so
// a carrier NAT of real users does not trip it, with a global cap below to
// bound total enumeration regardless of how many addresses it comes from.
const userExistsLimiter = new RateLimiter({ windowMs: 60_000, max: 600 });
const userExistsGlobal = new GlobalLimiter({ windowMs: 60_000, max: 6_000 });

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function getAuthedAlias(req: Request): Promise<string | null> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const alias = req.query.alias as string | undefined;
  if (!alias) return null;
  const normalizedAlias = normalizeAlias(alias);
  if (!normalizedAlias) return null;
  const hash = hashToken(token);
  const [row] = await db
    .select()
    .from(deviceTokensTable)
    .where(
      and(
        eq(deviceTokensTable.userId, normalizedAlias),
        eq(deviceTokensTable.tokenHash, hash),
      ),
    );
  return row ? normalizedAlias : null;
}

router.get("/users/exists/:alias", async (req: Request, res: Response) => {
  if (!userExistsLimiter.check(getIpKey(req)) || !userExistsGlobal.check()) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const alias = normalizeAlias(req.params.alias as string);
    if (!alias) {
      return res.status(400).json({ error: "userId must be 3-20 characters: A-Z, 0-9, underscore only" });
    }
    const [row] = await db
      .select({ userId: identityKeysTable.userId, ikPublicKey: identityKeysTable.ikPublicKey })
      .from(identityKeysTable)
      .where(eq(identityKeysTable.userId, alias));

    if (row) {
      // Also hand back the opaque delivery token so a peer that already has a
      // session (e.g. a recipient replying) can address messages without
      // consuming one of the user's one-time prekeys via the bundle endpoint.
      // `ikPublicKey` lets a recipient bind a sealed-sender message's claimed
      // alias to its registered identity key (anti-spoofing) — it's public key
      // material, already exposed via the bundle, so this leaks nothing new.
      const deliveryId = await ensureDeliveryId(row.userId);
      return res.json({
        exists: true,
        alias: row.userId,
        deliveryId,
        ikPublicKey: row.ikPublicKey,
      });
    }
    return res.status(404).json({ exists: false });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

router.get("/messages/pending", async (req: Request, res: Response) => {
  const ipKey = getIpKey(req);
  // Gate on prior auth failures from this address before touching the DB.
  if (!authFailureGate.allowed(ipKey)) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const alias = await getAuthedAlias(req);
    if (!alias) {
      authFailureGate.record(ipKey);
      return res.status(401).json({ error: "Authorization required. Pass alias as query param." });
    }
    // Real quota, charged to the authenticated user rather than their address.
    if (!pendingPollLimiter.check(alias)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    // Messages are addressed to the opaque delivery token, never the alias.
    const deliveryId = await ensureDeliveryId(alias);
    if (!deliveryId) {
      return res.json({ messages: [] });
    }

    const pending = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.toDeliveryId, deliveryId), eq(messagesTable.delivered, false)));

    await markMessagesDelivered(pending.map((m) => m.id));

    return res.json({ messages: pending });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

export default router;
