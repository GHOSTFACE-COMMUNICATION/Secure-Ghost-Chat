import { Router, type IRouter, type Request, type Response } from "express";
import { db, identityKeysTable, deviceTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createHash } from "crypto";
import { toErrorMessage } from "../utils/error";

const router: IRouter = Router();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Same bearer-device-token-vs-path-userId check used by the prekey routes. */
async function requireDeviceAuth(req: Request, res: Response, next: () => void): Promise<void> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (!token) {
    res.status(401).json({ error: "Authorization: Bearer <token> header required" });
    return;
  }

  const userId = req.params["userId"] as string;
  const hash = hashToken(token);

  const [row] = await db
    .select()
    .from(deviceTokensTable)
    .where(and(eq(deviceTokensTable.userId, userId), eq(deviceTokensTable.tokenHash, hash)));

  if (!row) {
    res.status(403).json({ error: "Invalid or mismatched device token for userId" });
    return;
  }

  next();
}

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
