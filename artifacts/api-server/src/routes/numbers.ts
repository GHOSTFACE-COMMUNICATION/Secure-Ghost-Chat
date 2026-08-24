import { Router, type IRouter, type Request, type Response } from "express";
import { db, ghostNumbersTable, ghostSmsTable, deviceTokensTable } from "@workspace/db";
import { eq, and, desc, or, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { vonageClient } from "../lib/vonage";
import { pool } from "@workspace/db";
import { RateLimiter, getIpKey } from "../lib/rateLimiter";
import { normalizeAlias } from "../utils/alias";
import { broadcastToAlias } from "../ws/manager";
import { logger } from "../lib/logger";
import { toErrorMessage } from "../utils/error";
import { performRotation, MS_PER_DAY } from "../lib/rotationScheduler";

const router: IRouter = Router();

// 3 number provisions per hour per IP — prevents abuse of paid Vonage API
const provisionLimiter = new RateLimiter({ windowMs: 60 * 60_000, max: 3 });

// 30 SMS inbox fetches per minute per IP
const smsInboxLimiter = new RateLimiter({ windowMs: 60_000, max: 30 });

// Failed-auth gate, per IP. A coarse per-IP request ceiling sized to survive
// carrier NAT would have to be so high it protects nothing, so only requests
// that FAIL authentication charge this bucket: legitimate NATed users never
// touch it, while an unauthenticated flood is cut off before the device-token
// lookup. The quotas above are charged to the authenticated alias instead.
const authFailureGate = new RateLimiter({ windowMs: 60_000, max: 30 });


// The ghost_numbers, ghost_sms and user_rotation_limits tables are provisioned
// through the standard Drizzle schema (lib/db/src/schema/ghostNumbers.ts) and
// applied via `pnpm --filter db push` (see scripts/post-merge.sh) — the single
// source of truth for the database schema.

const ALLOWED_ROTATION_DAYS = new Set([0, 7, 30, 90]);

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

const COUNTRY_NAMES: Record<string, string> = {
  NZ: "New Zealand",
  AU: "Australia",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  DE: "Germany",
};

const PLAN_PRICES: Record<string, number> = {
  basic: 4.99,
  private: 9.99,
  phantom: 19.99,
};

// GET /api/numbers — list user's ghost numbers
router.get("/numbers", async (req: Request, res: Response) => {
  try {
    const alias = await getAuthedAlias(req);
    if (!alias) return res.status(401).json({ error: "Unauthorized" });

    const numbers = await db
      .select()
      .from(ghostNumbersTable)
      .where(and(eq(ghostNumbersTable.userId, alias), eq(ghostNumbersTable.status, "active")))
      .orderBy(desc(ghostNumbersTable.createdAt));

    return res.json({ data: numbers });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// GET /api/numbers/:id/sms — inbox for a ghost number
router.get("/numbers/:id/sms", async (req: Request, res: Response) => {
  const ipKey = getIpKey(req);
  if (!authFailureGate.allowed(ipKey)) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const alias = await getAuthedAlias(req);
    if (!alias) {
      authFailureGate.record(ipKey);
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!smsInboxLimiter.check(alias)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const numberId = req.params.id as string;
    const [number] = await db
      .select()
      .from(ghostNumbersTable)
      .where(and(eq(ghostNumbersTable.id, Number(numberId)), eq(ghostNumbersTable.userId, alias)));
    if (!number) return res.status(404).json({ error: "Number not found" });

    const sms = await db
      .select()
      .from(ghostSmsTable)
      .where(eq(ghostSmsTable.numberId, numberId))
      .orderBy(desc(ghostSmsTable.createdAt));

    return res.json({ data: sms });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// POST /api/numbers/provision — rent a ghost number
router.post("/numbers/provision", async (req: Request, res: Response) => {
  const ipKey = getIpKey(req);
  if (!authFailureGate.allowed(ipKey)) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const alias = await getAuthedAlias(req);
    if (!alias) {
      authFailureGate.record(ipKey);
      return res.status(401).json({ error: "Unauthorized" });
    }
    // Per alias, not per IP: this one spends real money on Vonage, and an IP
    // key meant every subscriber behind a carrier NAT shared one 3/hour budget.
    if (!provisionLimiter.check(alias)) {
      return res
        .status(429)
        .json({ error: "Too many requests. Ghost number provisioning is limited to 3 per hour." });
    }

    const { country = "NZ", plan = "basic" } = req.body;

    if (!PLAN_PRICES[plan]) {
      return res.status(400).json({ error: "Invalid plan. Choose: basic, private, phantom" });
    }

    const existing = await db
      .select()
      .from(ghostNumbersTable)
      .where(and(eq(ghostNumbersTable.userId, alias), eq(ghostNumbersTable.status, "active")));

    const maxNumbers = plan === "phantom" ? 2 : 1;
    if (existing.length >= maxNumbers) {
      return res.status(400).json({
        error: `Your ${plan} plan allows ${maxNumbers} ghost number(s). Release one first.`,
      });
    }

    let phoneNumber: string;
    let msisdn: string;

    if (!vonageClient.configured()) {
      // Demo mode — generate a realistic-looking ghost number
      const areaCode =
        country === "NZ"
          ? "+64"
          : country === "AU"
            ? "+61"
            : country === "US"
              ? "+1"
              : country === "GB"
                ? "+44"
                : "+1";
      const suffix = Math.floor(Math.random() * 9000000) + 1000000;
      phoneNumber = `${areaCode} ${suffix}`;
      msisdn = `${suffix}`;
    } else {
      const available = await vonageClient.searchNumbers(country);
      if (!available.length) {
        return res
          .status(404)
          .json({ error: `No numbers available in ${COUNTRY_NAMES[country] ?? country}` });
      }
      const chosen = available[0];
      await vonageClient.rentNumber(country, chosen.msisdn);
      phoneNumber = `+${chosen.msisdn}`;
      msisdn = chosen.msisdn;
    }

    const capabilities = plan === "basic" ? ["SMS"] : ["SMS", "VOICE"];

    const [number] = await db
      .insert(ghostNumbersTable)
      .values({
        userId: alias,
        provider: vonageClient.configured() ? "vonage" : "demo",
        phoneNumber,
        country,
        capabilities,
        status: "active",
        plan,
        msisdn,
      })
      .returning();

    return res.status(201).json({ data: number });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// DELETE /api/numbers/:id — release a ghost number
router.delete("/numbers/:id", async (req: Request, res: Response) => {
  try {
    const alias = await getAuthedAlias(req);
    if (!alias) return res.status(401).json({ error: "Unauthorized" });

    const numberId = Number(req.params.id);
    const [number] = await db
      .select()
      .from(ghostNumbersTable)
      .where(and(eq(ghostNumbersTable.id, numberId), eq(ghostNumbersTable.userId, alias)));

    if (!number) return res.status(404).json({ error: "Number not found" });

    if (vonageClient.configured()) {
      try {
        await vonageClient.releaseNumber(number.country, number.msisdn);
      } catch {
        // Continue even if Vonage release fails — still mark inactive locally
      }
    }

    await db
      .update(ghostNumbersTable)
      .set({ status: "released" })
      .where(eq(ghostNumbersTable.id, numberId));

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// PATCH /api/numbers/:id/rotation — set or clear auto-rotation schedule
router.patch("/numbers/:id/rotation", async (req: Request, res: Response) => {
  try {
    const alias = await getAuthedAlias(req);
    if (!alias) return res.status(401).json({ error: "Unauthorized" });

    const numberId = Number(req.params.id);
    if (!Number.isInteger(numberId) || numberId <= 0) {
      return res.status(400).json({ error: "Invalid number id" });
    }

    const rotateEveryDays = Number(req.body?.rotateEveryDays);
    if (!ALLOWED_ROTATION_DAYS.has(rotateEveryDays)) {
      return res.status(400).json({ error: "rotateEveryDays must be one of: 0, 7, 30, 90" });
    }

    const [number] = await db
      .select()
      .from(ghostNumbersTable)
      .where(
        and(
          eq(ghostNumbersTable.id, numberId),
          eq(ghostNumbersTable.userId, alias),
          eq(ghostNumbersTable.status, "active"),
        ),
      );
    if (!number) return res.status(404).json({ error: "Number not found" });

    const nextRotationAt =
      rotateEveryDays === 0 ? null : new Date(Date.now() + rotateEveryDays * MS_PER_DAY);

    const [updated] = await db
      .update(ghostNumbersTable)
      .set({
        rotateEveryDays: rotateEveryDays === 0 ? null : rotateEveryDays,
        nextRotationAt,
      })
      .where(eq(ghostNumbersTable.id, numberId))
      .returning();

    return res.json({ data: updated });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// POST /api/numbers/:id/rotate-now — immediately rotate a ghost number
// Rate limit: 1 per USER per 24 hours (enforced atomically via user_rotation_limits table).
router.post("/numbers/:id/rotate-now", async (req: Request, res: Response) => {
  try {
    const alias = await getAuthedAlias(req);
    if (!alias) return res.status(401).json({ error: "Unauthorized" });

    const numberId = Number(req.params.id);
    if (!Number.isInteger(numberId) || numberId <= 0) {
      return res.status(400).json({ error: "Invalid number id" });
    }

    const [number] = await db
      .select()
      .from(ghostNumbersTable)
      .where(
        and(
          eq(ghostNumbersTable.id, numberId),
          eq(ghostNumbersTable.userId, alias),
          eq(ghostNumbersTable.status, "active"),
        ),
      );
    if (!number) return res.status(404).json({ error: "Number not found" });

    // Atomically claim the per-user rate-limit slot.
    // The conditional DO UPDATE only fires when the existing row is older than 24 hours,
    // so two concurrent requests cannot both succeed — only the first UPSERT wins.
    const claimResult = await pool.query<{ last_rotate_at: Date }>(
      `INSERT INTO user_rotation_limits (user_id, last_rotate_at)
       VALUES ($1, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET last_rotate_at = NOW()
         WHERE user_rotation_limits.last_rotate_at < NOW() - INTERVAL '24 hours'
       RETURNING last_rotate_at`,
      [alias],
    );

    if ((claimResult.rowCount ?? 0) === 0) {
      // Slot is taken — fetch the existing timestamp to compute nextAllowedAt
      const limRow = await pool.query<{ last_rotate_at: Date }>(
        "SELECT last_rotate_at FROM user_rotation_limits WHERE user_id = $1",
        [alias],
      );
      const nextAllowedAt = new Date(
        (limRow.rows[0]?.last_rotate_at.getTime() ?? Date.now()) + MS_PER_DAY,
      );
      return res.status(429).json({
        error: "You can only rotate a number once every 24 hours.",
        nextAllowedAt: nextAllowedAt.toISOString(),
      });
    }

    // Perform the actual rotation — if it fails, release the slot so the user
    // can retry immediately rather than being locked out for 24 hours.
    try {
      await performRotation(number, { resetCountdown: true });
    } catch (rotateErr) {
      await pool.query("DELETE FROM user_rotation_limits WHERE user_id = $1", [alias]);
      throw rotateErr;
    }

    // Re-fetch and return the updated number
    const [updated] = await db
      .select()
      .from(ghostNumbersTable)
      .where(eq(ghostNumbersTable.id, numberId));

    logger.info({ numberId, alias }, "[rotate-now] On-demand rotation complete");
    return res.json({ data: updated });
  } catch (err) {
    logger.error({ err }, "[rotate-now] Failed");
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// POST /api/webhooks/sms/inbound — Vonage inbound SMS webhook
router.post("/webhooks/sms/inbound", async (req: Request, res: Response) => {
  try {
    const { msisdn: from, to, text } = req.body;
    if (!to || !from) return res.json({ ok: true });

    // Match against current MSISDN OR any archived MSISDN — covers in-flight SMS
    // sent to a recently-rotated number.
    const [number] = await db
      .select()
      .from(ghostNumbersTable)
      .where(
        and(
          eq(ghostNumbersTable.status, "active"),
          or(
            eq(ghostNumbersTable.msisdn, to),
            sql`${ghostNumbersTable.archivedMsisdns} @> ${JSON.stringify([to])}::jsonb`,
          ),
        ),
      );

    if (number) {
      await db.insert(ghostSmsTable).values({
        numberId: String(number.id),
        toUserId: number.userId,
        fromNumber: from,
        toNumber: to,
        body: text ?? "",
        direction: "inbound",
        providerMetadata: req.body,
      });

      // Push real-time notification to the alias owner if they are online
      broadcastToAlias(number.userId, {
        type: "sms_inbound",
        from,
        to,
        text: text ?? "",
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// GET /api/numbers/plans — pricing info
router.get("/numbers/plans", (_req: Request, res: Response) => {
  res.json({
    data: [
      {
        id: "basic",
        name: "BASIC",
        priceNzd: 4.99,
        numbers: 1,
        capabilities: ["SMS"],
        countries: ["NZ", "AU", "US", "GB", "CA"],
        description: "One ghost number, SMS only",
      },
      {
        id: "private",
        name: "PRIVATE",
        priceNzd: 9.99,
        numbers: 1,
        capabilities: ["SMS", "VOICE"],
        countries: ["NZ", "AU", "US", "GB", "CA", "DE"],
        description: "One ghost number, SMS + voice calls",
      },
      {
        id: "phantom",
        name: "PHANTOM",
        priceNzd: 19.99,
        numbers: 2,
        capabilities: ["SMS", "VOICE"],
        countries: ["NZ", "AU", "US", "GB", "CA", "DE"],
        description: "Two ghost numbers, SMS + voice, priority routing",
      },
    ],
  });
});

export default router;
