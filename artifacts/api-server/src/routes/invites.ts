import { Router, type IRouter, type Request, type Response } from "express";
import { db, invitesTable, identityKeysTable } from "@workspace/db";
import { and, eq, gt } from "drizzle-orm";
import { RateLimiter, getIpKey } from "../lib/rateLimiter";
import { normalizeAlias } from "../utils/alias";
import { toErrorMessage } from "../utils/error";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// 20 invite creations per IP per 10 minutes
const createLimiter = new RateLimiter({ windowMs: 10 * 60_000, max: 20 });
// 60 redemption attempts per IP per minute
const redeemLimiter = new RateLimiter({ windowMs: 60_000, max: 60 });

const CODE_REGEX = /^GF-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

/**
 * POST /invites
 * Registers a new invite code tied to the owner's alias.
 * Body: { code: string, ownerAlias: string, expiresAt: number (unix ms) }
 * Responds 201 on success, 400 on bad input, 409 if code already exists.
 */
router.post("/invites", async (req: Request, res: Response) => {
  if (!createLimiter.check(getIpKey(req))) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const { code, ownerAlias, expiresAt } = req.body as {
    code?: string;
    ownerAlias?: string;
    expiresAt?: number;
  };

  if (
    typeof code !== "string" ||
    !CODE_REGEX.test(code.toUpperCase()) ||
    typeof ownerAlias !== "string" ||
    ownerAlias.trim().length < 2 ||
    typeof expiresAt !== "number" ||
    expiresAt <= Date.now()
  ) {
    return res.status(400).json({ error: "Invalid invite parameters" });
  }

  const normalizedAlias = normalizeAlias(ownerAlias);
  const normalizedCode = code.toUpperCase();

  try {
    // Verify the owner actually has a registered identity on the server
    const [owner] = await db
      .select({ userId: identityKeysTable.userId })
      .from(identityKeysTable)
      .where(eq(identityKeysTable.userId, normalizedAlias));

    if (!owner) {
      return res.status(404).json({ error: "Owner alias not registered" });
    }

    await db.insert(invitesTable).values({
      code: normalizedCode,
      ownerAlias: normalizedAlias,
      expiresAt: new Date(expiresAt),
    });

    logger.info({ code: normalizedCode, ownerAlias: normalizedAlias }, "Invite created");
    return res.status(201).json({ ok: true });
  } catch (err) {
    const msg = toErrorMessage(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return res.status(409).json({ error: "Code already registered" });
    }
    logger.error({ err }, "Failed to create invite");
    return res.status(500).json({ error: msg });
  }
});

/**
 * GET /invites/:code
 * Non-destructive lookup — returns ownerAlias if the code is valid and unredeemed.
 * Does NOT consume the code. Consume requires a separate POST /invites/:code/consume.
 */
router.get("/invites/:code", async (req: Request, res: Response) => {
  if (!redeemLimiter.check(getIpKey(req))) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const raw = (req.params.code as string).toUpperCase();
  if (!CODE_REGEX.test(raw)) {
    return res.status(400).json({ error: "Invalid code format" });
  }

  try {
    const [invite] = await db.select().from(invitesTable).where(eq(invitesTable.code, raw));

    if (!invite) {
      return res.status(404).json({ error: "Code not found" });
    }

    if (invite.redeemed) {
      return res.status(410).json({ error: "Code already used" });
    }

    if (new Date(invite.expiresAt) <= new Date()) {
      return res.status(410).json({ error: "Code expired" });
    }

    logger.info({ code: raw, ownerAlias: invite.ownerAlias }, "Invite lookup");
    return res.json({ ownerAlias: invite.ownerAlias });
  } catch (err) {
    logger.error({ err }, "Failed to redeem invite");
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});


/**
 * POST /invites/:code/consume
 * Atomically marks an invite code as redeemed. Call ONLY after the E2EE handshake
 * (addConversation) has already succeeded on the client.
 *
 * Single conditional UPDATE — one concurrent winner, zero rows = already used/expired.
 */
router.post("/invites/:code/consume", async (req: Request, res: Response) => {
  if (!redeemLimiter.check(getIpKey(req))) {
    return res.status(429).json({ error: "Too many requests" });
  }

  const raw = (req.params.code as string).toUpperCase();
  if (!CODE_REGEX.test(raw)) {
    return res.status(400).json({ error: "Invalid code format" });
  }

  try {
    const consumed = await db
      .update(invitesTable)
      .set({ redeemed: true })
      .where(
        and(
          eq(invitesTable.code, raw),
          eq(invitesTable.redeemed, false),
          gt(invitesTable.expiresAt, new Date()),
        ),
      )
      .returning({ code: invitesTable.code });

    if (consumed.length > 0) {
      logger.info({ code: raw }, "Invite consumed");
      return res.json({ ok: true });
    }

    // Zero rows — distinguish already-used from expired for the client
    const [invite] = await db.select().from(invitesTable).where(eq(invitesTable.code, raw));
    if (!invite)         return res.status(404).json({ error: "Code not found" });
    if (invite.redeemed) return res.status(410).json({ error: "Code already used" });
    return res.status(410).json({ error: "Code expired" });
  } catch (err) {
    logger.error({ err }, "Failed to consume invite");
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

export default router;
