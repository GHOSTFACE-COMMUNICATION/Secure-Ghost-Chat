import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// GF-20 — inbound SMS routing under pool leases.
//
// Two things are under test and they are the whole point of the pivot:
//   1. Routing key is the PAIR (to, from). One pool number serves many
//      counterparties, so `to` alone must never be enough to pick an owner.
//   2. Unknown inbound is DROPPED — not stored, not routed, never auto-leased,
//      never held — with exactly ONE dead-end reply per pair, ever.
// ---------------------------------------------------------------------------

const TABLE = {
  numbers: "ghost_numbers",
  leases: "number_leases",
  sms: "ghost_sms",
  deadEnd: "dead_end_replies",
} as const;

type Cond =
  | { op: "eq"; col: string; val: unknown }
  | { op: "isNull"; col: string }
  | { op: "and"; xs: Cond[] };

// In-memory state, reset per test.
let poolRows: Array<{ id: number; msisdn: string; status: string; country: string }> = [];
let leaseRows: Array<{
  id: number;
  poolNumberId: number;
  externalNumber: string;
  ownerAlias: string;
  releasedAt: Date | null;
}> = [];
let smsRows: Array<Record<string, unknown>> = [];
let deadEndRows: Array<{ poolMsisdn: string; externalNumber: string }> = [];

const sentSms = vi.fn<(from: string, to: string, text: string) => Promise<boolean>>();
const broadcast = vi.fn();

function matches(row: Record<string, unknown>, c: Cond): boolean {
  if (c.op === "and") return c.xs.every((x) => matches(row, x));
  const key = c.col.split(".")[1];
  if (c.op === "isNull") return row[key] === null || row[key] === undefined;
  return row[key] === c.val;
}

vi.mock("drizzle-orm", () => ({
  eq: (col: string, val: unknown) => ({ op: "eq", col, val }),
  isNull: (col: string) => ({ op: "isNull", col }),
  and: (...xs: Cond[]) => ({ op: "and", xs }),
  desc: (c: unknown) => c,
  sql: Object.assign(() => ({ __sql: true }), { raw: () => ({ __sql: true }) }),
}));

