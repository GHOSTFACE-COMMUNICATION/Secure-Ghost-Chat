import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// A socket teardown must not release the alias's call while that alias is
// merely RECONNECTING.
//
// Production trace, 30 Aug 00:41:26.844 → 00:41:27.361:
//
//   call-ring  GHOSTFACE -> N0GANG
//   Call cleared on socket teardown  alias=N0GANG callId=6ec056c8 ageMs=529
//   call-hangup queued for offline callee
//
// The call was 529ms old when a teardown deleted its pair entry. N0GANG had
// authenticated three times in 38s, hopping replicas, and every one of those
// teardowns cleared any in-flight call for that alias — the churn was killing
// the calls, not anything in the call path.
//
// The release is now deferred by CALL_CLEAR_GRACE_MS and cancelled if the
// alias comes back.
// ---------------------------------------------------------------------------

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

vi.mock("../utils/delivery", () => ({
  ensureDeliveryId: async () => null,
  pushTokensForAlias: async () => null,
  pushTokensForDeliveryId: async () => null,
  clearExpoPushTokenForAlias: async () => undefined,
  clearVoipPushTokenForAlias: async () => undefined,
  clearExpoPushTokenForDeliveryId: async () => undefined,
}));

vi.mock("../lib/pushNotifications", () => ({
  sendVoipPushIOS: async () => ({ ok: true, invalidToken: false }),
  sendExpoPush: async () => ({ ok: false, invalidToken: false }),
}));

// Shrink the release window so this runs in milliseconds. Must be set before
// the module under test is imported.
const GRACE_MS = 300;
process.env.CALL_CLEAR_GRACE_MS = String(GRACE_MS);

const { createWsServer } = await import("../ws/manager.js");
const { getActiveCall } = await import("../ws/sharedState.js");

// Mirrors callPairKey in manager.ts (sorted, colon-joined).
const pairKey = (a: string, b: string) => [a, b].sort().join(":");

interface FakeWs {
  readyState: number;
  sent: string[];
  listeners: Map<string, ((arg?: unknown) => void)[]>;
  send: (raw: string, cb?: (err?: Error) => void) => void;
  close: () => void;
  terminate: () => void;
  ping: () => void;
  on: (evt: string, cb: (arg?: unknown) => void) => void;
}

function makeWs(): FakeWs {
  const listeners = new Map<string, ((arg?: unknown) => void)[]>();
  return {
    readyState: 1,
    sent: [],
    listeners,
    send(raw, cb) {
      this.sent.push(raw);
      cb?.();
    },
    close() {
      this.readyState = 3;
    },
    terminate() {
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
  const handlers: ((ws: FakeWs) => void)[] = [];
  return {
    clients: new Set<FakeWs>(),
    on(evt: string, cb: (...args: unknown[]) => void) {
      if (evt === "connection") handlers.push(cb as (ws: FakeWs) => void);
    },
    connect(ws: FakeWs) {
      this.clients.add(ws);
      for (const cb of handlers) cb(ws);
    },
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function authAs(ws: FakeWs, alias: string) {
  const token = `tok-${alias}`;
  deviceTokens.length = 0;
  deviceTokens.push({ userId: alias, tokenHash: createHash("sha256").update(token).digest("hex") });
  fire(ws, "message", JSON.stringify({ type: "auth", alias, token }));
  await flush();
}

/** Connect caller + callee, park a call between them, then drop the callee. */
async function ringThenDropCallee(caller: string, callee: string, callId: string) {
  const wss = makeWss();
  createWsServer(wss as never);

  const calleeWs = makeWs();
  wss.connect(calleeWs);
  await authAs(calleeWs, callee);

  const callerWs = makeWs();
  wss.connect(callerWs);
  await authAs(callerWs, caller);

  fire(callerWs, "message", JSON.stringify({ type: "call-ring", to: callee, callId, callMode: "voice" }));
  await flush();
  expect(await getActiveCall(pairKey(caller, callee))).not.toBeNull();

  calleeWs.readyState = 3;
  fire(calleeWs, "close");
  await flush();

  return { wss, callerWs, calleeWs };
}

describe("deferred call release on socket teardown", () => {
  beforeEach(() => {
    deviceTokens.length = 0;
    vi.clearAllMocks();
  });

  it("does not release the call synchronously on teardown", async () => {
    await ringThenDropCallee("ALICE", "BOB", "call-sync");

    // This is the production failure: the entry was gone 529ms after ringing.
    const still = await getActiveCall(pairKey("ALICE", "BOB"));
    expect(still).not.toBeNull();
    expect(still?.callId).toBe("call-sync");
  });

  it("releases the call once the window passes and the alias is still gone", async () => {
    await ringThenDropCallee("CARA", "DAVE", "call-gone");

    await sleep(GRACE_MS * 2);
    await flush();

    // The pair lock must not survive a callee who really did leave, or neither
    // party can call the other until MAX_CALL_AGE_MS ages it out.
    expect(await getActiveCall(pairKey("CARA", "DAVE"))).toBeNull();
  });

  it("cancels the release when the alias reconnects inside the window", async () => {
    const { wss } = await ringThenDropCallee("ERIN", "FRED", "call-churn");

    // FRED comes straight back, exactly as N0GANG did three times in 38s.
    const fredAgain = makeWs();
    (wss as unknown as { connect: (w: FakeWs) => void }).connect(fredAgain);
    await authAs(fredAgain, "FRED");

    await sleep(GRACE_MS * 2);
    await flush();

    const survived = await getActiveCall(pairKey("ERIN", "FRED"));
    expect(survived).not.toBeNull();
    expect(survived?.callId).toBe("call-churn");
  });
});
