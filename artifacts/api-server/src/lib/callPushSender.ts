import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { db, callPushTokensTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Sends the Phase 2/3 calling push: wakes a device whose app is closed so an
 * incoming call can ring (task #150).
 *
 * Privacy contract (mirrors artifacts/ghostface/lib/callPush.ts): the push
 * transits Expo's push service and then APNs/FCM, all of which can read the
 * payload — so it carries ONLY the opaque server-relayed callId and the call
 * mode. Never the caller's alias, any user-facing name, or anything
 * identity-bearing. Caller identity is resolved in-app after wake, over the
 * encrypted WebSocket channel (the pending-ring replay in ws/manager.ts).
 */
export type CallPushData = {
  callId: string;
  mode: "voice" | "video";
};

const expo = new Expo();

/**
 * Returns true if `alias` has at least one registered call-push token.
 * Used by the call-ring path to decide between "push and keep ringing"
 * and "bounce offline immediately".
 */
export async function hasCallPushTokens(alias: string): Promise<boolean> {
  const rows = await db
    .select({ id: callPushTokensTable.id })
    .from(callPushTokensTable)
    .where(eq(callPushTokensTable.userId, alias))
    .limit(1);
  return rows.length > 0;
}

/**
 * Best-effort push to every device registered for `alias`. Failures are
 * logged, never thrown — the WS relay path must not be disturbed by push
 * infrastructure trouble. Tokens Expo reports as DeviceNotRegistered are
 * pruned so we stop pushing to wiped/uninstalled devices.
 */
export async function sendCallPush(alias: string, data: CallPushData): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(callPushTokensTable)
      .where(eq(callPushTokensTable.userId, alias));
    if (rows.length === 0) return;

    const valid = rows.filter((r) => Expo.isExpoPushToken(r.token));
    const invalidIds = rows.filter((r) => !Expo.isExpoPushToken(r.token)).map((r) => r.id);
    if (invalidIds.length > 0) {
      await db.delete(callPushTokensTable).where(inArray(callPushTokensTable.id, invalidIds));
    }
    if (valid.length === 0) return;

    const messages: ExpoPushMessage[] = valid.map((r) => ({
      to: r.token,
      // Generic, identity-free alert. The caller's alias is intentionally
      // NOT here — it is delivered over WS after the app wakes.
      title: "GHOSTFACE",
      body: "Incoming call",
      data,
      priority: "high",
      channelId: "incoming-calls", // Android: MAX-importance ringtone channel
      sound: "default", // iOS alert sound
      // Ring window: caller gives up after 30 s (app/call.tsx). A push that
      // arrives later than that would wake the device for a dead call.
      ttl: 30,
    }));

    const badTokens: string[] = [];
    for (const chunk of expo.chunkPushNotifications(messages)) {
      try {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        tickets.forEach((ticket, i) => {
          if (
            ticket.status === "error" &&
            ticket.details?.error === "DeviceNotRegistered" &&
            chunk[i]
          ) {
            badTokens.push(chunk[i].to as string);
          }
        });
      } catch (err) {
        logger.warn({ err }, "[callPush] Expo push chunk failed");
      }
    }
    if (badTokens.length > 0) {
      await db.delete(callPushTokensTable).where(inArray(callPushTokensTable.token, badTokens));
      logger.info({ count: badTokens.length }, "[callPush] Pruned unregistered push tokens");
    }
    logger.debug({ devices: valid.length }, "[callPush] Call push sent");
  } catch (err) {
    logger.warn({ err }, "[callPush] Failed to send call push");
  }
}
