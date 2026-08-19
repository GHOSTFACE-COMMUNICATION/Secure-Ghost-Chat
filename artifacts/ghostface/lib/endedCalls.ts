/**
 * Short-lived record of callIds whose call-hangup has already been seen.
 *
 * Why this exists (zombie-join bug): a callee's phone can ring via CallKit
 * long after the caller hung up — the hangup can't reach a device whose app
 * isn't running, so it's queued server-side and delivered on the socket's
 * next auth. Answering that ring cold-launches the app, and CallKeep's
 * "answerCall" fires BEFORE the WS has connected: the app used to navigate
 * straight into call.tsx as callee and sit in "JOINING…" against a caller
 * who left minutes ago, until the 30s connecting-timeout fired a
 * call-hangup back at the caller (which their device then mis-logged as a
 * missed incoming call).
 *
 * AppContext marks every received call-hangup here; the CallKit answer
 * path and call.tsx's mount check it and bail out of already-dead calls
 * immediately instead of joining them.
 *
 * Module singleton on purpose — needed by AppContext, usePushNotifications,
 * and call.tsx without threading through React context, and its lifetime
 * (process) matches the CallKit windows it guards. TTL keeps it from
 * growing; case-insensitive because CallKit round-trips UUIDs through
 * NSUUID, which does not preserve case.
 */

const ENDED_CALL_TTL_MS = 5 * 60_000;
const endedCalls = new Map<string, number>(); // normalized callId -> endedAt

function normalize(callId: string): string {
  return callId.toLowerCase();
}

function prune(now: number): void {
  for (const [id, at] of endedCalls) {
    if (now - at >= ENDED_CALL_TTL_MS) endedCalls.delete(id);
  }
}

export function markCallEnded(callId: string | undefined | null): void {
  if (!callId) return;
  const now = Date.now();
  prune(now);
  endedCalls.set(normalize(callId), now);
}

export function wasCallEnded(callId: string | undefined | null): boolean {
  if (!callId) return false;
  const at = endedCalls.get(normalize(callId));
  if (at === undefined) return false;
  if (Date.now() - at >= ENDED_CALL_TTL_MS) {
    endedCalls.delete(normalize(callId));
    return false;
  }
  return true;
}
