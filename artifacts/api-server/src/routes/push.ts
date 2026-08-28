import { Router, type IRouter, type Request, type Response } from "express";
import { db, identityKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { deviceAuthMiddleware } from "../lib/auth";
import { toErrorMessage } from "../utils/error";

const router: IRouter = Router();

const requireDeviceAuth = deviceAuthMiddleware();

/**
 * Register (or clear, by passing null) this device's push tokens.
 *   expoPushToken — new-message wake on any platform, incoming-call wake on Android.
 *   voipPushToken — iOS PushKit token for CallKit incoming-call wake.
 * Either field may be omitted to leave it unchanged.
 */
router.post("/push/:userId/register", requireDeviceAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.params["userId"] as string;
    const { expoPushToken, voipPushToken } = req.body as {
      expoPushToken?: string | null;
      voipPushToken?: string | null;
    };

    if (expoPushToken !== undefined && expoPushToken !== null && typeof expoPushToken !== "string") {
      res.status(400).json({ error: "expoPushToken must be a string or null" });
      return;
    }
    if (voipPushToken !== undefined && voipPushToken !== null && typeof voipPushToken !== "string") {
      res.status(400).json({ error: "voipPushToken must be a string or null" });
      return;
    }

    const update: Partial<typeof identityKeysTable.$inferInsert> = {};
    if (expoPushToken !== undefined) update.expoPushToken = expoPushToken;
    if (voipPushToken !== undefined) update.voipPushToken = voipPushToken;

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "expoPushToken or voipPushToken required" });
      return;
    }

    await db.update(identityKeysTable).set(update).where(eq(identityKeysTable.userId, userId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: toErrorMessage(err) });
  }
});

export default router;
