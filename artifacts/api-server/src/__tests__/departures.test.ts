import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Hoisted mocks — declared before the module-under-test is imported.
// ---------------------------------------------------------------------------

// In-memory state for the mocked db.
type Row = { id: number; fromAlias: string; toAlias: string; delivered: boolean };
const departureRows: Row[] = [];
const deviceTokens: { userId: string; tokenHash: string }[] = [];
let nextDepartureId = 1;

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerDebug = vi.fn();

// Minimal drizzle-like surface: enough for ws/manager.ts to call
//   - db.select().from(deviceTokensTable).where(...)         → device-token check
//   - db.select().from(messagesTable).where(...)             → deliverPending
//   - db.select().from(departuresTable).where(...)           → deliverPendingDepartures
//   - db.insert(departuresTable).values(...).returning()     → departed branch
//   - db.update(departuresTable).set({...}).where(...)       → mark delivered
//   - db.update(messagesTable).set({...}).where(...)         → not exercised here
const TABLE_DEPARTURES = Symbol("departures");
const TABLE_MESSAGES = Symbol("messages");
const TABLE_DEVICE_TOKENS = Symbol("deviceTokens");
const TABLE_IDENTITY_KEYS = Symbol("identityKeys");

function whereable(rows: () => unknown[]) {
  return {
    where: () => Promise.resolve(rows()),
  };
}

vi.mock("@workspace/db", () => {
  const db = {
    select: () => ({
      from: (tbl: symbol) => {
        if (tbl === TABLE_DEVICE_TOKENS) {
          // validateToken uses .where(and(...)) returning array directly
          return {
            where: () => Promise.resolve(deviceTokens),
          };
        }
        if (tbl === TABLE_MESSAGES) {
          return whereable(() => []);
        }
        if (tbl === TABLE_DEPARTURES) {
          return whereable(() => departureRows.filter((r) => !r.delivered));
        }
        if (tbl === TABLE_IDENTITY_KEYS) {
          // No identity row for these test users → ensureDeliveryId returns
          // null, which the auth flow handles gracefully (delivery-id routing
          // is skipped and deliverPendingDepartures still runs).
          return whereable(() => []);
        }
        return whereable(() => []);
      },
    }),
    insert: (tbl: symbol) => ({
      values: (vals: Partial<Row>) => ({
        returning: async () => {
          if (tbl !== TABLE_DEPARTURES) return [];
          const row: Row = {
            id: nextDepartureId++,
            fromAlias: vals.fromAlias ?? "",
            toAlias: vals.toAlias ?? "",
            delivered: vals.delivered ?? false,
          };
          departureRows.push(row);
          return [row];
        },
      }),
    }),
    update: (tbl: symbol) => ({
      set: (patch: Partial<Row>) => ({
        where: () => {
          if (tbl === TABLE_DEPARTURES && patch.delivered === true) {
            // Mark the most recently-touched undelivered row delivered.
            // The real query targets by id; for our assertions we only
            // care that *some* row flips, so flip the first match.
            const target = departureRows.find((r) => !r.delivered);
            if (target) target.delivered = true;
          }
          return Promise.resolve();
        },
      }),
    }),
  };

  return {
    db,
    departuresTable: TABLE_DEPARTURES,
    messagesTable: TABLE_MESSAGES,
    deviceTokensTable: TABLE_DEVICE_TOKENS,
    identityKeysTable: TABLE_IDENTITY_KEYS,
  };
});

vi.mock("../lib/logger", () => ({
  logger: {
    info: (obj: unknown, msg: string) => mockLoggerInfo(obj, msg),
    warn: (obj: unknown, msg: string) => mockLoggerWarn(obj, msg),
    error: (obj: unknown, msg: string) => mockLoggerError(obj, msg),
    debug: (obj: unknown, msg: string) => mockLoggerDebug(obj, msg),
  },
}));

// Import the module-under-test AFTER mocks.
const { createWsServer } = await import("../ws/manager.js");

// ---------------------------------------------------------------------------
// Fake WebSocket / WebSocketServer
// ---------------------------------------------------------------------------

interface FakeWs {
  readyState: number;
  isAlive?: boolean;
  sent: string[];
  closed: boolean;
  listeners: Map<string, ((arg?: unknown) => void)[]>;
  send: (raw: string) => void;
  close: (code?: number, reason?: string) => void;
  terminate: () => void;
  ping: () => void;
  on: (evt: string, cb: (arg?: unknown) => void) => void;
}

function makeWs(): FakeWs {
  const listeners = new Map<string, ((arg?: unknown) => void)[]>();
  const ws: FakeWs = {
    readyState: 1, // OPEN
    sent: [],
    closed: false,
    listeners,
    send(raw: string) {
      this.sent.push(raw);
    },
    close() {
      this.closed = true;
    },
    terminate() {
      this.closed = true;
    },
    ping() {},
    on(evt, cb) {
      const arr = listeners.get(evt) ?? [];
      arr.push(cb);
      listeners.set(evt, arr);
    },
  };
  return ws;
}

function fire(ws: FakeWs, evt: string, arg?: unknown) {
  const arr = ws.listeners.get(evt) ?? [];
  for (const cb of arr) cb(arg);
}

