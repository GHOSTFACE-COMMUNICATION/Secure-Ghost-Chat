import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  ghostNumbersTable,
  ghostSmsTable,
  numberLeasesTable,
  deadEndRepliesTable,
} from "@workspace/db";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { getAuthedAlias } from "../lib/auth";
import { vonageClient } from "../lib/vonage";
import { RateLimiter, getIpKey } from "../lib/rateLimiter";
import { broadcastToAlias } from "../ws/manager";
import { logger } from "../lib/logger";
import { toErrorMessage } from "../utils/error";

const router: IRouter = Router();

// 3 lease acquisitions per hour per alias — a lease consumes pool inventory.
const provisionLimiter = new RateLimiter({ windowMs: 60 * 60_000, max: 3, prefix: "provision" });

// 30 SMS inbox fetches per minute per alias
const smsInboxLimiter = new RateLimiter({ windowMs: 60_000, max: 30, prefix: "smsInbox" });

// Failed-auth gate, per IP. A coarse per-IP request ceiling sized to survive
// carrier NAT would have to be so high it protects nothing, so only requests
// that FAIL authentication charge this bucket: legitimate NATed users never
// touch it, while an unauthenticated flood is cut off before the device-token
// lookup. The quotas above are charged to the authenticated alias instead.
const authFailureGate = new RateLimiter({ windowMs: 60_000, max: 30, prefix: "authFail" });

// GF-20: ghost_numbers is POOL INVENTORY owned by GHOSTFACE as sole subscriber,
// and number_leases binds one pool number to one external counterparty for one
// owner. Numbers are never assigned to users. Tables are provisioned through the
// Drizzle schema (lib/db/src/schema/ghostNumbers.ts); the destructive step is
// written out explicitly at lib/db/migrations/0001_gf20_number_leases.sql.

const COUNTRY_NAMES: Record<string, string> = {
  NZ: "New Zealand",
  AU: "Australia",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  DE: "Germany",
};

/**
 * Sent once, ever, to a counterparty who texts a pool number with no active
 * lease for them. Deliberately says nothing about who the number belongs to,
 * whether it was ever in use, or that GHOSTFACE exists as a product — a
 * dead-end reply that leaked "this number belongs to someone" would be worse
 * than silence.
 */
const DEAD_END_REPLY = "This number is not accepting messages.";

/** Max leases per alias. Pool-side ceiling, not a billing tier. */
const MAX_ACTIVE_LEASES = 5;

