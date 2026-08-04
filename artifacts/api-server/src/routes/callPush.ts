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
 * body: { token: string; platform: "ios" | "android"; alias: string;
 *         tokenType?: "expo" | "apns-voip" | "fcm" }  // default "expo"
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
    const { token, platform, alias, tokenType } = req.body as {
      token?: unknown;
      platform?: unknown;
      alias?: unknown;
      tokenType?: unknown;
    };
    if (typeof token !== "string" || token.length === 0 || token.length > 512) {
      return res.status(400).json({ error: "token is required" });
    }
    if (platform !== "ios" && platform !== "android") {
      return res.status(400).json({ error: "platform must be 'ios' or 'android'" });
    }
    const resolvedTokenType = tokenType === undefined ? "expo" : tokenType;
    if (
      resolvedTokenType !== "expo" &&
      resolvedTokenType !== "apns-voip" &&
      resolvedTokenType !== "fcm"
    ) {
      return res.status(400).json({ error: "tokenType must be 'expo', 'apns-voip' or 'fcm'" });
    }
    // Transport/platform sanity: PushKit VoIP tokens only exist on iOS, and
    // this app's FCM data-message ring path is Android-only.
    if (resolvedTokenType === "apns-voip" && platform !== "ios") {
      return res.status(400).json({ error: "apns-voip tokens are iOS-only" });
    }
    if (resolvedTokenType === "fcm" && platform !== "android") {
      return res.status(400).json({ error: "fcm tokens are android-only" });
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
      .values({ userId, token, platform, tokenType: resolvedTokenType })
      .onConflictDoUpdate({
        target: callPushTokensTable.token,
        set: { userId, platform, tokenType: resolvedTokenType, updatedAt: new Date() },
      });

    logger.info(
      { alias: userId, platform, tokenType: resolvedTokenType },
      "[callPush] VoIP push token registered",
    );
    return res.status(204).end();
  } catch (err) {
    logger.error({ err }, "[callPush] register-voip-token failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

/**
 * POST /api/calls/unregister-voip-token — best-effort client-side cleanup
 * before a panic wipe (task #153). Deletes ALL call push tokens registered
 * for `alias`, so a wiped device stops receiving "Incoming call" wake pushes
 * immediately. Same device-token auth as registration.
 *
 * body: { alias: string }
 * response: 204 No Content on success.
 */
router.post("/calls/unregister-voip-token", async (req: Request, res: Response) => {
  try {
    const { alias } = req.body as { alias?: unknown };
    if (typeof alias !== "string" || alias.trim().length === 0) {
      return res.status(400).json({ error: "alias is required" });
    }
    const userId = normalizeAlias(alias);

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

    await db.delete(callPushTokensTable).where(eq(callPushTokensTable.userId, userId));
    logger.info({ alias: userId }, "[callPush] VoIP push tokens unregistered");
    return res.status(204).end();
  } catch (err) {
    logger.error({ err }, "[callPush] unregister-voip-token failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
