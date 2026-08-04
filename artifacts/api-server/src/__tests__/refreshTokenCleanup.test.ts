import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, refreshTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { __testing } from "../lib/refreshTokenCleanupScheduler";

// ---------------------------------------------------------------------------
// Refresh-token cleanup sweep (task #200).
//
// Properties under test:
// - Rows expired or revoked more than the 7-day grace window ago are deleted.
// - Fresh, recently-expired and recently-revoked rows survive (grace window).
// - The delete is batched: a backlog larger than one batch is fully drained
//   by repeated bounded deletes within a single tick.
// ---------------------------------------------------------------------------

const TEST_USER = "CLEANUP_TEST_USER_VITEST";
const DAY = 24 * 60 * 60_000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * DAY);
}

async function seed(row: {
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date | null;
}): Promise<void> {
  await db.insert(refreshTokensTable).values({
    userId: TEST_USER,
    tokenHash: `${TEST_USER}:${row.tokenHash}`,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt ?? null,
  });
}

async function remainingHashes(): Promise<string[]> {
  const rows = await db
    .select({ tokenHash: refreshTokensTable.tokenHash })
    .from(refreshTokensTable)
    .where(eq(refreshTokensTable.userId, TEST_USER));
  return rows.map((r) => r.tokenHash.split(":")[1]!);
}

async function wipe(): Promise<void> {
  await db.delete(refreshTokensTable).where(eq(refreshTokensTable.userId, TEST_USER));
}

beforeEach(wipe);
afterAll(wipe);

describe("refresh-token cleanup sweep", () => {
  it("deletes rows expired or revoked beyond the 7-day grace window, keeps the rest", async () => {
    // Should be deleted:
    await seed({ tokenHash: "expired-long-ago", expiresAt: daysAgo(10) });
    await seed({
      tokenHash: "revoked-long-ago",
      expiresAt: daysFromNow(20),
      revokedAt: daysAgo(8),
    });
    // Should survive:
    await seed({ tokenHash: "active", expiresAt: daysFromNow(25) });
    await seed({ tokenHash: "expired-recently", expiresAt: daysAgo(2) });
    await seed({
      tokenHash: "revoked-recently",
      expiresAt: daysFromNow(20),
      revokedAt: daysAgo(1),
    });

    await __testing.tick();

    const left = await remainingHashes();
    expect(left.sort()).toEqual(["active", "expired-recently", "revoked-recently"]);
  });

  it("drains a backlog larger than one delete batch in a single tick", async () => {
    // 2 batches' worth + a little, all long expired.
    const COUNT = 2100;
    const values = Array.from({ length: COUNT }, (_, i) => ({
      userId: TEST_USER,
      tokenHash: `${TEST_USER}:bulk-${i}`,
      expiresAt: daysAgo(30),
    }));
    // Insert in chunks to stay under parameter limits.
    for (let i = 0; i < values.length; i += 500) {
      await db.insert(refreshTokensTable).values(values.slice(i, i + 500));
    }
    await seed({ tokenHash: "survivor", expiresAt: daysFromNow(25) });

    await __testing.tick();

    const left = await remainingHashes();
    expect(left).toEqual(["survivor"]);
  });

  it("deleteBatch is bounded and reports the number of rows removed", async () => {
    for (let i = 0; i < 5; i++) {
      await seed({ tokenHash: `b-${i}`, expiresAt: daysAgo(30) });
    }
    const deleted = await __testing.deleteBatch(daysAgo(7));
    expect(deleted).toBe(5);
    expect(await remainingHashes()).toEqual([]);
  });
});
