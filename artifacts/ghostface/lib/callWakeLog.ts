/**
 * TEMPORARY DIAGNOSTIC — locked-device call teardown (smoke test, 2 Sep 2026).
 *
 * THE SYMPTOM: a receiving device that is LOCKED keeps ringing after the caller
 * hangs up. Backgrounded-but-unlocked reportedly tears down correctly.
 *
 * THE SHAPE OF THE BUG: ring and hangup use different transports.
 *   `call-ring`   → VoIP push (PushKit) → wakes the device → CallKit rings.
 *   `call-hangup` → NOT pushed. Queued server-side (src/ws/manager.ts) and
 *                   flushed only "when the socket authenticates".
 * So teardown depends entirely on the callee's WebSocket coming up. The client
 * already tries: usePushNotifications calls onForceReconnect() the instant
 * CallKit is told to ring, precisely so a hangup has somewhere to land.
 *
 * THE HYPOTHESIS THIS LOG EXISTS TO TEST: that reconnect cannot authenticate
 * while the device is locked, because the device token lives in SecureStore and
 * nothing in this codebase ever passes `keychainAccessible` — expo-secure-store
 * then defaults to WHEN_UNLOCKED, which is unreadable on a locked device. No
 * token → no auth → the queued hangup never flushes → CallKit rings on.
 *
 * It is a HYPOTHESIS. It has not been confirmed on hardware, which is the whole
 * point of this file. The chain has four links and any one of them could be the
 * break; this logs all four so one locked repro identifies which.
 *
 * HOW TO READ IT: reproduce with the callee LOCKED, then read the device log
 * (Console.app, or `xcrun devicectl`) filtered on [CALLWAKE]. Expect, in order:
 *
 *   voip-push          → PushKit woke us
 *   force-reconnect    → the client asked for a socket
 *   token-read         → ok:true/false  ← if false while locked, hypothesis CONFIRMED
 *   ws-open / ws-auth  → did the socket actually come up and authenticate
 *   hangup-received    → the teardown message finally arrived
 *
 * Whichever line is MISSING is the broken link. If token-read logs ok:false
 * only in the locked run, the fix is keychain accessibility, not call logic.
 *
 * ⚠️ NEVER logs a token, key, or any payload body — only ids, booleans and
 * states. This is a privacy product and diagnostics are not an exception.
 *
 * ⚠️ REMOVE THIS FILE once the locked-device teardown is fixed and re-tested.
 * Tracked on the board. A diagnostic left in place becomes noise, and noise in
 * a call path is how the last one hid.
 */
const TAG = "[CALLWAKE]";

export function callWakeLog(event: string, detail?: Record<string, unknown>) {
  try {
    const at = new Date().toISOString();
    console.warn(`${TAG} ${event}`, JSON.stringify({ at, ...(detail ?? {}) }));
  } catch {
    // A diagnostic must never be able to break the path it is diagnosing.
  }
}
