import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

/* eslint-disable @typescript-eslint/no-explicit-any -- native-module interop: react-native-callkeep
   and react-native-voip-push-notification are optional native modules that only exist in a custom
   dev-client/EAS build, never in Expo Go. Same dynamic-require + graceful-fallback pattern as
   react-native-webrtc in app/call.tsx. */
let CallKeep: any = null;
let CallKeepConstants: any = null;
try {
  const callKeepModule = require("react-native-callkeep");
  CallKeep = callKeepModule.default;
  CallKeepConstants = callKeepModule.CONSTANTS;
} catch (e) {
  console.warn("[Push] react-native-callkeep not available (needs a custom dev-client build):", e);
}

let VoipPushNotification: any = null;
let RTCAudioSession: any = null;
if (Platform.OS === "ios") {
  try {
    VoipPushNotification = require("react-native-voip-push-notification").default;
  } catch (e) {
    console.warn("[Push] react-native-voip-push-notification not available:", e);
  }
  try {
    RTCAudioSession = require("react-native-webrtc").RTCAudioSession;
  } catch (e) {
    console.warn("[Push] react-native-webrtc (RTCAudioSession) not available:", e);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const CALLKEEP_OPTIONS = {
  ios: {
    appName: "GHOSTFACE",
    supportsVideo: true,
    includesCallsInRecents: false,
  },
  android: {
    alertTitle: "Calling account permission",
    alertDescription: "GHOSTFACE needs access to your phone accounts to show incoming calls",
    cancelButton: "Cancel",
    okButton: "OK",
    additionalPermissions: [] as string[],
    foregroundService: {
      channelId: "incoming-calls",
      channelName: "Incoming calls",
      notificationTitle: "GHOSTFACE is running in the background",
    },
  },
};

let callKeepReady = false;
let callKeepSetupPromise: Promise<void> | null = null;

/**
 * Idempotent — safe to call every time the hook mounts. Returns the
 * in-flight/completed setup so callers that need CallKit actually ready
 * (e.g. before displayIncomingCall) can await it instead of racing it —
 * CallKeep.setup() is async on the native side (CXProvider configuration),
 * and calling displayIncomingCall before it resolves can crash on iOS. This
 * race is tightest on a cold, killed-app launch: PushKit can hand a queued
 * VoIP payload to the "didLoadWithEvents" replay in the same tick this hook
 * mounts, well before setup's native work would otherwise have finished.
 */
function ensureCallKeepSetup(): Promise<void> {
  if (!CallKeep) return Promise.resolve();
  if (callKeepReady) return Promise.resolve();
  if (callKeepSetupPromise) return callKeepSetupPromise;
  callKeepSetupPromise = (async () => {
    try {
      await CallKeep.setup(CALLKEEP_OPTIONS);
      CallKeep.setAvailable(true);
      callKeepReady = true;
    } catch (e) {
      console.warn("[Push] CallKeep setup failed:", e);
      // Let the next call retry instead of permanently short-circuiting on
      // this settled-but-failed promise (callKeepReady is still false).
      callKeepSetupPromise = null;
    }
  })();
  return callKeepSetupPromise;
}

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "default",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#00C8FF",
  });
  await Notifications.setNotificationChannelAsync("incoming-calls", {
    name: "Incoming calls",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 500, 500],
    lightColor: "#00C8FF",
    sound: "default",
  });
}

async function registerExpoPushTokenAsync(): Promise<string | null> {
  await ensureAndroidChannels();

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    console.warn("[Push] Notification permission not granted — no Expo push token requested", finalStatus);
    return null;
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn("[Push] No EAS projectId available — cannot request Expo push token");
    return null;
  }

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

interface PushTokens {
  expoPushToken: string | null;
  voipPushToken: string | null;
}

interface IncomingCallPayload {
  callId?: string;
  from?: string;
  callMode?: string;
}

// callUUID -> the call metadata CallKeep only hands back the UUID for on
// answer/end, so this is how the answer handler recovers who/what to dial
// into. Entries are removed once acted on; a stray entry just means a stale
// call never got answered, which is harmless.
const pendingCalls = new Map<string, IncomingCallPayload>();

