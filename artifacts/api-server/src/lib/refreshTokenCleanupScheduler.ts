import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Task #200: periodic sweep of dead refresh_tokens rows.
 *
 * Every token refresh (~every 15 minutes per active user) revokes one row and
 * inserts a new one, so without cleanup the table grows unbounded and slows
 * the refresh lookup. This scheduler deletes rows that are expired or were
 * revoked more than GRACE_MS (7 days) ago — the grace window keeps recent
 * history around for debugging token-reuse incidents.
 *
 * Deletes are batched (BATCH_SIZE per DELETE via a ctid-limited CTE) so the
 * first sweep against a large backlog never holds a giant delete or
 * materializes row IDs in memory.
 */
const TICK_INTERVAL_MS = 60 * 60_000; // hourly is plenty
const INITIAL_DELAY_MS = 60_000; // give the server time to warm up
const GRACE_MS = 7 * 24 * 60 * 60_000; // keep expired/revoked rows for 7 days
const BATCH_SIZE = 1000;
const MAX_BATCHES_PER_TICK = 50; // cap one tick at 50k rows; rest next tick
const CLEANUP_LOCK_KEY = 8831047294n;

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Delete one bounded batch of dead rows; returns the number deleted. */
async function deleteBatch(cutoff: Date): Promise<number> {
  const res = await pool.query(
    `WITH doomed AS (
       SELECT ctid FROM refresh_tokens
       WHERE expires_at <= $1
          OR (revoked_at IS NOT NULL AND revoked_at <= $1)
       LIMIT $2
     )
     DELETE FROM refresh_tokens
     WHERE ctid IN (SELECT ctid FROM doomed)`,
    [cutoff, BATCH_SIZE],
  );
  return res.rowCount ?? 0;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const lockRes = await pool.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [CLEANUP_LOCK_KEY.toString()],
    );
    if (!lockRes.rows[0]?.locked) return;

    try {
      const cutoff = new Date(Date.now() - GRACE_MS);
      let total = 0;
      for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
        const deleted = await deleteBatch(cutoff);
        total += deleted;
        if (deleted < BATCH_SIZE) break;
      }
      if (total > 0) {
        logger.info({ count: total }, "[refreshTokenCleanup] Deleted dead refresh tokens");
      }
    } finally {
      try {
        await pool.query(`SELECT pg_advisory_unlock($1)`, [CLEANUP_LOCK_KEY.toString()]);
      } catch (err) {
        logger.warn({ err }, "[refreshTokenCleanup] Failed to release advisory lock");
      }
    }
  } catch (err) {
    logger.error({ err }, "[refreshTokenCleanup] Tick failed");
  } finally {
    running = false;
  }
}

export function startRefreshTokenCleanupScheduler(): void {
  if (timer) return;
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  logger.info({ intervalMs: TICK_INTERVAL_MS }, "[refreshTokenCleanup] Scheduler started");
}

export const __testing = { tick, deleteBatch };
