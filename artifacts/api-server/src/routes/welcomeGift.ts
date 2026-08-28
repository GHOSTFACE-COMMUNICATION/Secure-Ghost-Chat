import { Router, type IRouter, type Request, type Response } from "express";
import { db, ghostEntitlementsTable, welcomeGiftsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuthedAlias } from "../lib/auth";
import { RateLimiter, GlobalLimiter, getIpKey } from "../lib/rateLimiter";
import { computeActiveUntil, TERM_DAYS, type PlanId } from "../lib/solanaPayments";
import { toErrorMessage } from "../utils/error";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * The welcome gift: one free month of SPECTER, given once per identity at the
 * end of sign-up.
 *
 * Fixed rather than random, deliberately:
 *  - The coin is tappable BEFORE an identity exists, so a client-side pick
 *    could never be authoritative — it would risk showing one thing and the
 *    server granting another.
 *  - A guaranteed gift is not a prize draw, so it carries none of Apple's
 *    sweepstakes requirements or NZ promotional-competition rules, which
 *    would otherwise apply across every territory the app ships to.
 *  - SPECTER is software: marginal cost is zero, so this is an acquisition
 *    trial rather than a liability. PHANTOM stays the paid upgrade, and
 *    GHOST NUMBER is excluded entirely — it is the only offer with a real
 *    recurring cash cost (rented number + SMS), and whether numbers may even
 *    be assigned to individual end users is still an open question with the
 *    supplier.
 */
const GIFT_PLAN: PlanId = "specter";

// Per-IP and global caps. This endpoint writes an entitlement, so it is worth
// bounding even though the per-identity primary key already makes repeats
// harmless.
const claimLimiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 120, prefix: "welcomeGift" });
const claimGlobal = new GlobalLimiter({ windowMs: 60 * 60 * 1000, max: 3_000, prefix: "welcomeGiftGlobal" });

// ── POST /api/welcome-gift ────────────────────────────────────────────────────
//
// Requires: Authorization: Bearer <device-token> and ?alias=<ALIAS>.
//
// Idempotent: the second and later calls report alreadyClaimed and write
// nothing. Returns the plan and its expiry so the client can display exactly
// what was granted rather than what it guessed.
router.post("/welcome-gift", async (req: Request, res: Response) => {
  try {
    if (!(await claimLimiter.check(getIpKey(req))) || !(await claimGlobal.check())) {
      return res.status(429).json({ error: "Too many requests" });
    }

    // NOTE: deliberately NOT using checkAuth() here. That helper honours
    // ENFORCE_ENDPOINT_AUTH, which ships OFF — under it an unauthenticated
    // caller passes through with a null alias. That is acceptable for the
    // endpoints it was written for, and completely unacceptable here: this
    // one grants an entitlement, so it must fail closed regardless of the
    // flag's state.
    const alias = await getAuthedAlias(req, "query");
    if (!alias) {
      return res.status(401).json({
        error: "Authorization: Bearer <device-token> and a matching alias are required",
      });
    }

    const [existing] = await db
      .select()
      .from(welcomeGiftsTable)
      .where(eq(welcomeGiftsTable.userId, alias));
    if (existing) {
      return res.json({ plan: existing.plan, alreadyClaimed: true });
    }

    const now = new Date();
    const activeUntil = computeActiveUntil(now, TERM_DAYS);

    const granted = await db.transaction(async (tx) => {
      // The primary key is the guard: two concurrent claims race here and
      // exactly one inserts. The loser gets zero rows back and grants nothing.
      const inserted = await tx
        .insert(welcomeGiftsTable)
        .values({ userId: alias, plan: GIFT_PLAN, grantedAt: now })
        .onConflictDoNothing({ target: welcomeGiftsTable.userId })
        .returning({ userId: welcomeGiftsTable.userId });
      if (inserted.length === 0) return false;

      // Never downgrade someone who already has a longer entitlement — a user
      // who paid for PHANTOM and then finishes onboarding must not be dropped
      // to a shorter SPECTER term. Same rule as ensureEntitlement in
      // routes/crypto.ts.
      const [current] = await tx
        .select()
        .from(ghostEntitlementsTable)
        .where(eq(ghostEntitlementsTable.userId, alias));
      if (!current || current.activeUntil.getTime() < activeUntil.getTime()) {
        await tx
          .insert(ghostEntitlementsTable)
          .values({ userId: alias, plan: GIFT_PLAN, activeUntil, updatedAt: now })
          .onConflictDoUpdate({
            target: ghostEntitlementsTable.userId,
            set: { plan: GIFT_PLAN, activeUntil, updatedAt: now },
          });
      }
      return true;
    });

    if (!granted) {
      // Lost the race with a concurrent claim — report it the same way a
      // repeat call is reported rather than as an error.
      return res.json({ plan: GIFT_PLAN, alreadyClaimed: true });
    }

    logger.info({ alias, plan: GIFT_PLAN }, "welcome gift granted");
    return res.json({ plan: GIFT_PLAN, activeUntil: activeUntil.toISOString(), alreadyClaimed: false });
  } catch (err) {
    logger.error({ err }, "welcome gift grant failed");
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

export default router;
