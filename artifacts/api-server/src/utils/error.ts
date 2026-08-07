import { logger } from "../lib/logger";

/**
 * Converts a caught error into a client-safe message AND logs the full
 * error server-side (including `.cause` — where drizzle/pg wrap the actual
 * underlying database error: missing relation, auth failure, SSL
 * requirement, connection refused, etc.).
 *
 * TEMPORARY: also appending `.cause.message` to the client-visible string
 * to unblock live debugging of the prod DB outage (Railway's log UI wasn't
 * getting us the cause chain). Revert this back to err.message-only once
 * that's diagnosed — a cause chain can carry raw DB internals that
 * shouldn't stay exposed to clients long-term.
 */
export function toErrorMessage(err: unknown): string {
  logger.error({ err }, "Request handler error");
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? ` | cause: ${err.cause.message}` : "";
  return `${err.message}${cause}`;
}
