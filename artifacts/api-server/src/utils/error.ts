import { logger } from "../lib/logger";

/**
 * Converts a caught error into a client-safe message AND logs the full
 * error server-side (including `.cause` — where drizzle/pg wrap the actual
 * underlying database error: missing relation, auth failure, SSL
 * requirement, connection refused, etc.). The client-facing message stays
 * just `err.message` deliberately — the cause chain can carry raw DB
 * internals that shouldn't leave the server, but it's exactly what you need
 * in the logs to actually debug a 500.
 */
export function toErrorMessage(err: unknown): string {
  logger.error({ err }, "Request handler error");
  return err instanceof Error ? err.message : String(err);
}
