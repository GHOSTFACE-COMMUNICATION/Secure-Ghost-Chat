/**
 * Canonical form for a callId used as a map/set key.
 *
 * A callId starts life as a lowercase `Crypto.randomUUID()` on the caller,
 * but every value that comes back out of CallKit has been through NSUUID,
 * which re-serialises it uppercase — CallKit's own `answerCall`/`endCall`
 * events, and therefore the `callId` route param on any screen reached from
 * them. The two forms name the same call, and a plain Map/Set does not know
 * that: a lookup with one form silently misses an entry stored under the
 * other, and the miss looks exactly like "this call was never tracked".
 *
 * The concrete failures that caused: an answered CallKit call whose payload
 * lookup missed and so navigated with no call mode (camera never opened,
 * video ended up one-directional), and a hangup whose `notifyCallEnded`
 * found nothing tracked and left the native call UI on screen.
 *
 * Only ever a key normaliser — the original string is what gets handed back
 * to CallKeep, since that is what the platform issued.
 */
export function normalizeCallId(callId: string): string {
  return callId.toLowerCase();
}