// GET /api/numbers — list the caller's ACTIVE leases (not numbers they own;
// nobody owns a number). Joined to the pool row so the client can show the
// number the counterparty sees.
router.get("/numbers", async (req: Request, res: Response) => {
  try {
    const alias = await getAuthedAlias(req, "query");
    if (!alias) return res.status(401).json({ error: "Unauthorized" });

    const leases = await db
      .select({
        id: numberLeasesTable.id,
        externalNumber: numberLeasesTable.externalNumber,
        createdAt: numberLeasesTable.createdAt,
        expiresAt: numberLeasesTable.expiresAt,
        poolNumberId: ghostNumbersTable.id,
        phoneNumber: ghostNumbersTable.phoneNumber,
        msisdn: ghostNumbersTable.msisdn,
        country: ghostNumbersTable.country,
        capabilities: ghostNumbersTable.capabilities,
      })
      .from(numberLeasesTable)
      .innerJoin(ghostNumbersTable, eq(numberLeasesTable.poolNumberId, ghostNumbersTable.id))
      .where(and(eq(numberLeasesTable.ownerAlias, alias), isNull(numberLeasesTable.releasedAt)))
      .orderBy(desc(numberLeasesTable.createdAt));

    return res.json({ data: leases });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// GET /api/numbers/leases/:id/sms — inbox for one lease (one conversation)
router.get("/numbers/leases/:id/sms", async (req: Request, res: Response) => {
  const ipKey = getIpKey(req);
  if (!(await authFailureGate.allowed(ipKey))) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const alias = await getAuthedAlias(req, "query");
    if (!alias) {
      await authFailureGate.record(ipKey);
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!(await smsInboxLimiter.check(alias))) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const leaseId = Number(req.params.id);
    if (!Number.isInteger(leaseId)) return res.status(400).json({ error: "Invalid lease" });

    // Ownership is checked on the lease, not the number — the same pool number
    // serves other people's conversations and must never leak across leases.
    const [lease] = await db
      .select()
      .from(numberLeasesTable)
      .where(and(eq(numberLeasesTable.id, leaseId), eq(numberLeasesTable.ownerAlias, alias)));
    if (!lease) return res.status(404).json({ error: "Lease not found" });

    const sms = await db
      .select()
      .from(ghostSmsTable)
      .where(eq(ghostSmsTable.leaseId, leaseId))
      .orderBy(desc(ghostSmsTable.createdAt));

    return res.json({ data: sms });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// POST /api/numbers/lease — acquire a lease for one counterparty.
// Replaces the old per-user /numbers/provision: no carrier call happens here,
// because GHOSTFACE already holds the inventory as sole subscriber.
router.post("/numbers/lease", async (req: Request, res: Response) => {
  const ipKey = getIpKey(req);
  if (!(await authFailureGate.allowed(ipKey))) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const alias = await getAuthedAlias(req, "query");
    if (!alias) {
      await authFailureGate.record(ipKey);
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!(await provisionLimiter.check(alias))) {
      return res.status(429).json({ error: "Too many requests. Leases are limited to 3 per hour." });
    }

    const { country = "NZ", externalNumber } = req.body ?? {};
    if (typeof externalNumber !== "string" || !/^\+?[1-9]\d{6,14}$/.test(externalNumber)) {
      return res.status(400).json({ error: "A valid E.164 external number is required" });
    }
    if (!COUNTRY_NAMES[country]) {
      return res.status(400).json({ error: "Unsupported country" });
    }

    const active = await db
      .select({ id: numberLeasesTable.id })
      .from(numberLeasesTable)
      .where(and(eq(numberLeasesTable.ownerAlias, alias), isNull(numberLeasesTable.releasedAt)));
    if (active.length >= MAX_ACTIVE_LEASES) {
      return res
        .status(400)
        .json({ error: `Lease limit reached (${MAX_ACTIVE_LEASES}). Release one first.` });
    }

    // Pick free inventory and bind it in one statement. The partial unique index
    // on (pool_number_id, external_number) WHERE released_at IS NULL is what
    // makes a concurrent duplicate impossible rather than merely unlikely.
    const [lease] = await db
      .insert(numberLeasesTable)
      .values({
        poolNumberId: sql`(
          SELECT id FROM ghost_numbers
          WHERE status = 'available' AND country = ${country}
          ORDER BY id
          LIMIT 1
        )`,
        externalNumber,
        ownerAlias: alias,
      })
      .onConflictDoNothing()
      .returning();

    if (!lease) {
      // Either the pair is already leased, or the pool is dry. Distinguish them
      // so "no inventory" is not reported as a client error.
      const [existing] = await db
        .select()
        .from(numberLeasesTable)
        .where(
          and(
            eq(numberLeasesTable.externalNumber, externalNumber),
            eq(numberLeasesTable.ownerAlias, alias),
            isNull(numberLeasesTable.releasedAt),
          ),
        );
      if (existing) return res.status(200).json({ data: existing });
      logger.warn({ country }, "lease acquisition found no available pool number");
      return res.status(503).json({ error: "No numbers available. Try again shortly." });
    }

    await db
      .update(ghostNumbersTable)
      .set({ status: "leased" })
      .where(eq(ghostNumbersTable.id, lease.poolNumberId));

    return res.status(201).json({ data: lease });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// DELETE /api/numbers/leases/:id — release a lease back to the pool.
// No carrier release: the number stays ours, which is exactly what removes the
// 90-day ageing problem that made per-user rotation unaffordable (GF-20).
router.delete("/numbers/leases/:id", async (req: Request, res: Response) => {
  try {
    const alias = await getAuthedAlias(req, "query");
    if (!alias) return res.status(401).json({ error: "Unauthorized" });

    const leaseId = Number(req.params.id);
    if (!Number.isInteger(leaseId)) return res.status(400).json({ error: "Invalid lease" });

    const [lease] = await db
      .select()
      .from(numberLeasesTable)
      .where(
        and(
          eq(numberLeasesTable.id, leaseId),
          eq(numberLeasesTable.ownerAlias, alias),
          isNull(numberLeasesTable.releasedAt),
        ),
      );
    if (!lease) return res.status(404).json({ error: "Lease not found" });

    await db
      .update(numberLeasesTable)
      .set({ releasedAt: new Date() })
      .where(eq(numberLeasesTable.id, leaseId));

    // Only free the pool number if no other live lease still uses it.
    const remaining = await db
      .select({ id: numberLeasesTable.id })
      .from(numberLeasesTable)
      .where(
        and(
          eq(numberLeasesTable.poolNumberId, lease.poolNumberId),
          isNull(numberLeasesTable.releasedAt),
        ),
      );
    if (remaining.length === 0) {
      await db
        .update(ghostNumbersTable)
        .set({ status: "available" })
        .where(eq(ghostNumbersTable.id, lease.poolNumberId));
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

/**
 * Inbound SMS routing, GF-20.
 *
 * Routing key is the PAIR (to, from), not `to` alone: one pool number serves
 * many counterparties at once, so `to` by itself identifies nothing.
 *
 * Unknown inbound — a pair with no active lease — is DROPPED. Not stored, not
 * routed, never auto-leased, never held. Auto-leasing would let any stranger
 * consume inventory and bind themselves to a user; holding would accumulate
 * unattributable message content, which is precisely what this product exists
 * not to do. The sender gets exactly one dead-end reply so the number is not a
 * silent black hole, and nothing after that.
 */
export async function handleInboundSms(body: Record<string, unknown>): Promise<void> {
  const from = typeof body.msisdn === "string" ? body.msisdn : "";
  const to = typeof body.to === "string" ? body.to : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!to || !from) return;

  const [poolNumber] = await db
    .select()
    .from(ghostNumbersTable)
    .where(eq(ghostNumbersTable.msisdn, to));

  // Not our number at all. Drop silently and send nothing — replying "from" a
  // number we do not hold would be sending on someone else's behalf.
  if (!poolNumber) {
    logger.warn({ to }, "inbound SMS for an MSISDN not in the pool");
    return;
  }

  const [lease] = await db
    .select()
    .from(numberLeasesTable)
    .where(
      and(
        eq(numberLeasesTable.poolNumberId, poolNumber.id),
        eq(numberLeasesTable.externalNumber, from),
        isNull(numberLeasesTable.releasedAt),
      ),
    );

  if (lease) {
    await db.insert(ghostSmsTable).values({
      numberId: String(poolNumber.id),
      leaseId: lease.id,
      toUserId: lease.ownerAlias,
      fromNumber: from,
      toNumber: to,
      body: text,
      direction: "inbound",
      providerMetadata: body,
    });

    await broadcastToAlias(lease.ownerAlias, {
      type: "sms_inbound",
      from,
      to,
      text,
    });
    return;
  }

  // ---- DROP path. No storage, no routing, no lease. ----
  // Exactly-once is enforced by the primary key, not by a prior SELECT: the
  // reply is sent only if THIS insert created the row, so two concurrent
  // messages from the same pair can only ever produce one reply.
  const claimed = await db
    .insert(deadEndRepliesTable)
    .values({ poolMsisdn: to, externalNumber: from })
    .onConflictDoNothing()
    .returning();

  if (claimed.length === 0) {
    logger.info({ to, from }, "unknown inbound dropped; dead-end reply already sent");
    return;
  }

  try {
    await vonageClient.sendSms(to, from, DEAD_END_REPLY);
    logger.info({ to, from }, "unknown inbound dropped; dead-end reply sent");
  } catch (err) {
    // The ledger row stays. A failed courtesy reply is not worth retrying into
    // an unbounded send loop against a sender we have no relationship with.
    logger.warn({ to, from, err: toErrorMessage(err) }, "dead-end reply failed to send");
  }
}

// POST /api/webhooks/sms/inbound — Vonage inbound SMS webhook
router.post("/webhooks/sms/inbound", async (req: Request, res: Response) => {
  try {
    await handleInboundSms((req.body ?? {}) as Record<string, unknown>);
  } catch (err) {
    // Always 200. A non-2xx makes Vonage retry the delivery, which would
    // re-run this handler and, on the drop path, is exactly how a courtesy
    // reply turns into a loop.
    logger.error({ err: toErrorMessage(err) }, "inbound SMS handling failed");
  }
  return res.json({ ok: true });
});

// GET /api/numbers/plans — pricing info
// ⚠️ GF-20: these prices are still the per-user model's. Under pool leases the
// cost basis is pool utilisation, not per-user MRC, so they need re-deriving
// once the Vonage escalation reply and the Plivo rate card land. VOICE is
// advertised here and is NOT implemented — no voice routing exists.
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
    ],
  });
});

export default router;
