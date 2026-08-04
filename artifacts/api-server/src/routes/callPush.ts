import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "crypto";
import { db, callPushTokensTable, deviceTokensTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { normalizeAlias } from "../utils/alias";

const router: IRouter = Router();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * POST /api/calls/register-voip-token — Phase 3 server side of the calling
 * push contract defined in artifacts/ghostface/lib/callPush.ts.
 *
 * body: { token: string; platform: "ios" | "android"; alias: string }
 * auth: Authorization: Bearer <device-token> for `alias` — only the device
 *       that registered the alias may point call pushes at itself. Without
 *       this gate anyone could route (identity-free, but still noisy)
 *       call-wake pushes for any alias to their own device.
 * response: 204 No Content on success.
 *
 * Upserts by push token: a token that re-registers under a new alias
 * (device wipe + fresh onboarding) is re-pointed, never duplicated.
 */
router.post("/calls/register-voip-token", async (req: Request, res: Response) => {
  try {
    const { token, platform, alias } = req.body as {
      token?: unknown;
      platform?: unknown;
      alias?: unknown;
    };
    if (typeof token !== "string" || token.length === 0 || token.length > 512) {
      return res.status(400).json({ error: "token is required" });
    }
    if (platform !== "ios" && platform !== "android") {
      return res.status(400).json({ error: "platform must be 'ios' or 'android'" });
    }
    if (typeof alias !== "string" || alias.trim().length === 0) {
      return res.status(400).json({ error: "alias is required" });
    }
    const userId = normalizeAlias(alias);

    // ── Device-token auth (same scheme as prekeys + WS auth) ────────────
    const auth = req.headers.authorization ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!bearer) {
      return res.status(401).json({ error: "Authorization: Bearer <token> header required" });
    }
    const [row] = await db
      .select()
      .from(deviceTokensTable)
      .where(
        and(
          eq(deviceTokensTable.userId, userId),
          eq(deviceTokensTable.tokenHash, hashToken(bearer)),
        ),
      );
    if (!row) {
      return res.status(403).json({ error: "Invalid or mismatched device token for alias" });
    }

    await db
      .insert(callPushTokensTable)
      .values({ userId, token, platform })
      .onConflictDoUpdate({
        target: callPushTokensTable.token,
        set: { userId, platform, updatedAt: new Date() },
      });

    logger.info({ alias: userId, platform }, "[callPush] VoIP push token registered");
    return res.status(204).end();
  } catch (err) {
    logger.error({ err }, "[callPush] register-voip-token failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
