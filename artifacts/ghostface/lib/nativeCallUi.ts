/**
 * Native full-screen call ringing (task #152).
 *
 * iOS: PushKit VoIP push + CallKit — a locked/closed iPhone shows the native
 * full-screen incoming-call sheet, keeps ringing, and offers answer/decline
 * without unlocking. Android: Jetpack Core-Telecom — an incoming-call
 * notification with a full-screen intent while locked.
 *
 * Implemented with expo-callkit-telecom (Expo module, New-Architecture
 * compatible; replaces the react-native-callkeep +
 * react-native-voip-push-notification pair whose New Arch / SDK 54 issues
 * blocked this in task #150). The module parses the VoIP push natively —
 * before JS runs — so cold-start ringing works.
 *
 * Privacy: the VoIP push payload follows the same identity-free contract as
 * lib/callPush.ts — it carries the opaque serverCallId and the call mode
 * only. The native call sheet therefore shows a generic "GHOSTFACE" caller;
 * the real alias is resolved after wake over the encrypted WebSocket (the
 * server's parked-ring replay), exactly like the alert-push path.
 *
 * Runtime guards: everything here no-ops on web, in Expo Go, and in any
 * build without the native module (it is only compiled in via the
 * expo-callkit-telecom config plugin during prebuild — i.e. dev/production
 * builds). In those environments the Expo alert push from lib/callPush.ts
 * remains the wake path.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import type * as CallKitTelecom from "expo-callkit-telecom";

type CallKitModule = typeof CallKitTelecom;

/** What the user did on the native call UI before the app/WS was ready. */
export type NativeCallAction = {
  serverCallId: string;
  action: "answered" | "declined";
  at: number;
};

// How long a native answer/decline stays valid while waiting for the WS
// parked-ring replay. Matches the caller's 30 s ring window with headroom.
const ACTION_TTL_MS = 60_000;

let mod: CallKitModule | null = null;
let initialized = false;
let pendingAction: NativeCallAction | null = null;
// OS session id by serverCallId, so the app can clear the native call UI
// when the in-app call ends.
const sessionIdsByServerCallId = new Map<string, string>();

function loadModule(): CallKitModule | null {
  if (mod) return mod;
  if (Platform.OS === "web") return null;
  if (Constants.appOwnership === "expo") return null; // Expo Go: no native module
  try {
    // Deferred require: the native module only exists in dev/production
    // builds; loading it lazily lets Expo Go and web fail soft instead of
    // crashing the module graph at import time.
    mod = require("expo-callkit-telecom") as CallKitModule;
    return mod;
  } catch {
    return null;
  }
}

/** True when the native CallKit / Core-Telecom module is present (dev build). */
export function isNativeCallUiAvailable(): boolean {
  return loadModule() !== null;
}

/**
 * Wires VoIP push registration and the native call-UI event listeners.
 * Idempotent — safe to call on every auth. `registerToken` is invoked with
 * the transport token ("APNS_VOIP" on iOS, "FCM" on Android) whenever it is
 * (re)issued; the caller POSTs it to the backend token registry.
 *
 * Returns true when the native path is active (so the caller can skip the
 * Expo alert-push registration and avoid double-ringing the same device).
 */
export function initNativeCallUi(
  registerToken: (token: string, type: "APNS_VOIP" | "FCM") => void,
): boolean {
  const m = loadModule();
  if (!m) return false;

  if (!initialized) {
    initialized = true;

    // ── Session bookkeeping ───────────────────────────────────────────────
    m.addCallSessionAddedListener(({ session }) => {
      const serverCallId = session.incomingCallEvent?.serverCallId;
      if (serverCallId) sessionIdsByServerCallId.set(serverCallId, session.id);
    });
    m.addCallSessionRemovedListener(({ id }) => {
      for (const [serverCallId, sessionId] of sessionIdsByServerCallId) {
        if (sessionId === id) sessionIdsByServerCallId.delete(serverCallId);
      }
    });

    // ── User answered from the native sheet / lock screen ────────────────
    m.addCallAnsweredListener((event) => {
      void (async () => {
        try {
          const session = await m.getActiveCallSession();
          const serverCallId = session?.incomingCallEvent?.serverCallId;
          if (serverCallId) {
            pendingAction = { serverCallId, action: "answered", at: Date.now() };
          }
          // Ack immediately so the native UI transitions out of "ringing" and
          // the ringtone stops; the in-app call screen (app/call.tsx) owns the
          // call from here. Without this the OS fails the call after the
          // fulfill timeout.
          await m.fulfillIncomingCallConnected(event.requestId);
        } catch (e) {
          console.warn("[NativeCallUi] answer handling failed:", e);
        }
      })();
    });

    // ── User declined / OS ended while still ringing ─────────────────────
    m.addCallEndedListener(({ session }) => {
      const serverCallId = session?.incomingCallEvent?.serverCallId;
      if (!serverCallId) return;
      sessionIdsByServerCallId.delete(serverCallId);
      // Only a ring-stage end is a decline; an end after "connected" is the
      // in-app call tearing down (already handled by app/call.tsx).
      if (session.status === "ringing" || session.status === "connecting") {
        if (pendingAction?.serverCallId === serverCallId && pendingAction.action === "answered") {
          return; // answered then immediately connected+ended bookkeeping — keep the answer
        }
        pendingAction = { serverCallId, action: "declined", at: Date.now() };
      }
    });

    // ── VoIP push token ───────────────────────────────────────────────────
    m.addVoIPPushTokenUpdatedListener(({ token, type }: { token?: string; type: "APNS_VOIP" | "FCM" }) => {
      if (token) registerToken(token, type);
    });
  }

  try {
    mod?.registerVoIPPush();
    const existing = mod?.getVoIPPushToken();
    if (existing?.token) registerToken(existing.token, existing.type);
  } catch (e) {
    console.warn("[NativeCallUi] VoIP push registration failed:", e);
  }
  return true;
}

/**
 * Consumes (at most once) the user's native-UI action for `serverCallId`.
 * Called by the WS parked-ring replay handler: "answered" routes straight
 * into the call screen as callee, "declined" bounces a hangup, null falls
 * through to the normal in-app ring banner.
 */
export function takeNativeCallAction(serverCallId: string): "answered" | "declined" | null {
  const a = pendingAction;
  if (!a || a.serverCallId !== serverCallId) return null;
  pendingAction = null;
  if (Date.now() - a.at > ACTION_TTL_MS) return null;
  return a.action;
}

/**
 * Clears the native call UI for `serverCallId` when the in-app call ends
 * (hangup, remote end, no-answer). Best-effort; no-op when there is no
 * matching native session.
 */
export function endNativeCall(serverCallId: string): void {
  const m = loadModule();
  if (!m) return;
  const sessionId = sessionIdsByServerCallId.get(serverCallId);
  if (!sessionId) return;
  sessionIdsByServerCallId.delete(sessionId);
  sessionIdsByServerCallId.delete(serverCallId);
  m.reportCallEnded(sessionId, "remoteEnded").catch(() => {
    // Session may already be gone — nothing to clear.
  });
}
