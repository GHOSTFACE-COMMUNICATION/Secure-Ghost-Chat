/**
 * E2E / integration test for the rotation scheduler.
 *
 * Connects to the real Postgres database (DATABASE_URL) and exercises the
 * full rotation path:
 *   1. Insert a ghost_numbers row with nextRotationAt in the past.
 *   2. Call tick() via __testing.
 *   3. Assert the row's msisdn changed while its id stayed the same and the
 *      old msisdn was appended to archived_msisdns.
 *
 * Skipped automatically when DATABASE_URL is absent.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";

// Force the deterministic demo-number path regardless of whether Vonage
// credentials happen to be present in the environment. Otherwise, when Vonage
// is configured, tick() hits the real provider — which returns no usable test
// number — so the rotation is skipped and the msisdn never changes. We only
// stub the external SMS provider here; the database round-trip stays real.
vi.mock("../lib/vonage", () => ({
  vonageClient: {
    configured: () => false,
    searchNumbers: async () => [],
    rentNumber: async () => {},
    releaseNumber: async () => {},
  },
}));

const DB_URL = process.env.DATABASE_URL;
const SKIP = !DB_URL;

describe.skipIf(SKIP)("rotationScheduler — E2E (real DB)", () => {
  let client: pg.Client;
  let rowId: number;
  const OLD_MSISDN = `TEST${Date.now()}`;
  const OLD_PHONE = `+64 ${OLD_MSISDN}`;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL });
    await client.connect();

    // Ensure the table and columns exist so this test can run independently
    // against a fresh schema (the app provisions these via the Drizzle schema).
    await client.query(`
      CREATE TABLE IF NOT EXISTS ghost_numbers (
        id           SERIAL PRIMARY KEY,
        user_id      TEXT NOT NULL,
        provider     TEXT NOT NULL DEFAULT 'demo',
        phone_number TEXT NOT NULL,
        country      TEXT NOT NULL,
        capabilities JSONB NOT NULL DEFAULT '["SMS"]',
        status       TEXT NOT NULL DEFAULT 'active',
        plan         TEXT NOT NULL DEFAULT 'basic',
        msisdn       TEXT NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW()
      );
      ALTER TABLE ghost_numbers ADD COLUMN IF NOT EXISTS rotate_every_days INTEGER;
      ALTER TABLE ghost_numbers ADD COLUMN IF NOT EXISTS next_rotation_at TIMESTAMP;
      ALTER TABLE ghost_numbers ADD COLUMN IF NOT EXISTS archived_msisdns JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    // Insert a row that is due for rotation (nextRotationAt 1 hour in the past).
    const res = await client.query<{ id: number }>(
      `INSERT INTO ghost_numbers
         (user_id, provider, phone_number, country, msisdn, rotate_every_days, next_rotation_at, status)
       VALUES ($1, 'demo', $2, 'NZ', $3, 7,
               NOW() - INTERVAL '1 hour',
               'active')
       RETURNING id`,
      ["E2E_TEST_USER", OLD_PHONE, OLD_MSISDN],
    );
    rowId = res.rows[0].id;
  });

  afterAll(async () => {
    // Clean up the test row regardless of outcome.
    if (client && rowId) {
      await client.query("DELETE FROM ghost_numbers WHERE id = $1", [rowId]);
    }
    await client?.end();
  });

  it("rotates the number: same id, new msisdn, old msisdn archived", async () => {
    // Import after env is confirmed present so pool connects correctly.
    const { __testing } = await import("../lib/rotationScheduler.js");

    await __testing.tick();

    const res = await client.query<{
      id: number;
      msisdn: string;
      archived_msisdns: string[];
      next_rotation_at: string;
    }>("SELECT id, msisdn, archived_msisdns, next_rotation_at FROM ghost_numbers WHERE id = $1", [
      rowId,
    ]);

    const row = res.rows[0];
    expect(row).toBeDefined();

    // Row identity preserved.
    expect(row.id).toBe(rowId);

    // MSISDN must have changed.
    expect(row.msisdn).not.toBe(OLD_MSISDN);

    // Old MSISDN must appear in the archived list.
    expect(row.archived_msisdns).toContain(OLD_MSISDN);

    // Next rotation rescheduled (7 days from now, allow ±5 min tolerance).
    const nextAt = new Date(row.next_rotation_at).getTime();
    const sevenDaysFromNow = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(nextAt - sevenDaysFromNow)).toBeLessThan(5 * 60 * 1000);
  });
});
