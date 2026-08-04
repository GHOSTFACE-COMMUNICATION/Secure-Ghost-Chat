import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { requireAdminSecret } from "../middlewares/adminAuth";
import type { Request, Response, NextFunction } from "express";

function makeReq(opts: { headers?: Record<string, string>; query?: Record<string, string> } = {}) {
  const headers = Object.fromEntries(
    Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    header: (name: string) => headers[name.toLowerCase()],
    query: opts.query ?? {},
  } as unknown as Request;
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("requireAdminSecret (task #168)", () => {
  const OLD = process.env.ADMIN_SECRET;
  beforeEach(() => {
    process.env.ADMIN_SECRET = "s3cret-value";
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = OLD;
  });

  it("returns 503 (never open) when ADMIN_SECRET is not configured", () => {
    delete process.env.ADMIN_SECRET;
    const res = makeRes();
    const next = vi.fn();
    requireAdminSecret(makeReq(), res, next as NextFunction);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects requests with no credential", () => {
    const res = makeRes();
    const next = vi.fn();
    requireAdminSecret(makeReq(), res, next as NextFunction);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", () => {
    const res = makeRes();
    const next = vi.fn();
    requireAdminSecret(
      makeReq({ headers: { "x-admin-secret": "wrong" } }),
      res,
      next as NextFunction,
    );
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts the x-admin-secret header", () => {
    const next = vi.fn();
    requireAdminSecret(
      makeReq({ headers: { "x-admin-secret": "s3cret-value" } }),
      makeRes(),
      next as NextFunction,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("accepts Authorization: Bearer (monitoring path)", () => {
    const next = vi.fn();
    requireAdminSecret(
      makeReq({ headers: { authorization: "Bearer s3cret-value" } }),
      makeRes(),
      next as NextFunction,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("accepts the ?key= query parameter (browser dashboard)", () => {
    const next = vi.fn();
    requireAdminSecret(
      makeReq({ query: { key: "s3cret-value" } }),
      makeRes(),
      next as NextFunction,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects an empty provided credential even if lengths could collide", () => {
    process.env.ADMIN_SECRET = "";
    const res = makeRes();
    const next = vi.fn();
    requireAdminSecret(makeReq({ headers: { "x-admin-secret": "" } }), res, next as NextFunction);
    // empty configured secret means "not configured" → disabled
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });
});