// callIds that currently have a CallKit CXCall outstanding — added the
// moment displayIncomingCall reports one, removed by notifyCallEnded below.
// Deliberately separate from pendingCalls above, which only covers the
// pre-answer window (cleared the instant answerCall fires): this needs to
// survive the full post-answer call lifecycle too, since call.tsx's
// local/remote-hangup paths need to know whether THIS call was ever reported
// to CallKit at all — including a call answered via the in-app overlay
// (bypassing CallKit's own answerCall event) while a VoIP push had already
// reported it, which would otherwise leave a CXCall dangling forever.
const activeCallKitUUIDs = new Set<string>();

export type CallEndOutcome = "local" | "remote" | "decline" | "unanswered";

/**
 * Tells CallKit a call is over. Only acts on calls actually reported via
 * displayIncomingCall — self-guarded via activeCallKitUUIDs, so calling this
 * for a call that never went through CallKit (e.g. answered via the in-app
 * overlay with no VoIP push involved) is always a safe no-op. Idempotent:
 * the uuid is removed from tracking before the CallKeep call runs, so a
 * second invocation for the same uuid — e.g. a local hangup racing an
 * incoming remote-hangup — finds nothing tracked and no-ops rather than
 * double-ending.
 *
 *   local      -> endCall            this device's user actively ended it
 *   decline    -> rejectCall         this device's user declined it
 *   remote     -> reportEndCallWithUUID(REMOTE_ENDED)  the other party ended it
 *   unanswered -> reportEndCallWithUUID(UNANSWERED)    caller gave up / timed out
 *
 * remote/unanswered go through reportEndCallWithUUID rather than endCall so
 * CallKit records the actual reason instead of "local user ended it" — get
 * this wrong consistently enough and it can feed into CallKit flagging the
 * app for misuse (reporting calls it never properly resolves).
 */
export function notifyCallEnded(uuid: string, outcome: CallEndOutcome): void {
  if (!CallKeep || !activeCallKitUUIDs.has(uuid)) return;
  activeCallKitUUIDs.delete(uuid);
  try {
    switch (outcome) {
      case "local":
        CallKeep.endCall(uuid);
        break;
      case "decline":
        CallKeep.rejectCall(uuid);
        break;
      case "remote":
        CallKeep.reportEndCallWithUUID(uuid, CallKeepConstants?.END_CALL_REASONS?.REMOTE_ENDED ?? 2);
        break;
      case "unanswered":
        CallKeep.reportEndCallWithUUID(uuid, CallKeepConstants?.END_CALL_REASONS?.UNANSWERED ?? 3);
        break;
    }
  } catch (e) {
    console.warn("[Push] notifyCallEnded failed:", e);
  }
}

function navigateToCall(callId: string, payload: IncomingCallPayload): void {
  router.push({
    pathname: "/call",
    params: {
      alias: payload.from ?? "unknown",
      mode: payload.callMode === "video" ? "video" : "voice",
      role: "callee",
      callId,
    },
  });
}

/**
 * Registers this device for push wake: a regular Expo push token (new
 * message on any platform, incoming-call on Android) and, on iOS, a PushKit
 * VoIP token wired to CallKit (incoming-call wake while fully killed).
 *
 * Neither token is sent anywhere by this hook — the caller is responsible
 * for POSTing them to `/push/:userId/register` alongside the device's auth
 * token, since only the caller knows which alias/token this device is.
 *
 * CallKit/VoIP only activate when react-native-callkeep and
 * react-native-voip-push-notification are actually linked (a custom
 * dev-client/EAS build) — they no-op silently in Expo Go or a build that
 * doesn't include them.
 */
