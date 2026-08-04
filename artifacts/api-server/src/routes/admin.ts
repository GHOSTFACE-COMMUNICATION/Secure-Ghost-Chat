import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, callPushTokensTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { normalizeAlias } from "../utils/alias";
import { sendNativeCallPush, type NativeTokenType } from "../lib/nativeCallPushSender";

const router: IRouter = Router();

// Shared-secret gate moved to ../middlewares/adminAuth (task #168) so every
// /admin surface uses the same credential. Re-exported for compatibility.
import { requireAdminSecret } from "../middlewares/adminAuth";
export { requireAdminSecret };

/**
 * POST /admin/test-ring-push — fire a real native ring push to every device
 * registered for an alias, without needing a second phone (task #170).
 *
 * body: { aliasId: string; mode?: "voice" | "video" }   // default "voice"
 * auth: x-admin-secret header (see requireAdminSecret)
 * response: {
 *   callId, results: [{ tokenId, tokenType, platform, result }]
 * } where result is "ok" | "bad-token" | "error" | "unconfigured" for
 * native tokens and "skipped-expo" for Expo alert tokens (this endpoint
 * exercises the native APNs/FCM ring path only).
 *
 * Bad tokens are pruned exactly as on the real call path (sendCallPush).
 * The payload is identity-free — a synthetic test callId and the mode —
 * so no privacy contract is violated by testing.
 */
router.post("/admin/test-ring-push", requireAdminSecret, async (req: Request, res: Response) => {
  try {
    const { aliasId, mode } = req.body as { aliasId?: unknown; mode?: unknown };
    if (typeof aliasId !== "string" || aliasId.trim().length === 0) {
      return res.status(400).json({ error: "aliasId is required" });
    }
    const resolvedMode = mode === undefined ? "voice" : mode;
    if (resolvedMode !== "voice" && resolvedMode !== "video") {
      return res.status(400).json({ error: "mode must be 'voice' or 'video'" });
    }
    const alias = normalizeAlias(aliasId);
    const rows = await db
      .select()
      .from(callPushTokensTable)
      .where(eq(callPushTokensTable.userId, alias));
    if (rows.length === 0) {
      return res.status(404).json({ error: "no call push tokens registered for alias" });
    }

    // Synthetic, clearly-marked test call id. No pending ring is parked for
    // it, so a device that wakes will show the ring and then time out /
    // dismiss when no call materializes — exactly the smoke test wanted.
    const callId = `test-ring-${Date.now()}`;
    const data = { callId, mode: resolvedMode } as const;

    const results = await Promise.all(
      rows.map(async (r) => {
        const base = { tokenId: r.id, tokenType: r.tokenType, platform: r.platform };
        if (r.tokenType !== "apns-voip" && r.tokenType !== "fcm") {
          return { ...base, result: "skipped-expo" as const };
        }
        try {
          const result = await sendNativeCallPush(r.tokenType as NativeTokenType, r.token, data);
          return { ...base, result };
        } catch (err) {
          // e.g. malformed APNs key / FCM credentials — report per-token
          // instead of failing the whole request.
          logger.warn({ err, tokenType: r.tokenType }, "[admin] test ring push send threw");
          return { ...base, result: "error" as const };
        }
      }),
    );

    // Prune bad tokens exactly like the real call path does.
    const badIds = results.filter((r) => r.result === "bad-token").map((r) => r.tokenId);
    if (badIds.length > 0) {
      await db.delete(callPushTokensTable).where(inArray(callPushTokensTable.id, badIds));
      logger.info({ count: badIds.length }, "[admin] Pruned dead native push tokens (test ring)");
    }

    logger.info({ alias, callId, results }, "[admin] Test ring push fired");
    return res.json({ callId, mode: resolvedMode, results });
  } catch (err) {
    logger.warn({ err }, "[admin] test-ring-push failed");
    return res.status(500).json({ error: "internal error" });
  }
});

export default router;
