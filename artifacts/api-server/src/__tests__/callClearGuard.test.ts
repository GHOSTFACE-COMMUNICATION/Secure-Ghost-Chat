import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// clearCallsForAlias must not release a call that started AFTER the socket
// being torn down had already closed.
//
// The ordering this guards (see the comment on clearCallsForAlias):
//
//   T0  A's socket S1 closes
//   T1  B calls A — the call is parked, PushKit wakes A
//   T2  S1's cleanup runs; A is not back yet, so it is still the holder and
//       the connId guard in cleanup() does NOT stop it
//   T3  A reconnects, the parked ring re-checks, finds the entry gone, and
//       sends a hangup instead of a ring
//
// call2 was never S1's to release. Without the cutoff, a successful PushKit
// wake ends in a hangup — the "woke up, got a hangup" half of the unreliable
// VoIP symptom.
//
// These exercise the in-process fallback (no REDIS_URL), which is the same
// branch dev and single-replica deployments take.
// ---------------------------------------------------------------------------

vi.mock("../lib/redis", () => ({
  getRedis: () => null,
  isRedisHealthy: () => false,
}));

import {
  setActiveCall,
  getActiveCall,
  clearCallsForAlias,
  type ActiveCall,
} from "../ws/sharedState";

const PAIR = "alice|bob";

function call(callId: string, startedAt: number): ActiveCall {
  return { callId, caller: "BOB", callee: "ALICE", startedAt };
}

describe("clearCallsForAlias — teardown cutoff", () => {
  beforeEach(async () => {
    await clearCallsForAlias("ALICE");
    await clearCallsForAlias("BOB");
  });

  it("does NOT clear a call that started after the socket closed", async () => {
    const socketClosedAt = 1_000_000;
    // The call arrives 5s after S1 closed — this is the PushKit wake in flight.
    await setActiveCall(PAIR, call("call-2", socketClosedAt + 5_000));

    await clearCallsForAlias("ALICE", socketClosedAt);

    const still = await getActiveCall(PAIR);
    expect(still).not.toBeNull();
    expect(still?.callId).toBe("call-2");
  });

  it("clears a call that was already running when the socket closed", async () => {
    const socketClosedAt = 1_000_000;
    // Started 5s BEFORE the close: this really was S1's call, and leaving it
    // would lock the pair until MAX_CALL_AGE_MS ages it out.
    await setActiveCall(PAIR, call("call-1", socketClosedAt - 5_000));

    await clearCallsForAlias("ALICE", socketClosedAt);

    expect(await getActiveCall(PAIR)).toBeNull();
  });

  it("clears unconditionally when no cutoff is given", async () => {
    await setActiveCall(PAIR, call("call-3", Date.now() + 60_000));

    await clearCallsForAlias("ALICE");

    expect(await getActiveCall(PAIR)).toBeNull();
  });

  it("applies the cutoff whichever side of the call the alias is on", async () => {
    const socketClosedAt = 1_000_000;
    await setActiveCall(PAIR, call("call-4", socketClosedAt + 1));

    // BOB is the caller here, ALICE the callee; the guard is about the call's
    // age relative to the teardown, not about which party dropped.
    await clearCallsForAlias("BOB", socketClosedAt);

    expect((await getActiveCall(PAIR))?.callId).toBe("call-4");
  });

  it("leaves an unrelated alias's call alone", async () => {
    await setActiveCall("carol|dave", {
      callId: "other",
      caller: "CAROL",
      callee: "DAVE",
      startedAt: 1,
    });

    await clearCallsForAlias("ALICE");

    expect((await getActiveCall("carol|dave"))?.callId).toBe("other");
  });
});
