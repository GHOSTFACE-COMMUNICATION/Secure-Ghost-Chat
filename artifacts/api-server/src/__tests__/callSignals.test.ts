import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Regression tests for the "zombie ring" bug: a caller who hangs up while
// the callee is still offline/waking (CallKit ringing from a VoIP push, app
// not yet connected) used to have the hangup silently dropped, and the
// parked call-ring was then delivered to the callee AFTER the call had
// already ended — resurrecting a dead call on the callee's screen whose
// answer signals bounced back at a caller who'd left.
//
// Fixes under test (src/ws/manager.ts):
//   1. call-hangup to an offline callee is queued (TTL'd) and delivered the
//      moment that callee's socket authenticates.
//   2. a parked call-ring re-checks activeCallsByPair after waitForReconnect;
//      if the hangup cleared the entry meanwhile, the ring is NOT relayed —
//      the callee gets a call-hangup instead, and the caller does NOT get a
//      spurious "offline" bounce.
// ---------------------------------------------------------------------------

// In-memory state for the mocked db (only what validateToken needs).
const deviceTokens: { userId: string; tokenHash: string }[] = [];

vi.mock("@workspace/db", () => {
  const TABLE_DEVICE_TOKENS = Symbol("deviceTokens");
  const emptyWhereable = { where: () => Promise.resolve([]) };
  const db = {
    select: () => ({
      from: (tbl: unknown) =>
        tbl === TABLE_DEVICE_TOKENS
          ? { where: () => Promise.resolve([...deviceTokens]) }
          : emptyWhereable,
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
  };
  return {
    db,
    deviceTokensTable: TABLE_DEVICE_TOKENS,
    messagesTable: Symbol("messages"),
    departuresTable: Symbol("departures"),
    identityKeysTable: Symbol("identityKeys"),
  };
});

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Push/delivery layer: fully controlled. `voipTokenAlias` gates whether the
// call-ring wake path parks in waitForReconnect (token + successful push) or
// falls straight through — set to the alias that should appear to have a
// registered VoIP token for a given test.
let voipTokenAlias: string | null = null;
const sentVoipPushes: unknown[] = [];

vi.mock("../utils/delivery", () => ({
  ensureDeliveryId: async () => null,
  pushTokensForAlias: async (alias: string) =>
    alias === voipTokenAlias ? { voipPushToken: `voip-tok-${alias.toLowerCase()}`, expoPushToken: null } : null,
  pushTokensForDeliveryId: async () => null,
  clearExpoPushTokenForAlias: async () => undefined,
  clearVoipPushTokenForAlias: async () => undefined,
  clearExpoPushTokenForDeliveryId: async () => undefined,
}));

vi.mock("../lib/pushNotifications", () => ({
  sendVoipPushIOS: async (_token: string, payload: unknown) => {
    sentVoipPushes.push(payload);
    return { ok: true, invalidToken: false };
  },
  sendExpoPush: async () => ({ ok: false, invalidToken: false }),
}));

// Shrink the cold-start wake window so the bounce path is testable in
// milliseconds. Must be set before the module under test is imported.
const CALL_WAKE_GRACE_MS_TEST = 600;
// waitForReconnect polls every 500ms, so it can overshoot the grace window by
// most of one poll before it gives up; wait past that, not just past the grace.
const CALL_WAKE_POLL_SLACK_MS = 900;
process.env.CALL_WAKE_GRACE_MS = String(CALL_WAKE_GRACE_MS_TEST);

// Import the module-under-test AFTER mocks.
const { createWsServer } = await import("../ws/manager.js");

// ── Fake WebSocket / WebSocketServer (same shape as departures.test.ts) ────
interface FakeWs {
  readyState: number;
  /** Number of upcoming sends to fail (callback gets an Error, frame dropped). */
  failSends: number;
  sent: string[];
  closed: boolean;
  listeners: Map<string, ((arg?: unknown) => void)[]>;
  send: (raw: string, cb?: (err?: Error) => void) => void;
  close: (code?: number, reason?: string) => void;
  terminate: () => void;
  ping: () => void;
  on: (evt: string, cb: (arg?: unknown) => void) => void;
}

function makeWs(): FakeWs {
  const listeners = new Map<string, ((arg?: unknown) => void)[]>();
  return {
    readyState: 1,
    failSends: 0,
    sent: [],
    closed: false,
    listeners,
    send(raw: string, cb?: (err?: Error) => void) {
      if (this.failSends > 0) {
        this.failSends -= 1;
        cb?.(new Error("simulated write failure"));
        return;
      }
      this.sent.push(raw);
      // The real `ws` invokes this callback once the frame is written, and the
      // router relies on it to confirm delivery. A fake that drops it leaves
      // that promise pending forever.
      cb?.();
    },
    close() {
      this.closed = true;
      this.readyState = 3;
    },
    terminate() {
      this.closed = true;
      this.readyState = 3;
    },
    ping() {},
    on(evt, cb) {
      const arr = listeners.get(evt) ?? [];
      arr.push(cb);
      listeners.set(evt, arr);
    },
  };
}

function fire(ws: FakeWs, evt: string, arg?: unknown) {
  for (const cb of ws.listeners.get(evt) ?? []) cb(arg);
}

function makeWss() {
  const connectionHandlers: ((ws: FakeWs) => void)[] = [];
  return {
    clients: new Set<FakeWs>(),
    on(evt: string, cb: (...args: unknown[]) => void) {
      if (evt === "connection") connectionHandlers.push(cb as (ws: FakeWs) => void);
    },
    connect(ws: FakeWs) {
      this.clients.add(ws);
      for (const cb of connectionHandlers) cb(ws);
    },
  };
}

function sentOfType(ws: FakeWs, type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const raw of ws.sent) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.type === type) out.push(parsed);
    } catch {
      /* ignore */
    }
  }
  return out;
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  // Then yield the macrotask queue once, which drains every microtask still
  // pending. Counting microtask turns is fragile: it silently breaks whenever
  // the code under test grows an await, which is exactly what happened when
  // the WS handlers moved to Redis-backed shared state.
  await new Promise((resolve) => setImmediate(resolve));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function authAs(ws: FakeWs, alias: string) {
  const token = `tok-${alias}`;
  const hash = createHash("sha256").update(token).digest("hex");
  deviceTokens.length = 0;
  deviceTokens.push({ userId: alias, tokenHash: hash });
  fire(ws, "message", JSON.stringify({ type: "auth", alias, token }));
  await flush();
}

