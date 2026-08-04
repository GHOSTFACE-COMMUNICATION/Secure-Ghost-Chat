import { getApiBase } from "@/context/AppContext";

// Master switch for Phase 2 (native call wake-up). Stays false until a
// CallKit/PushKit library has been chosen (see the Phase 2 compatibility
// report — react-native-callkeep and react-native-voip-push-notification
// both have open New Architecture / Expo SDK 54 problems) and Phase 3's
// server-side token registry exists. While false, nothing in this module
// registers for VoIP pushes or touches CallKit; the existing WS-based call
// flow in app/call.tsx is unaffected either way.
export const CALLING_PUSH_ENABLED = false;

export type CallPushPlatform = "ios" | "android";

/**
 * VoIP push payload contract (Phase 2/3).
 *
 * The push itself carries only enough to wake the app and route it to the
 * right call — never anything readable about who's calling. Caller identity
 * (alias) is resolved after wake, in-app, over the existing encrypted
 * WebSocket channel (the same call-ring/call-offer signal path already used
 * in app/call.tsx) — never placed in the push payload itself, which transits
 * Apple's/Google's servers unencrypted-to-us (APNs VoIP pushes are encrypted
 * in transit to the device, but the payload is still visible to the push
 * infrastructure and to Apple, so it must stay opaque).
 *
 * {
 *   callId: string;        // opaque, server-generated — same id used by the
 *                           // existing call-ring/call-offer/call-hangup WS
 *                           // signals in app/call.tsx. No PII derivable.
 *   mode: "voice" | "video"; // needed before wake to size the CallKit sheet
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

/**
 * Registers this device's VoIP push token with the backend so incoming
 * calls can wake the app when backgrounded/killed. Phase 3 implements the
 * server side — this defines the client-side contract only:
 *
 *   POST {apiBase}/calls/register-voip-token
 *   body: { token: string; platform: "ios" | "android"; alias: string }
 *   response: 204 No Content on success
 *
 * `token` is the raw PKPushRegistry (iOS) or FCM (Android) token — opaque
 * to the client, meaningful only to APNs/FCM and this backend. `alias` is
 * included so the server can route a call-ring for that alias to this
 * token; it is never included in the push payload itself (see
 * VoipPushPayload above) — only used server-side to select which device(s)
 * to push.
 *
 * No-ops while CALLING_PUSH_ENABLED is false. Best-effort: failures are
 * swallowed rather than surfaced, matching the pattern used for the
 * existing alias-availability check in app/onboarding.tsx — a failed
 * registration just means this device won't get a native wake-up call
 * until the next successful registration (e.g. next app foreground).
 */
export async function registerVoipToken(token: string, platform: CallPushPlatform, alias: string): Promise<void> {
  if (!CALLING_PUSH_ENABLED) return;
  const apiBase = getApiBase();
  if (!apiBase) return;
  try {
    await fetch(`${apiBase}/calls/register-voip-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform, alias }),
    });
  } catch {
    // Best-effort — see doc comment above.
  }
}

// ── Not yet wired (blocked on the library decision — see Phase 2 report) ──
// - PKPushRegistry registration + didUpdatePushCredentials / didReceiveIncomingPushWithPayload
//   (would come from react-native-voip-push-notification or an alternative)
// - CallKit displayIncomingCall / answer / end action handlers
//   (would come from react-native-callkeep or an alternative)
// - Android ConnectionService / Core-Telecom + FCM high-priority arrival
// None of the above are imported or called anywhere in this module.
