import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// A WS auth attempt has three outcomes, and the client acts on two of them
// very differently: a rejection (4001) makes it discard its device token and
// re-register, which — when the alias is still bound to the token it just
// threw away — ends in "Device not linked to this alias" and a client that
// stops reconnecting entirely.
//
// So a database fault during the token lookup must NOT be reported as a
// rejection. It used to be: validateToken swallowed the throw and returned
// false. A cold-start ring is exactly when that misfires — several sockets
// authenticate at once against a cold pool, and one timed-out lookup knocked
// the receiver out of the app.
// ---------------------------------------------------------------------------

const deviceTokens: { userId: string; tokenHash: string }[] = [];
// Flipped on to make the device-token lookup throw, standing in for a pool
// timeout / connection reset during the handshake.
let dbFaulty = false;

vi.mock("@workspace/db", () => {
  const TABLE_DEVICE_TOKENS = Symbol("deviceTokens");
  const emptyWhereable = { where: () => Promise.resolve([]) };
  const db = {
    select: () => ({
      from: (tbl: unknown) =>
        tbl === TABLE_DEVICE_TOKENS
          ? {
              where: () =>
                dbFaulty
                  ? Promise.reject(new Error("timeout acquiring a connection from the pool"))
                  : Promise.resolve([...deviceTokens]),
            }
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

const { createWsServer } = await import("../ws/manager.js");

interface FakeWs {
  readyState: number;
  failSends: number;
  sent: string[];
  closed: boolean;
  closeCode: number | null;
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
    closeCode: null,
    listeners,
    send(raw: string, cb?: (err?: Error) => void) {
      this.sent.push(raw);
      cb?.();
    },
    close(code?: number) {
      this.closed = true;
      this.closeCode = code ?? null;
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

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function errorsOn(ws: FakeWs): string[] {
  return ws.sent
    .map((raw) => {
      try {
        return JSON.parse(raw) as { type?: string; message?: string };
      } catch {
        return {};
      }
    })
    .filter((m) => m.type === "error")
    .map((m) => m.message ?? "");
}

function authFrame(alias: string, token: string): string {
  return JSON.stringify({ type: "auth", alias, token });
}

function registerToken(alias: string, token: string) {
  deviceTokens.length = 0;
  deviceTokens.push({ userId: alias, tokenHash: createHash("sha256").update(token).digest("hex") });
}

describe("ws/manager.ts auth outcomes", () => {
  beforeEach(() => {
    deviceTokens.length = 0;
    dbFaulty = false;
    vi.clearAllMocks();
  });

  it("accepts a valid credential", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    const ws = makeWs();
    wss.connect(ws);
    registerToken("ANA", "tok-ANA");
    fire(ws, "message", authFrame("ANA", "tok-ANA"));
    await flush();

    expect(ws.closed).toBe(false);
    expect(errorsOn(ws)).toHaveLength(0);
  });

  it("rejects a credential with no matching device token with 4001", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    const ws = makeWs();
    wss.connect(ws);
    // No row for this alias/token pair: the lookup succeeds and finds
    // nothing, which is a genuine rejection (stale install, reused alias).
    deviceTokens.length = 0;
    fire(ws, "message", authFrame("BEN", "tok-BEN"));
    await flush();

    expect(ws.closeCode).toBe(4001);
    expect(errorsOn(ws)).toContain("auth failed");
  });

  it("reports a database fault as unavailable, not as a rejection", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    const ws = makeWs();
    wss.connect(ws);
    registerToken("CAI", "tok-CAI");
    dbFaulty = true; // the credential is good; the server just cannot check it
    fire(ws, "message", authFrame("CAI", "tok-CAI"));
    await flush();

    // 4001 is the code that makes the client throw its device token away.
    expect(ws.closeCode).not.toBe(4001);
    expect(ws.closeCode).toBe(4003);
    const errors = errorsOn(ws);
    expect(errors).toContain("auth unavailable");
    expect(errors).not.toContain("auth failed");
  });

  it("accepts the same credential once the database recovers", async () => {
    const wss = makeWss();
    createWsServer(wss as never);
    registerToken("DEE", "tok-DEE");

    const first = makeWs();
    wss.connect(first);
    dbFaulty = true;
    fire(first, "message", authFrame("DEE", "tok-DEE"));
    await flush();
    expect(first.closeCode).toBe(4003);

    // Same token, no re-registration in between — the retry must just work.
    dbFaulty = false;
    const second = makeWs();
    wss.connect(second);
    fire(second, "message", authFrame("DEE", "tok-DEE"));
    await flush();

    expect(second.closed).toBe(false);
    expect(errorsOn(second)).toHaveLength(0);
  });
});