// ---------------------------------------------------------------------------

describe("ws/manager.ts call-signal hangup/ring ordering", () => {
  beforeEach(() => {
    deviceTokens.length = 0;
    sentVoipPushes.length = 0;
    voipTokenAlias = null;
    vi.clearAllMocks();
  });

  it("relays a normal call-ring to an online callee (happy path untouched)", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    const bob = makeWs();
    wss.connect(bob);
    await authAs(bob, "BOB");

    const alice = makeWs();
    wss.connect(alice);
    await authAs(alice, "ALICE");

    fire(alice, "message", JSON.stringify({ type: "call-ring", to: "BOB", callId: "call-1", callMode: "voice" }));
    await flush();

    expect(sentOfType(bob, "call-ring")).toHaveLength(1);
    expect(sentOfType(alice, "call-hangup")).toHaveLength(0);

    // Cleanup so the pair entry doesn't leak into later tests.
    fire(alice, "message", JSON.stringify({ type: "call-hangup", to: "BOB", callId: "call-1" }));
    await flush();
  });

  it("queues a call-hangup for an offline callee and delivers it when they connect", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    // DAN/EVE are unique to this test — ALICE/BOB stay connected (never
    // fire "close") from the previous test, so reusing them here would let
    // this "offline callee" scenario silently resolve against a stale,
    // still-open socket instead of exercising the queue.
    const dan = makeWs();
    wss.connect(dan);
    await authAs(dan, "DAN");

    // Eve is offline, no push token: hangup can't be relayed anywhere.
    fire(dan, "message", JSON.stringify({ type: "call-hangup", to: "EVE", callId: "call-2" }));
    await flush();

    // Eve connects later — the held hangup must arrive on auth.
    const eve = makeWs();
    wss.connect(eve);
    await authAs(eve, "EVE");

    const hangups = sentOfType(eve, "call-hangup");
    expect(hangups).toHaveLength(1);
    expect(hangups[0].callId).toBe("call-2");
    expect(hangups[0].from).toBe("DAN");
  });

  it("does not deliver the same queued hangup twice", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    const alice = makeWs();
    wss.connect(alice);
    await authAs(alice, "ALICE");

    fire(alice, "message", JSON.stringify({ type: "call-hangup", to: "CARL", callId: "call-3" }));
    fire(alice, "message", JSON.stringify({ type: "call-hangup", to: "CARL", callId: "call-3" }));
    await flush();

    const carl = makeWs();
    wss.connect(carl);
    await authAs(carl, "CARL");
    expect(sentOfType(carl, "call-hangup")).toHaveLength(1);

    // Reconnecting again gets nothing — the queue drained.
    const carl2 = makeWs();
    wss.connect(carl2);
    await authAs(carl2, "CARL");
    expect(sentOfType(carl2, "call-hangup")).toHaveLength(0);
  });

  // The reported bug: "callee still not dropping after caller hangs up on
  // ring". The callee is CONNECTED (woken by the VoIP push and back on a
  // socket) but the hangup relay fails anyway — the write races the callee's
  // registration, or their socket is held by another replica whose delivery
  // has not settled. The hangup then lands in the deferred queue, which used
  // to be drained only on `auth`. The callee already authenticated, so nothing
  // would ever read it: their CallKit banner rang on until the ring timed out.
  it("flushes a queued hangup to a callee who is already online (drain/queue race)", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    const hal = makeWs();
    wss.connect(hal);
    await authAs(hal, "HAL"); // drains an empty queue

    const ivy = makeWs();
    wss.connect(ivy);
    await authAs(ivy, "IVY");

    // Hal's next write fails, so the relay reports undelivered and the hangup
    // is queued even though Hal is online and stays online.
    hal.failSends = 1;
    fire(ivy, "message", JSON.stringify({ type: "call-hangup", to: "HAL", callId: "call-5" }));
    await flush();

    const hangups = sentOfType(hal, "call-hangup");
    expect(hangups).toHaveLength(1);
    expect(hangups[0].callId).toBe("call-5");
    expect(hangups[0].from).toBe("IVY");
  });

  it("keeps a hangup queued when the flush cannot reach the callee either", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    const jan = makeWs();
    wss.connect(jan);
    await authAs(jan, "JAN");

    const kim = makeWs();
    wss.connect(kim);
    await authAs(kim, "KIM");

    // Both the relay and the flush retry fail: presence says online, the
    // socket disagrees. The hangup must survive to Kim's next connection
    // rather than being consumed by the destructive drain.
    kim.failSends = 2;
    fire(jan, "message", JSON.stringify({ type: "call-hangup", to: "KIM", callId: "call-6" }));
    await flush();
    expect(sentOfType(kim, "call-hangup")).toHaveLength(0);

    const kim2 = makeWs();
    wss.connect(kim2);
    await authAs(kim2, "KIM");
    const hangups = sentOfType(kim2, "call-hangup");
    expect(hangups).toHaveLength(1);
    expect(hangups[0].callId).toBe("call-6");
  });

  // Cold start: the callee's app was killed, PushKit woke it, CallKit is
  // ringing — but the launch takes longer than the wake grace window, so the
  // ring bounces "offline" at the caller. The banner on the callee's phone
  // outlives that bounce, and nothing used to cancel it: they answered into a
  // call nobody was on, or waited out CallKit's own timeout.
  it("queues a hangup for a push-woken callee whose ring bounced before they launched", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    voipTokenAlias = "NED";

    const mia = makeWs();
    wss.connect(mia);
    await authAs(mia, "MIA");

    fire(
      mia,
      "message",
      JSON.stringify({ type: "call-ring", to: "NED", callId: "call-7", callMode: "voice" }),
    );
    // Ned never shows up inside the grace window, so the ring bounces.
    await sleep(CALL_WAKE_GRACE_MS_TEST + CALL_WAKE_POLL_SLACK_MS);
    await flush();
    expect(sentVoipPushes).toHaveLength(1);
    expect(sentOfType(mia, "call-hangup").filter((h) => h.payload === "offline")).toHaveLength(1);

    // Ned's cold start finally finishes. The banner is still up — the hangup
    // has to be waiting for him.
    const ned = makeWs();
    wss.connect(ned);
    await authAs(ned, "NED");
    const hangups = sentOfType(ned, "call-hangup");
    expect(hangups).toHaveLength(1);
    expect(hangups[0].callId).toBe("call-7");
    expect(hangups[0].from).toBe("MIA");
  });

  it("drops a parked call-ring whose call was hung up during the wake wait; callee gets hangup, caller gets no offline bounce", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    // FAY/GUS are unique to this test for the same reason as DAN/EVE above:
    // GUS must be genuinely offline (not in connectedClients) for the push
    // wake path to trigger at all.
    voipTokenAlias = "GUS";

    const fay = makeWs();
    wss.connect(fay);
    await authAs(fay, "FAY");

    // Ring an offline Gus who has a VoIP token: the push "succeeds" and the
    // handler parks in waitForReconnect (500ms poll).
    fire(fay, "message", JSON.stringify({ type: "call-ring", to: "GUS", callId: "call-4", callMode: "voice" }));
    await flush();
    expect(sentVoipPushes).toHaveLength(1);

    // Caller hangs up while the ring is parked.
    fire(fay, "message", JSON.stringify({ type: "call-hangup", to: "GUS", callId: "call-4" }));
    await flush();

    // Gus's device wakes (CallKit was ringing) and connects.
    const gus = makeWs();
    wss.connect(gus);
    await authAs(gus, "GUS");

    // Give waitForReconnect at least one full poll cycle to notice Gus.
    await sleep(700);
    await flush();

    // The dead ring must NOT be delivered; a hangup must be (deferred-queue
    // delivery on auth; the stale-ring guard may add a harmless duplicate).
    expect(sentOfType(gus, "call-ring")).toHaveLength(0);
    expect(sentOfType(gus, "call-hangup").length).toBeGreaterThanOrEqual(1);
    expect(sentOfType(gus, "call-hangup")[0].callId).toBe("call-4");

    // And the caller is NOT told "offline" — they ended the call themselves.
    const fayHangups = sentOfType(fay, "call-hangup");
    expect(fayHangups.filter((h) => h.payload === "offline")).toHaveLength(0);
  });
});
