/**
 * Unit tests for the shared auth gate (src/lib/auth.ts).
 *
 * These cover the logic that POST /blobs, GET /ice-config and POST /invites
 * all share, without going through any route. That matters for invites in
 * particular: routes/invites.ts imports @workspace/db at module load, so it
 * cannot be exercised without a database — but its gate can be, here.
 *
 * No database is touched: every case below is one where getAuthedAlias()
 * returns before it would lazily import @workspace/db.
 */

import { describe, it, expect, afterEach } from "vitest";
import type { Request, Response } from "express";
import { checkAuth, deviceAuthMiddleware, isAuthEnforced, hashToken } from "../lib/auth";
import { RateLimiter } from "../lib/rateLimiter";

afterEach(() => {
  delete process.env.ENFORCE_ENDPOINT_AUTH;
});

/** Minimal Request stand-in. `ip` is varied so tests don't share a rate bucket. */
function req(opts: {
  ip: string;
  authorization?: string;
  query?: Record<string, string>;
  body?: Record<string, string>;
}): Request {
  return {
    ip: opts.ip,
    headers: opts.authorization ? { authorization: opts.authorization } : {},
    query: opts.query ?? {},
    body: opts.body,
  } as unknown as Request;
}

/** Response stand-in that records what the gate wrote. */
function res(): Response & { statusCode?: number; payload?: unknown } {
  const r: Record<string, unknown> = {};
  r.status = (code: number) => {
    r.statusCode = code;
    return r;
  };
  r.json = (body: unknown) => {
    r.payload = body;
    return r;
  };
  return r as unknown as Response & { statusCode?: number; payload?: unknown };
}

