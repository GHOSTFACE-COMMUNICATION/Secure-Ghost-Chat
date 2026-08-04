import { Router, type IRouter, type Request, type Response } from "express";
import { db, refreshTokensTable } from "@workspace/db";
import { eq, and, isNull, gt } from "drizzle-orm";
import { RateLimiter, getIpKey } from "../lib/rateLimiter";
import { toErrorMessage } from "../utils/error";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
} from "../lib/jwt";

const router: IRouter = Router();

// 30 refresh attempts per 15 minutes per IP — a legitimate client refreshes
// roughly once every 15 minutes, so this is generous while still throttling
// brute force against the refresh endpoint.
const refreshLimiter = new RateLimiter({ windowMs: 15 * 60_000, max: 30 });

// ── POST /api/auth/refresh — rotate a refresh token ───────────────────────────
// Body: { refreshToken }
// Verifies the JWT, checks it is present, unexpired and unrevoked in
// refresh_tokens, then rotates: marks the old row revoked and issues a fresh
// { accessToken, refreshToken } pair.
router.post("/auth/refresh", async (req: Request, res: Response) => {
  if (!refreshLimiter.check(getIpKey(req))) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken || typeof refreshToken !== "string") {
      return res.status(400).json({ error: "refreshToken required" });
    }

    const userId = verifyRefreshToken(refreshToken);
    if (!userId) {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    const hash = hashRefreshToken(refreshToken);
    const now = new Date();

    const rotated = await db.transaction(async (tx) => {
      // Atomic single-use claim: the conditional UPDATE revokes the row only
      // if it is still unrevoked, unexpired, and owned by the JWT subject.
      // Two concurrent refreshes with the same token race on this UPDATE —
      // exactly one gets the row back and mints a successor; the loser gets
      // zero rows and a 401. This closes the read-then-revoke replay window.
      const claimed = await tx
        .update(refreshTokensTable)
        .set({ revokedAt: now })
        .where(
          and(
            eq(refreshTokensTable.tokenHash, hash),
            eq(refreshTokensTable.userId, userId),
            isNull(refreshTokensTable.revokedAt),
            gt(refreshTokensTable.expiresAt, now),
          ),
        )
        .returning({ id: refreshTokensTable.id });
      if (claimed.length !== 1) return null;
      const next = signRefreshToken(userId);
      await tx.insert(refreshTokensTable).values({
        userId,
        tokenHash: hashRefreshToken(next.token),
        expiresAt: next.expiresAt,
      });
      return next.token;
    });

    if (!rotated) {
      return res.status(401).json({ error: "Refresh token revoked or unknown" });
    }

    return res.json({ accessToken: signAccessToken(userId), refreshToken: rotated });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

// ── POST /api/auth/revoke — invalidate a refresh token (logout / wipe) ────────
// Body: { refreshToken }
// Idempotent: revoking an already-revoked or unknown token returns 200 so a
// wiping client never blocks on this call.
router.post("/auth/revoke", async (req: Request, res: Response) => {
  if (!refreshLimiter.check(getIpKey(req))) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken || typeof refreshToken !== "string") {
      return res.status(400).json({ error: "refreshToken required" });
    }
    const hash = hashRefreshToken(refreshToken);
    await db
      .update(refreshTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokensTable.tokenHash, hash), isNull(refreshTokensTable.revokedAt)));
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

export default router;