export function usePushNotifications(enabled: boolean, onForceReconnect?: () => void): PushTokens {
  const [tokens, setTokens] = useState<PushTokens>({ expoPushToken: null, voipPushToken: null });

  useEffect(() => {
    if (!enabled) return;

    registerExpoPushTokenAsync()
      .then((expoPushToken) => {
        setTokens((prev) => ({ ...prev, expoPushToken }));
      })
      .catch((e) => {
        console.warn("[Push] Expo push token registration failed:", e);
      });

    const receivedSub = Notifications.addNotificationReceivedListener(() => {});
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as IncomingCallPayload & { type?: string };
      if (data?.type === "incoming-call" && data.callId) {
        navigateToCall(data.callId, data);
      }
    });

    ensureCallKeepSetup();

    if (CallKeep) {
      try {
        CallKeep.addEventListener("answerCall", ({ callUUID }: { callUUID: string }) => {
          // Answering via CallKit's native UI can happen before RN's JS side
          // has observed an AppState "active" transition (e.g. answering
          // from the lock screen on a killed/backgrounded app) — force the
          // WS reconnect now instead of waiting on that listener, or the
          // offer/answer/ICE exchange in call.tsx races a closed socket.
          onForceReconnect?.();
          const payload = pendingCalls.get(callUUID);
          pendingCalls.delete(callUUID);
          navigateToCall(callUUID, payload ?? {});
        });
      } catch (e) {
        console.warn("[Push] CallKeep answerCall listener failed:", e);
      }

      // CallKit owns the AVAudioSession for CallKit-driven calls — react-native-webrtc
      // stays silent (ICE/DTLS connects fine, but no audio in or out) until it's told
      // CallKit has actually activated/deactivated the session.
      if (RTCAudioSession) {
        try {
          CallKeep.addEventListener("didActivateAudioSession", () => {
            RTCAudioSession.audioSessionDidActivate();
          });
          CallKeep.addEventListener("didDeactivateAudioSession", () => {
            RTCAudioSession.audioSessionDidDeactivate();
          });
        } catch (e) {
          console.warn("[Push] CallKeep audio session listeners failed:", e);
        }
      }
    }

    const iosVoipActive = Platform.OS === "ios" && !!VoipPushNotification;

    if (iosVoipActive) {
      try {
        VoipPushNotification.registerVoipToken();

        VoipPushNotification.addEventListener("register", (token: string) => {
          setTokens((prev) => ({ ...prev, voipPushToken: token }));
        });

        const handleIncomingVoipPayload = async (payload: IncomingCallPayload) => {
          // Must be a real UUID, not just unique: this is handed straight to
          // CallKeep.displayIncomingCall below, which iOS parses with
          // NSUUID(uuidString:) — a non-UUID string silently fails there.
          // (payload.callId should always be present in practice — callers
          // generate a real UUID in app/call.tsx — this is a last-resort
          // fallback only.)
          const callId = payload.callId ?? Crypto.randomUUID();
          pendingCalls.set(callId, payload);
          if (CallKeep) {
            // Must not fire before CallKit's native side has finished setup
            // (see ensureCallKeepSetup) — tightest on a cold, killed-app
            // launch, which is exactly when this fires via didLoadWithEvents.
            await ensureCallKeepSetup();
            activeCallKitUUIDs.add(callId);
            CallKeep.displayIncomingCall(
              callId,
              payload.from ?? "Unknown",
              payload.from ?? "Unknown",
              "generic",
              payload.callMode === "video",
            );
          }
        };

        VoipPushNotification.addEventListener("notification", handleIncomingVoipPayload);

        // On a killed-app cold launch, PushKit wakes the process before any JS
        // listener can attach, so the native module queues the payload instead
        // of firing "notification" — then replays the whole queue exactly once,
        // as a single "didLoadWithEvents" event, once a listener exists. Without
        // this, a killed-app incoming call is delivered to APNs (200 OK) but
        // never reaches CallKit — this is that replay path.
        VoipPushNotification.addEventListener(
          "didLoadWithEvents",
          (events: Array<{ name: string; data: IncomingCallPayload }>) => {
            for (const event of events ?? []) {
              if (event.name === VoipPushNotification.RNVoipPushRemoteNotificationReceivedEvent) {
                handleIncomingVoipPayload(event.data);
              }
            }
          },
        );
      } catch (e) {
        console.warn("[Push] VoIP push registration failed:", e);
      }
    }

    return () => {
      receivedSub.remove();
      responseSub.remove();
      if (CallKeep) {
        try {
          CallKeep.removeEventListener("answerCall");
        } catch {
          // best-effort cleanup only
        }
        if (RTCAudioSession) {
          try {
            CallKeep.removeEventListener("didActivateAudioSession");
            CallKeep.removeEventListener("didDeactivateAudioSession");
          } catch {
            // best-effort cleanup only
          }
        }
      }
      if (iosVoipActive) {
        try {
          VoipPushNotification.removeEventListener("register");
          VoipPushNotification.removeEventListener("notification");
          VoipPushNotification.removeEventListener("didLoadWithEvents");
        } catch {
          // best-effort cleanup only
        }
      }
    };
  }, [enabled, onForceReconnect]);

  return tokens;
}
