import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import {
  isNativeCallPushConfigured,
  sendNativeCallPush,
  type NativeTokenType,
} from "./nativeCallPushSender";
import { db, callPushTokensTable, identityKeysTable } from "@workspace/db";
import { filterExpoRowsShadowedByNative } from "./callPushDedupe";

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
 * Returns true if `alias` has at least one *actionable* call-push token.
 * Used by the call-ring path to decide between "push and keep ringing"
 * and "bounce offline immediately". Expo tokens are always actionable;
 * native tokens (apns-voip / fcm, task #152) only count when their
 * transport's credentials are configured — otherwise the ring would park
 * against a push that can never be sent.
 */
export async function hasCallPushTokens(alias: string): Promise<boolean> {
  const rows = await db
    .select({ tokenType: callPushTokensTable.tokenType })
    .from(callPushTokensTable)
    .where(eq(callPushTokensTable.userId, alias));
  const actionable = rows.some(
    (r) =>
      r.tokenType === "expo" ||
      ((r.tokenType === "apns-voip" || r.tokenType === "fcm") &&
        isNativeCallPushConfigured(r.tokenType)),
  );
  if (!actionable) return false;
  // Identity-key gate (task #153): tokens without a live identity are stale
  // leftovers from a wipe — treat the alias as unpushable and prune.
  if (!(await aliasHasIdentityKeys(alias))) {
    await db.delete(callPushTokensTable).where(eq(callPushTokensTable.userId, alias));
    logger.info({ alias }, "[callPush] Pruned tokens for alias with no identity keys");
    return false;
  }
  return true;
}

/**
 * Best-effort push to every device registered for `alias`. Failures are
 * logged, never thrown — the WS relay path must not be disturbed by push
 * infrastructure trouble. Tokens Expo reports as DeviceNotRegistered are
 * pruned so we stop pushing to wiped/uninstalled devices.
 */
export async function sendCallPush(alias: string, data: CallPushData): Promise<void> {
  try {
    // Defense-in-depth for the identity-key gate in hasCallPushTokens():
    // never push to an alias whose identity keys are gone, even if a caller
    // reaches this function directly.
    if (!(await aliasHasIdentityKeys(alias))) {
      await db.delete(callPushTokensTable).where(eq(callPushTokensTable.userId, alias));
      return;
    }
    const rows = await db
      .select()
      .from(callPushTokensTable)
      .where(eq(callPushTokensTable.userId, alias));
    if (rows.length === 0) return;

    // ── Native full-screen ring (task #152): apns-voip / fcm tokens ─────────
    // These wake devices carrying the expo-callkit-telecom module — CallKit
    // sheet on iOS, Core-Telecom full-screen intent on Android. Sent first
    // and independently of the Expo alert path.
    const nativeRows = rows.filter((r) => r.tokenType === "apns-voip" || r.tokenType === "fcm");
    const nativeBadIds: number[] = [];
    await Promise.all(
      nativeRows.map(async (r) => {
        const result = await sendNativeCallPush(r.tokenType as NativeTokenType, r.token, data);
        if (result === "bad-token") nativeBadIds.push(r.id);
        else if (result === "unconfigured") {
          logger.warn(
            { tokenType: r.tokenType },
            "[callPush] Native call push credentials missing; token skipped",
          );
        }
      }),
    );
    if (nativeBadIds.length > 0) {
      await db.delete(callPushTokensTable).where(inArray(callPushTokensTable.id, nativeBadIds));
      logger.info({ count: nativeBadIds.length }, "[callPush] Pruned dead native push tokens");
    }

    // ── Expo alert-push fallback path (task #150) ────────────────────────────
    // Double-ring guard (task #172): when a platform already has a native
    // token with configured credentials, the native push shows the
    // full-screen ring — suppress the Expo alert for that platform so the
    // device doesn't get a redundant "Incoming call" banner on top of it.
    const allExpoRows = rows.filter((r) => r.tokenType === "expo");
    const expoRows = filterExpoRowsShadowedByNative(rows, allExpoRows, isNativeCallPushConfigured);
    const suppressed = allExpoRows.length - expoRows.length;
    if (suppressed > 0) {
      logger.debug(
        { suppressed },
        "[callPush] Expo alert push suppressed; native ring covers the platform",
      );
    }
    const valid = expoRows.filter((r) => Expo.isExpoPushToken(r.token));
    const invalidIds = expoRows.filter((r) => !Expo.isExpoPushToken(r.token)).map((r) => r.id);
    if (invalidIds.length > 0) {
      await db.delete(callPushTokensTable).where(inArray(callPushTokensTable.id, invalidIds));
    }
    if (valid.length === 0) {
      if (nativeRows.length > 0) {
        logger.debug({ devices: nativeRows.length }, "[callPush] Native call push sent");
      }
      return;
    }

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

/**
 * Task #153: an alias with no registered identity keys is gone (never
 * registered, or wiped/departed). No push may ever target it — a wiped
 * device must not keep buzzing with "Incoming call" wake pushes. Any
 * lingering call push tokens for such an alias are pruned on sight.
 */
async function aliasHasIdentityKeys(alias: string): Promise<boolean> {
  const rows = await db
    .select({ id: identityKeysTable.id })
    .from(identityKeysTable)
    .where(eq(identityKeysTable.userId, alias))
    .limit(1);
  return rows.length > 0;
}
