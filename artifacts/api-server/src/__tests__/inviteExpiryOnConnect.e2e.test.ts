/**
 * E2E / integration test for restart-survival of invite-expiry notices.
 *
 * Scenario: the in-memory 5-minute sweep never ran (server restarted after a
 * code expired but before the sweep fired). The owner must still receive the
 * `invite-expired` frame on their next WS connect, via
 * deliverPendingInviteExpiries().
 *
 * This test uses the real Postgres database (DATABASE_URL):
 *   1. Insert an expired, unredeemed invite row with owner_notified_at NULL.
 *   2. Call deliverPendingInviteExpiries() directly with a fake WS
 *      (simulating a reconnect after a restart).
 *   3. Assert the WS receives an `invite-expired` frame with the right code.
 *   4. Assert owner_notified_at is now non-null.
 *   5. Assert a second call does NOT replay the notice.
 *
 * Skipped automatically when DATABASE_URL is absent.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { WebSocket } from "ws";
import { __testing } from "../ws/manager";

const DB_URL = process.env.DATABASE_URL;
const SKIP = !DB_URL;

/** Minimal WS stand-in capturing every frame sent to it. */
function fakeSocket() {
  const frames: unknown[] = [];
  const ws = {
    send: (raw: string) => {
      frames.push(JSON.parse(raw));
    },
  } as unknown as WebSocket;
  return { ws, frames };
}

describe.skipIf(SKIP)("invite-expiry notices survive a restart (on-connect delivery)", () => {
  let client: pg.Client;
  // Stored owner aliases are normalized (uppercased); the delivery query
  // compares against normalizeAlias(alias), so the row must match that form.
  const OWNER = `TEST-OWNER-${Date.now()}`;
  const CODE = `GF-TEST-${Date.now().toString(36).toUpperCase()}`;
  let rowId: number;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL });
    await client.connect();

    // Ensure the table exists so this test can run against a fresh schema
    // (the app provisions it via the Drizzle schema).
    await client.query(`
      CREATE TABLE IF NOT EXISTS invites (
        id                SERIAL PRIMARY KEY,
        code              TEXT NOT NULL UNIQUE,
        owner_alias       TEXT NOT NULL,
        expires_at        TIMESTAMP NOT NULL,
        redeemed          BOOLEAN NOT NULL DEFAULT FALSE,
        created_at        TIMESTAMP DEFAULT NOW() NOT NULL,
        owner_notified_at TIMESTAMP
      );
      ALTER TABLE invites ADD COLUMN IF NOT EXISTS owner_notified_at TIMESTAMP;
    `);

    // Expired 10 minutes ago, unredeemed, owner never notified — exactly the
    // state left behind when the server restarts mid-TTL.
    const res = await client.query<{ id: number }>(
      `INSERT INTO invites (code, owner_alias, expires_at, redeemed, owner_notified_at)
       VALUES ($1, $2, NOW() - INTERVAL '10 minutes', FALSE, NULL)
       RETURNING id`,
      [CODE, OWNER],
    );
    rowId = res.rows[0].id;
  });

  afterAll(async () => {
    await client.query(`DELETE FROM invites WHERE id = $1`, [rowId]);
    await client.end();
  });

  it("delivers the invite-expired frame on connect and stamps ownerNotifiedAt", async () => {
    const { ws, frames } = fakeSocket();

    await __testing.deliverPendingInviteExpiries(OWNER, ws);

    const expiredFrames = frames.filter(
      (f): f is { type: string; code: string } =>
        typeof f === "object" && f !== null && (f as { type?: string }).type === "invite-expired",
    );
    expect(expiredFrames).toHaveLength(1);
    expect(expiredFrames[0].code).toBe(CODE);

    const after = await client.query<{ owner_notified_at: Date | null }>(
      `SELECT owner_notified_at FROM invites WHERE id = $1`,
      [rowId],
    );
    expect(after.rows[0].owner_notified_at).not.toBeNull();
  });

  it("does not replay the notice on a subsequent connect", async () => {
    const { ws, frames } = fakeSocket();

    await __testing.deliverPendingInviteExpiries(OWNER, ws);

    expect(frames.filter((f) => (f as { type?: string }).type === "invite-expired")).toHaveLength(
      0,
    );
  });
});
