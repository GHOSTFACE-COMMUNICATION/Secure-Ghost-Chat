import { Router, type IRouter, type Request, type Response } from "express";
import { getAuthedAlias } from "../lib/auth";
import { Keypair, PublicKey } from "@solana/web3.js";
import { validateTransfer } from "@solana/pay";
import BigNumber from "bignumber.js";
import { eq, and } from "drizzle-orm";
import { db, ghostPaymentsTable, ghostEntitlementsTable } from "@workspace/db";
import { RateLimiter, getIpKey } from "../lib/rateLimiter";
import { logger } from "../lib/logger";
import { toErrorMessage } from "../utils/error";
import {
  PLAN_PRICES,
  USDC_MINT,
  INTENT_TTL_MS,
  TERM_DAYS,
  isPlan,
  getReceivingWallet,
  isWalletConfigured,
  getConnection,
  buildSolanaPayUrl,
  computeActiveUntil,
} from "../lib/solanaPayments";

const router: IRouter = Router();

// 10 payment intents per 10 minutes per IP.
const intentLimiter = new RateLimiter({ windowMs: 10 * 60_000, max: 10, prefix: "intent" });
// 60 status polls per minute per IP (client polls every few seconds).
const statusLimiter = new RateLimiter({ windowMs: 60_000, max: 60, prefix: "status" });

// Failed-auth gate, per IP. A coarse per-IP request ceiling sized to survive
// carrier NAT would have to be so high it protects nothing, so only requests
// that FAIL authentication charge this bucket: legitimate NATed users never
// touch it, while an unauthenticated flood is cut off before the device-token
// lookup. The quotas above are charged to the authenticated alias instead.
const authFailureGate = new RateLimiter({ windowMs: 60_000, max: 30, prefix: "authFail" });


// The ghost_payments and ghost_entitlements tables are provisioned through the
// standard Drizzle schema (lib/db/src/schema/payments.ts) and applied via
// `pnpm --filter db push` (see scripts/post-merge.sh) — the single source of
// truth for the database schema.

/** True for a Postgres unique-constraint violation (replay), not a generic fault. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

/**
 * Repair a missing/expired entitlement without ever downgrading an active one.
 * Used when reading an already-confirmed payment whose entitlement write may
 * have been lost. Never overwrites a longer-lived entitlement.
 */
async function ensureEntitlement(userId: string, plan: string, activeUntil: Date): Promise<void> {
  const [row] = await db
    .select()
    .from(ghostEntitlementsTable)
    .where(eq(ghostEntitlementsTable.userId, userId));
  if (!row || row.activeUntil.getTime() < activeUntil.getTime()) {
    await db
      .insert(ghostEntitlementsTable)
      .values({ userId, plan, activeUntil, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: ghostEntitlementsTable.userId,
        set: { plan, activeUntil, updatedAt: new Date() },
      });
  }
}

function entitlementPayload(plan: string, activeUntil: Date) {
  return {
    plan,
    activeUntil: activeUntil.toISOString(),
    active: activeUntil.getTime() > Date.now(),
  };
}