function makeWss() {
  const connectionHandlers: ((ws: FakeWs) => void)[] = [];
  const closeHandlers: (() => void)[] = [];
  return {
    clients: new Set<FakeWs>(),
    on(evt: string, cb: (...args: unknown[]) => void) {
      if (evt === "connection") {
        connectionHandlers.push(cb as (ws: FakeWs) => void);
      } else if (evt === "close") {
        closeHandlers.push(cb as () => void);
      }
    },
    connect(ws: FakeWs) {
      this.clients.add(ws);
      for (const cb of connectionHandlers) cb(ws);
    },
  };
}

function lastSentOfType(ws: FakeWs, type: string): Record<string, unknown> | undefined {
  for (let i = ws.sent.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(ws.sent[i]) as Record<string, unknown>;
      if (parsed.type === type) return parsed;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

async function flush() {
  // Let microtasks drained — the ws "message" handler is async.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  // Then yield the macrotask queue once, which drains every microtask still
  // pending. Counting microtask turns is fragile: it silently breaks whenever
  // the code under test grows an await, which is exactly what happened when
  // the WS handlers moved to Redis-backed shared state.
  await new Promise((resolve) => setImmediate(resolve));
}

function tokenFor(alias: string): { token: string; hash: string } {
  const token = `tok-${alias}`;
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

async function authAs(ws: FakeWs, alias: string) {
  const { token, hash } = tokenFor(alias);
  // Plant the token row so validateToken finds a match.
  deviceTokens.length = 0;
  deviceTokens.push({ userId: alias, tokenHash: hash });
  fire(ws, "message", JSON.stringify({ type: "auth", alias, token }));
  await flush();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ws/manager.ts departed flow", () => {
  beforeEach(() => {
    departureRows.length = 0;
    deviceTokens.length = 0;
    nextDepartureId = 1;
    vi.clearAllMocks();
  });

  it("departed: writes one departures row per unique recipient and pushes live to online recipients", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    // Recipient comes online first so the broadcaster can deliver live.
    const bobWs = makeWs();
    wss.connect(bobWs);
    await authAs(bobWs, "BOB");

    const aliceWs = makeWs();
    wss.connect(aliceWs);
    await authAs(aliceWs, "ALICE");

    // ALICE broadcasts a departure to BOB (online) and CAROL (offline).
    fire(
      aliceWs,
      "message",
      JSON.stringify({ type: "departed", toAliases: ["BOB", "CAROL", "BOB", ""] }),
    );
    await flush();

    // Persistence: one row per unique non-empty recipient.
    const recipients = departureRows.map((r) => r.toAlias).sort();
    expect(recipients).toEqual(["BOB", "CAROL"]);
    for (const row of departureRows) {
      expect(row.fromAlias).toBe("ALICE");
    }

    // Live push: BOB received a departed wire from ALICE.
    const bobDeparted = lastSentOfType(bobWs, "departed");
    expect(bobDeparted).toBeDefined();
    expect(bobDeparted?.from).toBe("ALICE");

    // BOB's row is flipped delivered=true; CAROL's stays false for replay.
    const bobRow = departureRows.find((r) => r.toAlias === "BOB");
    const carolRow = departureRows.find((r) => r.toAlias === "CAROL");
    expect(bobRow?.delivered).toBe(true);
    expect(carolRow?.delivered).toBe(false);
  });

  it("departed: replays queued notice to a recipient that connects later", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    // ALICE broadcasts to offline CAROL.
    const aliceWs = makeWs();
    wss.connect(aliceWs);
    await authAs(aliceWs, "ALICE");
    fire(aliceWs, "message", JSON.stringify({ type: "departed", toAliases: ["CAROL"] }));
    await flush();

    const carolRow = departureRows.find((r) => r.toAlias === "CAROL");
    expect(carolRow?.delivered).toBe(false);

    // CAROL connects later. deliverPendingDepartures should push the notice
    // and flip it delivered.
    const carolWs = makeWs();
    wss.connect(carolWs);
    await authAs(carolWs, "CAROL");

    const replayed = lastSentOfType(carolWs, "departed");
    expect(replayed).toBeDefined();
    expect(replayed?.from).toBe("ALICE");
    expect(carolRow?.delivered).toBe(true);
  });

  it("departed: rejects unauthenticated broadcasters and never inserts rows", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    const ws = makeWs();
    wss.connect(ws);
    // No auth — send departed straight away.
    fire(ws, "message", JSON.stringify({ type: "departed", toAliases: ["BOB"] }));
    await flush();

    expect(departureRows.length).toBe(0);
    const err = lastSentOfType(ws, "error");
    expect(err).toBeDefined();
  });

  it("departed: ignores self-targeting and empty alias entries", async () => {
    const wss = makeWss();
    createWsServer(wss as never);

    const aliceWs = makeWs();
    wss.connect(aliceWs);
    await authAs(aliceWs, "ALICE");

    fire(
      aliceWs,
      "message",
      JSON.stringify({ type: "departed", toAliases: ["ALICE", "   ", "BOB"] }),
    );
    await flush();

    const recipients = departureRows.map((r) => r.toAlias);
    expect(recipients).toEqual(["BOB"]);
  });
});
