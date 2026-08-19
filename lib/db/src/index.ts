import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Strip sslmode from the URL — pg-connection-string now treats 'require' as
// 'verify-full' (rejects self-signed chains). We control SSL via Pool config.
const connectionString = process.env.DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, "$1").replace(/[?&]$/, "");

export const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  // Fail fast into the retry loop below instead of hanging past the client's
  // own request timeout — pg's default is 0 (wait forever).
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
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

function isTransientConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null | undefined;
  if (!e) return false;
  if (e.code === "ECONNREFUSED") return true;
  const msg = e.message ?? "";
  return msg.includes("the database system is starting up") || msg.includes("cached error");
}

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

export * from "./schema";