// ── POST /api/crypto/payment-intent ──────────────────────────────────────────
// Authenticated. Creates a unique payment request and returns the Solana Pay
// URL (with a per-payment reference), amount, wallet, and expiry.
router.post("/crypto/payment-intent", async (req: Request, res: Response) => {
  try {
    const ipKey = getIpKey(req);
    if (!(await authFailureGate.allowed(ipKey))) {
      return res.status(429).json({ error: "Too many requests" });
    }
    if (!isWalletConfigured()) {
      return res
        .status(503)
        .json({ error: "Payments are not configured. Set GHOST_WALLET_ADDRESS." });
    }
    const alias = await getAuthedAlias(req, "query-or-body");
    if (!alias) {
      await authFailureGate.record(ipKey);
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!(await intentLimiter.check(alias))) {
      return res.status(429).json({ error: "Too many payment requests. Try again shortly." });
    }

    const plan = (req.body?.plan as string | undefined)?.toLowerCase();
    if (!isPlan(plan)) {
      return res.status(400).json({ error: "Invalid plan. Use specter or phantom." });
    }

    const wallet = getReceivingWallet() as string;
    const { usdc, label } = PLAN_PRICES[plan];

    // Unique per-payment reference — a throwaway Solana public key.
    const reference = Keypair.generate().publicKey.toBase58();
    const expiresAt = new Date(Date.now() + INTENT_TTL_MS);

    await db.insert(ghostPaymentsTable).values({
      reference,
      userId: alias,
      plan,
      expectedUsdc: String(usdc),
      status: "pending",
      recipient: wallet,
      expiresAt,
    });

    const solanaPayUrl = buildSolanaPayUrl({
      recipient: wallet,
      amountUsdc: usdc,
      reference,
      label,
      memo: plan.toUpperCase(),
    });

    return res.json({
      reference,
      wallet,
      usdc,
      currency: "USDC",
      network: "Solana",
      usdcMint: USDC_MINT,
      label,
      solanaPayUrl,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "payment-intent failed");
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── GET /api/crypto/payment-status?alias=&reference= ─────────────────────────
// Authenticated. Locates the transaction on-chain by reference, validates
// recipient / USDC mint / exact amount, then marks confirmed + records the
// entitlement. Returns pending | confirmed | expired.
router.get("/crypto/payment-status", async (req: Request, res: Response) => {
  try {
    const ipKey = getIpKey(req);
    if (!(await authFailureGate.allowed(ipKey))) {
      return res.status(429).json({ error: "Too many requests" });
    }
    const alias = await getAuthedAlias(req, "query-or-body");
    if (!alias) {
      await authFailureGate.record(ipKey);
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!(await statusLimiter.check(alias))) {
      return res.status(429).json({ error: "Too many status checks. Slow down." });
    }

    const reference = (req.query.reference as string | undefined)?.trim();
    if (!reference) return res.status(400).json({ error: "reference required" });

    const [payment] = await db
      .select()
      .from(ghostPaymentsTable)
      .where(
        and(eq(ghostPaymentsTable.reference, reference), eq(ghostPaymentsTable.userId, alias)),
      );

    if (!payment) return res.status(404).json({ error: "Payment request not found" });

    // Already confirmed — repair the entitlement if a prior write was lost,
    // then return it. ensureEntitlement never downgrades a longer entitlement.
    if (payment.status === "confirmed") {
      const activeUntil = computeActiveUntil(payment.confirmedAt ?? new Date());
      await ensureEntitlement(payment.userId, payment.plan, activeUntil);
      return res.json({
        status: "confirmed",
        signature: payment.signature,
        entitlement: entitlementPayload(payment.plan, activeUntil),
      });
    }

    // Expire stale pending requests before hitting the chain.
    if (payment.status === "expired" || payment.expiresAt.getTime() < Date.now()) {
      if (payment.status !== "expired") {
        await db
          .update(ghostPaymentsTable)
          .set({ status: "expired" })
          .where(eq(ghostPaymentsTable.id, payment.id));
      }
      return res.json({ status: "expired" });
    }

    // Locate every candidate transaction carrying this reference and validate
    // each one (recipient / USDC mint / exact amount) at `finalized` commitment.
    // A single reference normally has one transfer, but scanning all candidates
    // means one failed/invalid tx can't permanently block a valid one.
    const connection = getConnection();
    const referencePubkey = new PublicKey(reference);
    const candidates = await connection.getSignaturesForAddress(
      referencePubkey,
      { limit: 20 },
      "finalized",
    );

    let validSignature: string | null = null;
    for (const candidate of candidates) {
      if (candidate.err) continue; // tx failed on-chain
      try {
        await validateTransfer(
          connection,
          candidate.signature,
          {
            recipient: new PublicKey(payment.recipient),
            amount: new BigNumber(payment.expectedUsdc),
            splToken: new PublicKey(USDC_MINT),
            reference: referencePubkey,
          },
          { commitment: "finalized" },
        );
        validSignature = candidate.signature;
        break;
      } catch (err) {
        // This candidate doesn't satisfy the payment requirements; keep looking.
        logger.warn(
          { err: toErrorMessage(err), reference, signature: candidate.signature },
          "candidate transfer validation failed",
        );
      }
    }

    // No finalized, valid transfer yet — a correct one may still arrive.
    if (!validSignature) {
      return res.json({ status: "pending" });
    }

    // Confirmed. Mark the payment and grant the entitlement in a single
    // transaction so a paid user can never be left without an entitlement. The
    // UNIQUE signature constraint enforces one redemption per on-chain
    // transaction (replay protection).
    const confirmedAt = new Date();
    const activeUntil = computeActiveUntil(confirmedAt);
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(ghostPaymentsTable)
          .set({ status: "confirmed", signature: validSignature, confirmedAt })
          .where(eq(ghostPaymentsTable.id, payment.id));
        await tx
          .insert(ghostEntitlementsTable)
          .values({ userId: alias, plan: payment.plan, activeUntil, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: ghostEntitlementsTable.userId,
            set: { plan: payment.plan, activeUntil, updatedAt: new Date() },
          });
      });
    } catch (err) {
      // Signature already redeemed (UNIQUE violation) → reject the replay.
      if (isUniqueViolation(err)) {
        logger.warn({ err: toErrorMessage(err), reference }, "duplicate signature redemption");
        return res.json({ status: "pending" });
      }
      // Any other DB failure is a real fault — surface it.
      throw err;
    }

    return res.json({
      status: "confirmed",
      signature: validSignature,
      entitlement: entitlementPayload(payment.plan, activeUntil),
    });
  } catch (err) {
    logger.error({ err }, "payment-status failed");
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── GET /api/crypto/entitlement?alias= ───────────────────────────────────────
// Authenticated. Returns the user's current active plan (or null).
router.get("/crypto/entitlement", async (req: Request, res: Response) => {
  try {
    const alias = await getAuthedAlias(req, "query-or-body");
    if (!alias) return res.status(401).json({ error: "Unauthorized" });

    const [row] = await db
      .select()
      .from(ghostEntitlementsTable)
      .where(eq(ghostEntitlementsTable.userId, alias));

    if (!row || row.activeUntil.getTime() <= Date.now()) {
      return res.json({ entitlement: null, termDays: TERM_DAYS });
    }

    return res.json({
      entitlement: entitlementPayload(row.plan, row.activeUntil),
      termDays: TERM_DAYS,
    });
  } catch (err) {
    logger.error({ err }, "entitlement failed");
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

export default router;
