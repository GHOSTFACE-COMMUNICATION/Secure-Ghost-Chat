/**
 * Is this error the connection failing, rather than the query failing?
 *
 * The distinction decides whether a retry is honest. A constraint violation
 * or a syntax error will fail identically every time and must surface on the
 * first attempt; a connection that was refused, reset, timed out or shut down
 * under us says nothing about the query, and running it again is the correct
 * response.
 *
 * Kept as a pure predicate in its own module so the list can be tested
 * against the real error shapes without opening a pool.
 *
 * The shapes below are the ones this deployment actually produces: the API
 * reaches Postgres through PgBouncer, and either hop can drop a connection
 * during a Railway restart, a deploy, or a scale event — as a socket-level
 * errno, as a Postgres class-08 SQLSTATE, or as a pg-pool message with no
 * code on it at all. Cold start is when they cluster: a service that has been
 * idle has no live connections left (idleTimeoutMillis reaps them), so a
 * burst of concurrent work opens a burst of new ones into a pooler and a
 * database that are themselves cold.
 */

// Socket/DNS level, from Node.
const TRANSIENT_ERRNOS = new Set([
  "ECONNREFUSED", // nothing listening yet — pooler or database still starting
  "ECONNRESET", // connection dropped mid-flight
  "ETIMEDOUT", // no response in time
  "EPIPE", // wrote to a socket the far end had already closed
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EAI_AGAIN", // transient DNS failure, common while a service is rescheduling
]);

// Postgres SQLSTATEs. Class 08 is "connection exception" in its entirety;
// 57P01/57P03 are the server telling us, in so many words, to come back.
const TRANSIENT_SQLSTATES = new Set([
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "08P01", // protocol_violation (PgBouncer emits this when it drops a client)
  "57P01", // admin_shutdown — "terminating connection due to administrator command"
  "57P03", // cannot_connect_now — "the database system is starting up"
]);

// pg and pg-pool raise several of these as a bare Error with no code at all,
// so the message is the only thing to match on.
const TRANSIENT_MESSAGES = [
  "the database system is starting up",
  "the database system is shutting down",
  "the database system is in recovery mode",
  "cached error",
  "connection terminated unexpectedly",
  "connection terminated due to connection timeout",
  "timeout exceeded when trying to connect", // pg-pool's connectionTimeoutMillis
  "server closed the connection unexpectedly",
  "terminating connection due to administrator command",
  "client has encountered a connection error",
  "connection ended unexpectedly",
  "server login has been failing", // PgBouncer: server_login_retry
  "query_wait_timeout", // PgBouncer: no server connection free in time
  "no more connections allowed",
  "pgbouncer cannot connect to server",
];

export function isTransientConnectionError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; errors?: unknown } | null | undefined;
  if (!e || typeof e !== "object") return false;

  const code = typeof e.code === "string" ? e.code : "";
  if (TRANSIENT_ERRNOS.has(code)) return true;
  if (TRANSIENT_SQLSTATES.has(code.toUpperCase())) return true;

  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (TRANSIENT_MESSAGES.some((m) => message.includes(m))) return true;

  // AggregateError, which is what a dual-stack connect attempt fails as when
  // every address is unreachable — the useful code is on the children.
  if (Array.isArray(e.errors)) {
    return e.errors.some((inner) => isTransientConnectionError(inner));
  }

  return false;
}
