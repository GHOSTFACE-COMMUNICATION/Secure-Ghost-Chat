import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

/* eslint-disable @typescript-eslint/no-explicit-any -- native-module interop: react-native-callkeep
   and react-native-voip-push-notification are optional native modules that only exist in a custom
   dev-client/EAS build, never in Expo Go. Same dynamic-require + graceful-fallback pattern as
   react-native-webrtc in app/call.tsx. */
let CallKeep: any = null;
try {
  CallKeep = require("react-native-callkeep").default;
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

/** Idempotent — safe to call every time the hook mounts. */
function ensureCallKeepSetup(): void {
  if (!CallKeep || callKeepReady) return;
  try {
    CallKeep.setup(CALLKEEP_OPTIONS);
    CallKeep.setAvailable(true);
    callKeepReady = true;
  } catch (e) {
    console.warn("[Push] CallKeep setup failed:", e);
  }
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
  if (finalStatus !== "granted") return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;

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
export function usePushNotifications(enabled: boolean): PushTokens {
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

        VoipPushNotification.addEventListener("notification", (payload: IncomingCallPayload) => {
          const callId = payload.callId ?? String(Date.now());
          pendingCalls.set(callId, payload);
          if (CallKeep) {
            CallKeep.displayIncomingCall(
              callId,
              payload.from ?? "Unknown",
              payload.from ?? "Unknown",
              "generic",
              payload.callMode === "video",
            );
          }
        });
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
        } catch {
          // best-effort cleanup only
        }
      }
    };
  }, [enabled]);

  return tokens;
}
