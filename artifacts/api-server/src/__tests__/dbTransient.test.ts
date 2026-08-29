import { describe, it, expect } from "vitest";

import { isTransientConnectionError } from "@workspace/db/transient";

// The predicate decides whether a failed query is retried. Getting it wrong
// in one direction hides real bugs behind three attempts; wrong in the other,
// a dropped connection surfaces as an application error — and for the WS
// handshake specifically, as a rejected device token, which makes the client
// discard a perfectly good credential.

function pgError(code: string, message = "boom"): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe("isTransientConnectionError", () => {
  it("treats socket-level errnos as transient", () => {
    for (const code of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"]) {
      expect(isTransientConnectionError(pgError(code)), code).toBe(true);
    }
  });

  it("treats Postgres connection-class SQLSTATEs as transient", () => {
    for (const code of ["08000", "08001", "08003", "08004", "08006", "08P01", "57P01", "57P03"]) {
      expect(isTransientConnectionError(pgError(code)), code).toBe(true);
    }
  });

  it("recognises the pg/pg-pool errors that carry no code at all", () => {
    const messages = [
      "timeout exceeded when trying to connect",
      "Connection terminated unexpectedly",
      "Connection terminated due to connection timeout",
      "the database system is starting up",
      "terminating connection due to administrator command",
      "server closed the connection unexpectedly",
    ];
    for (const message of messages) {
      expect(isTransientConnectionError(new Error(message)), message).toBe(true);
    }
  });

  it("matches those messages case-insensitively", () => {
    expect(isTransientConnectionError(new Error("TIMEOUT EXCEEDED WHEN TRYING TO CONNECT"))).toBe(true);
  });

  it("unwraps an AggregateError from a failed dual-stack connect", () => {
    const agg = new AggregateError(
      [pgError("ECONNREFUSED", "connect ECONNREFUSED ::1:5432"), pgError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432")],
      "all attempts failed",
    );
    expect(isTransientConnectionError(agg)).toBe(true);
  });

  // The other half of the contract: a query that is simply wrong must fail on
  // the first attempt. Retrying a constraint violation is just three times the
  // latency and three times the load for the same error.
  it("does not treat query-level failures as transient", () => {
    expect(isTransientConnectionError(pgError("23505", "duplicate key value violates unique constraint"))).toBe(false);
    expect(isTransientConnectionError(pgError("23503", "insert or update violates foreign key constraint"))).toBe(false);
    expect(isTransientConnectionError(pgError("42601", "syntax error at or near"))).toBe(false);
    expect(isTransientConnectionError(pgError("42P01", "relation does not exist"))).toBe(false);
    expect(isTransientConnectionError(new Error("something else entirely"))).toBe(false);
  });

  it("is safe on non-errors", () => {
    expect(isTransientConnectionError(null)).toBe(false);
    expect(isTransientConnectionError(undefined)).toBe(false);
    expect(isTransientConnectionError("ECONNREFUSED")).toBe(false);
    expect(isTransientConnectionError({})).toBe(false);
  });
});
