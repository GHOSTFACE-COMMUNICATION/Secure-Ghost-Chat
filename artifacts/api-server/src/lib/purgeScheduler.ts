import { pool } from "@workspace/db";
import { logger } from "./logger";

const TICK_INTERVAL_MS = 60 * 60 * 1000;
const INITIAL_DELAY_MS = 45 * 1000;

// Distinct from ROTATION_LOCK_KEY in rotationScheduler.ts — two schedulers
// sharing a key would silently starve each other.
const PURGE_LOCK_KEY = 7424211920n;

// Rows removed per statement. Deletes are batched by ctid rather than issued
// as one unbounded DELETE so a large backlog can never hold a long lock on a
// table that the live message path writes to on every send.
const BATCH_SIZE = 5_000;

// Safety valve: stop after this many batches per table per tick and pick the
// rest up next hour, so one tick can't run unbounded against a huge backlog.
const MAX_BATCHES_PER_TABLE = 20;

/**
 * Undelivered messages for a recipient who never came back. Without this the
 * partial pending indexes grow forever with dormant accounts, which defeats
 * the point of making them partial.
 */
const UNDELIVERED_TTL_DAYS = 7;

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Delete in bounded batches until the table has nothing left matching, or the
 * batch cap is hit. Returns the number of rows actually removed.
 *
 * `predicate` is interpolated into the statement, so it must be a literal from
 * this module — never anything derived from a request.
 */
async function purgeBatched(table: string, predicate: string): Promise<number> {
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch++) {
    const res = await pool.query(
      `DELETE FROM ${table}
        WHERE ctid IN (
          SELECT ctid FROM ${table} WHERE ${predicate} LIMIT ${BATCH_SIZE}
        )`,
    );
    const n = res.rowCount ?? 0;
    removed += n;
    if (n < BATCH_SIZE) break;
  }
  return removed;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;

  // Same guard rotationScheduler uses: with more than one replica this keeps
  // exactly one of them doing the work, instead of all of them racing.
  const lockRes = await pool.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [PURGE_LOCK_KEY.toString()],
  );
  if (!lockRes.rows[0]?.locked) {
    running = false;
    return;
  }

  try {
    // Delivered rows are unreachable: every read path in the codebase filters
    // `delivered = false`, so removing them is behaviourally identical to
    // leaving them and costs nothing but the disk they were holding.
    //
    // NOTE: `delivered` currently means "the server attempted delivery", not
    // "the client confirmed receipt" — deliverPending sets it after a
    // fire-and-forget ws.send(), and GET /messages/pending sets it before the
    // HTTP response is written. Deleting these rows does not make that worse
    // (nothing could read them either way), but it does mean the fix for it —
    // a real client ack, deleting on receipt instead of on attempt — has to
    // land before "delivered" can be trusted. Tracked separately.
    const deliveredMessages = await purgeBatched("messages", "delivered = true");
    const deliveredDepartures = await purgeBatched("departures", "delivered = true");

    const staleMessages = await purgeBatched(
      "messages",
      `delivered = false AND created_at < now() - interval '${UNDELIVERED_TTL_DAYS} days'`,
    );
    const staleDepartures = await purgeBatched(
      "departures",
      `delivered = false AND created_at < now() - interval '${UNDELIVERED_TTL_DAYS} days'`,
    );

    const total = deliveredMessages + deliveredDepartures + staleMessages + staleDepartures;
    if (total > 0) {
      logger.info(
        { deliveredMessages, deliveredDepartures, staleMessages, staleDepartures },
        "[purge] Removed rows",
      );
    }
  } catch (err) {
    logger.error({ err }, "[purge] Tick failed");
  } finally {
    await pool.query(`SELECT pg_advisory_unlock($1)`, [PURGE_LOCK_KEY.toString()]);
    running = false;
  }
}

export function startPurgeScheduler(): void {
  if (timer) return;
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  logger.info(
    { intervalMs: TICK_INTERVAL_MS, undeliveredTtlDays: UNDELIVERED_TTL_DAYS },
    "[purge] Scheduler started",
  );
}

export const __testing = { tick, purgeBatched };
