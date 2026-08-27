/**
 * GET /ice-config — auth enforcement.
 *
 * This endpoint hands out live TURN credentials, which are our spend, so it
 * is gated by ENFORCE_ENDPOINT_AUTH like POST /blobs and POST /invites.
 *
 * Hermetic: iceConfig.ts touches no database, and an unauthenticated request
 * carries no Bearer token, so getAuthedAlias() returns before it would
 * lazily import @workspace/db. With no Twilio or TURN env vars set the
 * route falls back to STUN-only, which is all these assertions need.
 *
 * ⚠️ The behaviour under test is exactly the one that makes this endpoint
 * dangerous to enforce early: the client (app/call.tsx) catches any failure
 * and falls back to STUN-only, so a 401 here is silent to the user.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import express from "express";

let app: express.Express;

beforeAll(async () => {
  const iceConfigRouter = (await import("../routes/iceConfig")).default;
  app = express();
  app.use("/api", iceConfigRouter);
});

afterEach(() => {
  delete process.env.ENFORCE_ENDPOINT_AUTH;
});

async function get(path: string, headers?: Record<string, string>) {
  const { createServer } = await import("http");
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { headers });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

describe("ice-config auth enforcement", () => {
  it("serves an unauthenticated request while enforcement is off", async () => {
    delete process.env.ENFORCE_ENDPOINT_AUTH;
    const r = await get("/api/ice-config");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.iceServers)).toBe(true);
  });

  it("rejects an unauthenticated request when enforcement is on", async () => {
    process.env.ENFORCE_ENDPOINT_AUTH = "1";
    const r = await get("/api/ice-config");
    expect(r.status).toBe(401);
    expect(r.body.iceServers).toBeUndefined();
  });

  it("rejects a Bearer token with no alias when enforcement is on", async () => {
    // No alias means the token cannot be resolved at all — device_tokens is
    // keyed by user_id, and token_hash alone is not unique.
    process.env.ENFORCE_ENDPOINT_AUTH = "1";
    const r = await get("/api/ice-config", { Authorization: "Bearer whatever" });
    expect(r.status).toBe(401);
  });

  it("treats 'true' as enabling enforcement, not just '1'", async () => {
    process.env.ENFORCE_ENDPOINT_AUTH = "true";
    const r = await get("/api/ice-config");
    expect(r.status).toBe(401);
  });

  it("does not enforce on an unrecognised flag value", async () => {
    process.env.ENFORCE_ENDPOINT_AUTH = "yes-please";
    const r = await get("/api/ice-config");
    expect(r.status).toBe(200);
  });
});
