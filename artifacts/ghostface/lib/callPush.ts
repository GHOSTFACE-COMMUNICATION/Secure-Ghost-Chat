import { Platform } from "react-native";
import Constants from "expo-constants";

// Master switch for Phase 2 (call wake-up while the app is closed).
//
// Implementation (task #150): Expo push notifications. When a call-ring
// targets an offline alias, the server sends an identity-free high-priority
// push (see the payload contract below) via Expo's push service. The device
// shows a ringing "Incoming call" notification; opening the app reconnects
// the WebSocket and the server replays the parked call-ring over that
// socket, so the normal in-app incoming-call UI takes over.
//
// iOS VoIP/CallKit considerations (Phase 2 report): a true PushKit VoIP
// push + native CallKit sheet (full-screen ring while locked, no user tap
// needed) requires react-native-callkeep + react-native-voip-push-
// notification, both of which have open New Architecture / Expo SDK 54
// problems. Until those settle, iOS gets a standard high-priority alert
// push (rings/vibrates, user taps to answer) — the same limitation applies
// in Expo Go, where remote push is unsupported entirely (SDK 53+), so
// registration silently no-ops there and dev/production builds are needed.
export const CALLING_PUSH_ENABLED = true;

export type CallPushPlatform = "ios" | "android";

/**
 * Call push payload contract (Phase 2/3).
 *
 * The push itself carries only enough to wake the app and route it to the
 * right call — never anything readable about who's calling. Caller identity
 * (alias) is resolved after wake, in-app, over the existing encrypted
 * WebSocket channel (the server parks the call-ring and replays it when
 * this device's WS authenticates) — never placed in the push payload
 * itself, which transits Expo's push service and APNs/FCM, so it must stay
 * opaque.
 *
 * {
 *   callId: string;        // opaque, server-relayed — same id used by the
 *                           // existing call-ring/call-offer/call-hangup WS
 *                           // signals in app/call.tsx. No PII derivable.
 *   mode: "voice" | "video"; // needed before wake to size the ring UI
 *                           // correctly; not identity-bearing.
 * }
 *
 * Explicitly excluded: caller alias, any user-facing name, phone-number-like
 * identifiers, message/content previews. If a future revision needs more
 * routing data, it must clear the same bar: useless to anyone but this
 * client, holding this callId, already possessing the session keys.
 */
export type VoipPushPayload = {
  callId: string;
  mode: "voice" | "video";
};

/** Android notification channel dedicated to ringing calls. */
export const INCOMING_CALL_CHANNEL_ID = "incoming-calls";

/** True when running in Expo Go, where remote push is unsupported (SDK 53+). */
function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

/**
 * Registers this device's push token with the backend so incoming calls can
 * wake the app when backgrounded/killed. Implements the client side of:
 *
 *   POST {apiBase}/calls/register-voip-token
 *   headers: Authorization: Bearer <device-token>
 *   body: { token: string; platform: "ios" | "android"; alias: string }
 *   response: 204 No Content on success
 *
 * `token` is the Expo push token (ExponentPushToken[...]) — opaque to the
 * client, meaningful only to Expo's push service (which fronts APNs/FCM)
 * and this backend. `alias` is included so the server can route a call-ring
 * for that alias to this token; it is never included in the push payload
 * itself (see VoipPushPayload above) — only used server-side to select
 * which device(s) to push.
 *
 * No-ops on web, in Expo Go, while CALLING_PUSH_ENABLED is false, or when
 * notification permission is denied. Best-effort: failures are swallowed
 * rather than surfaced — a failed registration just means this device won't
 * get a native wake-up call until the next successful registration (e.g.
 * next app foreground).
 */
export async function registerForCallPush(
  apiBase: string,
  alias: string,
  deviceToken: string,
): Promise<void> {
  if (!CALLING_PUSH_ENABLED) return;
  if (Platform.OS === "web") return;
  if (isExpoGo()) return; // remote push unsupported in Expo Go (SDK 53+)
  if (!apiBase || !alias || !deviceToken) return;

  try {
    // Deferred import: expo-notifications touches native modules at import
    // time; keeping it out of the module graph on web/Expo Go avoids noise.
    const Notifications = await import("expo-notifications");

    if (Platform.OS === "android") {
      // MAX importance + default (ringtone-adjacent) sound so an incoming
      // call actually rings and heads-up-displays instead of landing
      // silently in the tray. bypassDnd is intentionally NOT set — respect
      // the user's Do Not Disturb; this is a privacy-first app.
      await Notifications.setNotificationChannelAsync(INCOMING_CALL_CHANNEL_ID, {
        name: "Incoming calls",
        importance: Notifications.AndroidImportance.MAX,
        sound: "default",
        vibrationPattern: [0, 500, 500, 500],
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    const perms = await Notifications.getPermissionsAsync();
    let granted = perms.granted;
    if (!granted && perms.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return;

    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResult.data;
    if (!token) return;

    await registerVoipToken(
      apiBase,
      token,
      Platform.OS === "ios" ? "ios" : "android",
      alias,
      deviceToken,
    );
  } catch {
    // Best-effort — see doc comment above.
  }
}

/**
 * Low-level token registration against the backend contract. Prefer
 * registerForCallPush(), which obtains the token/permissions first.
 */
export async function registerVoipToken(
  apiBase: string,
  token: string,
  platform: CallPushPlatform,
  alias: string,
  deviceToken: string,
): Promise<void> {
  if (!CALLING_PUSH_ENABLED || !apiBase) return;
  try {
    await fetch(`${apiBase}/calls/register-voip-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({ token, platform, alias }),
    });
  } catch {
    // Best-effort — see doc comment above.
  }
}

// ── Still deliberately not wired (blocked on the library decision) ─────────
// - PKPushRegistry VoIP registration + CallKit displayIncomingCall/answer/end
//   (react-native-callkeep / react-native-voip-push-notification — both have
//   open New Architecture / Expo SDK 54 problems; revisit when fixed)
// - Android ConnectionService / Core-Telecom full-screen ring
// The Expo alert push above is the interim wake path on both platforms.