describe("isAuthEnforced", () => {
  it("is off when the flag is unset", () => {
    delete process.env.ENFORCE_ENDPOINT_AUTH;
    expect(isAuthEnforced()).toBe(false);
  });

  it("accepts '1' and 'true', case- and whitespace-insensitively", () => {
    for (const v of ["1", "true", "TRUE", " true ", " 1 "]) {
      process.env.ENFORCE_ENDPOINT_AUTH = v;
      expect(isAuthEnforced(), `value ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("stays off for anything else, including '0' and 'false'", () => {
    for (const v of ["0", "false", "no", "", "yes-please"]) {
      process.env.ENFORCE_ENDPOINT_AUTH = v;
      expect(isAuthEnforced(), `value ${JSON.stringify(v)}`).toBe(false);
    }
  });
});

describe("checkAuth", () => {
  it("passes an unauthenticated caller through with a null alias while off", async () => {
    delete process.env.ENFORCE_ENDPOINT_AUTH;
    const r = res();
    const out = await checkAuth(req({ ip: "10.0.0.1" }), r, "test", "query");
    expect(out).toEqual({ ok: true, alias: null });
    expect(r.statusCode).toBeUndefined();
  });

  it("rejects an unauthenticated caller with 401 when enforcing", async () => {
    process.env.ENFORCE_ENDPOINT_AUTH = "1";
    const r = res();
    const out = await checkAuth(req({ ip: "10.0.0.2" }), r, "test", "query");
    expect(out).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
  });

  it("rejects a Bearer token sent without an alias when enforcing", async () => {
    // token_hash is not unique — only user_id is — so a token with no alias
    // is unresolvable, not merely unverified.
    process.env.ENFORCE_ENDPOINT_AUTH = "1";
    const r = res();
    const out = await checkAuth(req({ ip: "10.0.0.3", authorization: "Bearer abc" }), r, "test", "query");
    expect(out).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
  });

  it("rejects a malformed Authorization header when enforcing", async () => {
    process.env.ENFORCE_ENDPOINT_AUTH = "1";
    const r = res();
    const out = await checkAuth(
      req({ ip: "10.0.0.4", authorization: "Basic abc", query: { alias: "SOMEONE" } }),
      r,
      "test",
      "query",
    );
    expect(out).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
  });

  it("rejects an alias that fails normalization when enforcing", async () => {
    // Rejected before any database lookup — normalizeAlias returns null.
    process.env.ENFORCE_ENDPOINT_AUTH = "1";
    const r = res();
    const out = await checkAuth(
      req({ ip: "10.0.0.5", authorization: "Bearer abc", query: { alias: "no" } }),
      r,
      "test",
      "query",
    );
    expect(out).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
  });
});

describe("AliasSource selection", () => {
  // Each route names where its claimed alias comes from. A source that does
  // not match the request shape must find nothing rather than fall through
  // to a wider field — that fall-through is the whole hazard this guards.

  it('"query" does not fall back to body.alias', async () => {
    process.env.ENFORCE_ENDPOINT_AUTH = "1";
    const r = res();
    const out = await checkAuth(
      req({ ip: "10.0.0.6", authorization: "Bearer abc", body: { alias: "SOMEONE" } }),
      r,
      "test",
      "query",
    );
    expect(out).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
  });

  it('"query" does not fall back to body.ownerAlias', async () => {
    process.env.ENFORCE_ENDPOINT_AUTH = "1";
    const r = res();
    const out = await checkAuth(
      req({ ip: "10.0.0.7", authorization: "Bearer abc", body: { ownerAlias: "SOMEONE" } }),
      r,
      "test",
      "query",
    );
    expect(out).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
  });

  it('"body-owner-alias" ignores ?alias= entirely', async () => {
    process.env.ENFORCE_ENDPOINT_AUTH = "1";
    const r = res();
    const out = await checkAuth(
      req({ ip: "10.0.0.8", authorization: "Bearer abc", query: { alias: "SOMEONE" } }),
      r,
      "test",
      "body-owner-alias",
    );
    expect(out).toEqual({ ok: false });
    expect(r.statusCode).toBe(401);
  });
});

describe("deviceAuthMiddleware", () => {
  // Path-param routes (prekeys, push, vpn). Every case here is one that
  // returns before the device-token lookup, so no database is involved.

  function paramReq(opts: { ip: string; authorization?: string; userId?: string }): Request {
    return {
      ip: opts.ip,
      headers: opts.authorization ? { authorization: opts.authorization } : {},
      params: opts.userId === undefined ? {} : { userId: opts.userId },
      query: {},
    } as unknown as Request;
  }

  it("401s with no Bearer token, and does not call next", async () => {
    const r = res();
    let called = false;
    await deviceAuthMiddleware()(paramReq({ ip: "10.1.0.1", userId: "SOMEONE" }), r, () => {
      called = true;
    });
    expect(r.statusCode).toBe(401);
    expect(called).toBe(false);
  });

  it("400s on a userId that is not a valid alias", async () => {
    const r = res();
    await deviceAuthMiddleware()(
      paramReq({ ip: "10.1.0.2", authorization: "Bearer abc", userId: "no" }),
      r,
      () => undefined,
    );
    expect(r.statusCode).toBe(400);
  });

  it("429s when a supplied failure gate is already exhausted", async () => {
    const gate = new RateLimiter({ windowMs: 60_000, max: 1, prefix: "testGateExhausted" });
    await gate.record("10.1.0.3");
    const r = res();
    await deviceAuthMiddleware({ failureGate: gate })(
      paramReq({ ip: "10.1.0.3", userId: "SOMEONE" }),
      r,
      () => undefined,
    );
    expect(r.statusCode).toBe(429);
  });

  it("charges the failure gate for a missing token", async () => {
    const gate = new RateLimiter({ windowMs: 60_000, max: 5, prefix: "testGateCharged" });
    await deviceAuthMiddleware({ failureGate: gate })(
      paramReq({ ip: "10.1.0.4", userId: "SOMEONE" }),
      res(),
      () => undefined,
    );
    // max is 5 and one failure was charged, so four remain — assert by
    // draining: the 5th record must be the one that closes the window.
    for (let i = 0; i < 4; i++) await gate.record("10.1.0.4");
    expect(await gate.allowed("10.1.0.4")).toBe(false);
  });

  it("does NOT charge the failure gate for a malformed userId", async () => {
    // A bad path param is a client bug, not an authentication attempt — it
    // must not fill a bucket that gates real users behind carrier NAT.
    const gate = new RateLimiter({ windowMs: 60_000, max: 2, prefix: "testGateUncharged" });
    await deviceAuthMiddleware({ failureGate: gate })(
      paramReq({ ip: "10.1.0.5", authorization: "Bearer abc", userId: "no" }),
      res(),
      () => undefined,
    );
    expect(await gate.allowed("10.1.0.5")).toBe(true);
    await gate.record("10.1.0.5");
    await gate.record("10.1.0.5");
    expect(await gate.allowed("10.1.0.5")).toBe(false);
  });
});

describe("hashToken", () => {
  it("is SHA-256 hex, matching what registration stores", () => {
    // Same value the other routes' local copies produce; this is the shared
    // one they are all meant to converge on.
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