vi.mock("@workspace/db", () => {
  // A table is a proxy that knows its own name and yields "table.column"
  // descriptors for any property access, so the mocked drizzle operators above
  // produce conditions this file can evaluate.
  const mkTable = (name: string) =>
    new Proxy(
      { __table: name },
      { get: (_t, k: string) => (k === "__table" ? name : `${name}.${String(k)}`) },
    ) as unknown as { __table: string };
  const rowsFor = (t: { __table: string }) => {
    switch (t.__table) {
      case TABLE.numbers:
        return poolRows;
      case TABLE.leases:
        return leaseRows;
      case TABLE.sms:
        return smsRows;
      default:
        return deadEndRows;
    }
  };

  return {
    db: {
      select: () => ({
        from: (t: { __table: string }) => ({
          where: (c: Cond) =>
            Promise.resolve((rowsFor(t) as Record<string, unknown>[]).filter((r) => matches(r, c))),
          innerJoin: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }),
        }),
      }),
      insert: (t: { __table: string }) => ({
        values: (v: Record<string, unknown>) => {
          if (t.__table === TABLE.sms) {
            smsRows.push(v);
            return Promise.resolve([v]);
          }
          // dead_end_replies — composite PK gives exactly-once.
          const chain = {
            onConflictDoNothing: () => ({
              returning: () => {
                const dup = deadEndRows.some(
                  (r) => r.poolMsisdn === v.poolMsisdn && r.externalNumber === v.externalNumber,
                );
                if (dup) return Promise.resolve([]);
                deadEndRows.push(v as { poolMsisdn: string; externalNumber: string });
                return Promise.resolve([v]);
              },
            }),
          };
          return chain;
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    },
    ghostNumbersTable: mkTable(TABLE.numbers),
    numberLeasesTable: mkTable(TABLE.leases),
    ghostSmsTable: mkTable(TABLE.sms),
    deadEndRepliesTable: mkTable(TABLE.deadEnd),
  };
});

vi.mock("../lib/vonage", () => ({ vonageClient: { sendSms: (...a: [string, string, string]) => sentSms(...a) } }));
vi.mock("../ws/manager", () => ({ broadcastToAlias: (...a: unknown[]) => broadcast(...a) }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/auth", () => ({ getAuthedAlias: vi.fn() }));
vi.mock("../lib/rateLimiter", () => ({
  RateLimiter: class {
    async allowed() {
      return true;
    }
    async check() {
      return true;
    }
    async record() {}
  },
  getIpKey: () => "ip",
}));

const { handleInboundSms } = await import("../routes/numbers");

const POOL_MSISDN = "6421000111";
const ALICE_PEER = "6421999888";
const BOB_PEER = "6421777666";

beforeEach(() => {
  poolRows = [{ id: 1, msisdn: POOL_MSISDN, status: "leased", country: "NZ" }];
  leaseRows = [];
  smsRows = [];
  deadEndRows = [];
  sentSms.mockReset().mockResolvedValue(true);
  broadcast.mockReset();
});

describe("GF-20 inbound routing — the pair is the key", () => {
  it("routes to the lease owner, tagging the message with the lease", async () => {
    leaseRows.push({ id: 10, poolNumberId: 1, externalNumber: ALICE_PEER, ownerAlias: "ALICE", releasedAt: null });

    await handleInboundSms({ msisdn: ALICE_PEER, to: POOL_MSISDN, text: "hello" });

    expect(smsRows).toHaveLength(1);
    expect(smsRows[0]).toMatchObject({ toUserId: "ALICE", leaseId: 10, body: "hello", direction: "inbound" });
    expect(broadcast).toHaveBeenCalledWith("ALICE", expect.objectContaining({ type: "sms_inbound" }));
    expect(sentSms).not.toHaveBeenCalled();
  });

  it("sends the SAME pool number to different owners by counterparty", async () => {
    // The regression that a `to`-only lookup would cause: Bob's message landing
    // in Alice's inbox because they share a pool number.
    leaseRows.push(
      { id: 10, poolNumberId: 1, externalNumber: ALICE_PEER, ownerAlias: "ALICE", releasedAt: null },
      { id: 11, poolNumberId: 1, externalNumber: BOB_PEER, ownerAlias: "BOB", releasedAt: null },
    );

    await handleInboundSms({ msisdn: BOB_PEER, to: POOL_MSISDN, text: "for bob" });

    expect(smsRows).toHaveLength(1);
    expect(smsRows[0]).toMatchObject({ toUserId: "BOB", leaseId: 11 });
    expect(broadcast).toHaveBeenCalledWith("BOB", expect.anything());
    expect(broadcast).not.toHaveBeenCalledWith("ALICE", expect.anything());
  });
});

describe("GF-20 unknown inbound — DROP, never auto-lease, never hold", () => {
  it("drops the message and never stores or routes it", async () => {
    await handleInboundSms({ msisdn: "6421555444", to: POOL_MSISDN, text: "who is this" });

    expect(smsRows).toHaveLength(0); // never held
    expect(leaseRows).toHaveLength(0); // never auto-leased
    expect(broadcast).not.toHaveBeenCalled(); // never routed
  });

  it("sends exactly one dead-end reply per pair, ever", async () => {
    await handleInboundSms({ msisdn: "6421555444", to: POOL_MSISDN, text: "one" });
    await handleInboundSms({ msisdn: "6421555444", to: POOL_MSISDN, text: "two" });
    await handleInboundSms({ msisdn: "6421555444", to: POOL_MSISDN, text: "three" });

    expect(sentSms).toHaveBeenCalledTimes(1);
    expect(sentSms).toHaveBeenCalledWith(POOL_MSISDN, "6421555444", expect.any(String));
    expect(deadEndRows).toHaveLength(1);
    expect(smsRows).toHaveLength(0);
  });

  it("replies once per pair, not once per pool number", async () => {
    await handleInboundSms({ msisdn: "6421555444", to: POOL_MSISDN, text: "a" });
    await handleInboundSms({ msisdn: "6421333222", to: POOL_MSISDN, text: "b" });

    expect(sentSms).toHaveBeenCalledTimes(2);
    expect(deadEndRows).toHaveLength(2);
  });

  it("treats a RELEASED lease as unknown", async () => {
    leaseRows.push({
      id: 10,
      poolNumberId: 1,
      externalNumber: ALICE_PEER,
      ownerAlias: "ALICE",
      releasedAt: new Date(),
    });

    await handleInboundSms({ msisdn: ALICE_PEER, to: POOL_MSISDN, text: "after release" });

    expect(smsRows).toHaveLength(0);
    expect(broadcast).not.toHaveBeenCalled();
    expect(sentSms).toHaveBeenCalledTimes(1);
  });

  it("stays SILENT for an MSISDN not in the pool — never sends from a number we do not hold", async () => {
    await handleInboundSms({ msisdn: "6421555444", to: "6499999999", text: "wrong number" });

    expect(sentSms).not.toHaveBeenCalled();
    expect(deadEndRows).toHaveLength(0);
    expect(smsRows).toHaveLength(0);
  });

  it("ignores malformed payloads without sending anything", async () => {
    await handleInboundSms({ to: POOL_MSISDN });
    await handleInboundSms({ msisdn: ALICE_PEER });
    await handleInboundSms({});

    expect(sentSms).not.toHaveBeenCalled();
    expect(smsRows).toHaveLength(0);
  });

  it("does not retry the reply if the send fails, and does not release the ledger claim", async () => {
    sentSms.mockRejectedValueOnce(new Error("vonage down"));

    await handleInboundSms({ msisdn: "6421555444", to: POOL_MSISDN, text: "one" });
    await handleInboundSms({ msisdn: "6421555444", to: POOL_MSISDN, text: "two" });

    // One attempt, and the claim stands so the second message does not retry.
    expect(sentSms).toHaveBeenCalledTimes(1);
    expect(deadEndRows).toHaveLength(1);
  });
});
