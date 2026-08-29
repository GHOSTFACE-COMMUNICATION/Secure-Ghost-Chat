import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { isTransientConnectionError } from "./transient";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Strip sslmode from the URL — pg-connection-string now treats 'require' as
// 'verify-full' (rejects self-signed chains). We control SSL via Pool config.
const connectionString = process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, "$1").replace(/[?&]$/, "");

// pg defaults `max` to 10, which was the API's real concurrency limit for
// every request and WebSocket handler in the process — small enough that a
// single client returning to a large backlog could starve live traffic.
//
// Raising it is safe here because DATABASE_URL points at PgBouncer
// (transaction pooling, DEFAULT_POOL_SIZE=300, MAX_CLIENT_CONN=1000 across two
// replicas) in front of a Postgres with max_connections=500 — so this is a
// client-side cap well inside the pooler's budget, not a direct claim on
// backend connections. Keep it that way: if the pooler is ever bypassed, this
// number multiplied by the replica count has to stay under max_connections.
const DEFAULT_POOL_MAX = 30;

function poolMax(): number {
  const raw = process.env.DB_POOL_MAX?.trim();
  if (!raw) return DEFAULT_POOL_MAX;
  const n = Number(raw);
  // Fall back rather than throw — a bad value should not stop the API booting.
  if (!Number.isInteger(n) || n < 1) {
    console.warn(`[db] Ignoring invalid DB_POOL_MAX=${raw}; using ${DEFAULT_POOL_MAX}`);
    return DEFAULT_POOL_MAX;
  }
  return n;
}

export const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  max: poolMax(),
  // Fail fast into the retry loop below instead of hanging past the client's
  // own request timeout — pg's default is 0 (wait forever).
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  // TCP keepalives on the connections we do hold. Without them a NAT or the
  // pooler can drop an idle socket silently, and the failure only surfaces as
  // a reset on the next query — i.e. attributed to whichever request happened
  // to be unlucky.
  keepAlive: true,
});

// A pool error on an IDLE connection is emitted on the pool itself, not to
// any query's caller. Unhandled, that is an uncaught exception that takes the
// process down — which is a spectacular way to lose every live WebSocket over
// a connection the pooler recycled while nothing was using it.
pool.on("error", (err) => {
  console.warn("[db] Idle client error (connection will be replaced):", err.message);
});

// ── Retry-with-backoff for transient connection errors ─────────────────────
//
// Postgres cold-starting (Railway sleep/restart) surfaces as a rejection from
// pool.query() before any query actually ran — e.g. "the database system is
// starting up (server_login_retry)" — which was reaching route handlers as a
// bare 500 for real requests during the restart window. Retry only that
// class of error; a genuine query failure (constraint violation, bad SQL)
// must fail on the first attempt, not be retried.
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const rawQuery = pool.query.bind(pool);
pool.query = (async (...args: unknown[]) => {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (rawQuery as any)(...args);
    } catch (err) {
      const transient = isTransientConnectionError(err);
      if (attempt === RETRY_ATTEMPTS || !transient) {
        if (transient) {
          // All retries exhausted on a connection-level error, not a query
          // error — distinguishes "database is actually down/unreachable"
          // from an ordinary one-off 500, which won't hit this branch.
          console.error(`[db] Query failed after ${RETRY_ATTEMPTS} attempts (transient connection error):`, err);
        }
        throw err;
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}) as typeof pool.query;

export const db = drizzle(pool, { schema });

export { isTransientConnectionError };

// ── Keeping the pool warm ───────────────────────────────────────────────────
//
// idleTimeoutMillis reaps idle connections after 30s, so a service that has
// been quiet holds none at all: the next burst of work pays for a fresh
// connect — TLS, PgBouncer, Postgres — on every one of its concurrent
// queries at once. That is the cold-start latency behind auth lookups timing
// out during a call wake, when several sockets authenticate simultaneously
// after an idle stretch.
//
// One cheap query on an interval keeps at least one connection established
// and the path to the database proven. Unref'd, so it never holds the
// process open, and failures are swallowed: this is a warmer, not a
// healthcheck, and real traffic reports its own failures.
const WARM_INTERVAL_MS = 20_000; // < idleTimeoutMillis, so the connection survives

function poolWarmingEnabled(): boolean {
  const raw = process.env.DB_POOL_WARM?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  // Off by default outside production: a test process should not open a
  // connection it never asked for.
  return process.env.NODE_ENV === "production";
}

if (poolWarmingEnabled()) {
  const timer = setInterval(() => {
    void pool.query("SELECT 1").catch(() => {
      /* warmer only — real queries report their own failures */
    });
  }, WARM_INTERVAL_MS);
  timer.unref?.();
  // Open one immediately rather than waiting a full interval, so the first
  // request after a deploy doesn't pay the connect cost either.
  void pool.query("SELECT 1").catch(() => {});
}

export * from "./schema";
