import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { db, refreshTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signRefreshToken, hashRefreshToken, verifyAccessToken } from "../lib/jwt";
import authRouter from "../routes/auth";

// ---------------------------------------------------------------------------
// Refresh-token rotation & revocation.
//
// The critical property under test: a presented refresh token is single-use.
// Rotation claims the row with a conditional UPDATE (revoked_at IS NULL AND
// unexpired), so two concurrent refreshes with the same token must produce
// exactly one success — the loser gets 401 rather than a second valid pair
// (token-replay via race).
// ---------------------------------------------------------------------------

const TEST_USER = "AUTH_TEST_USER_VITEST";
let app: express.Express;

async function request(
  path: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, string> }> {
  const { createServer } = await import("http");
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let json: Record<string, string> = {};
    try {
      json = (await res.json()) as Record<string, string>;
    } catch {
      /* ignore */
    }
    return { status: res.status, json };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function seedRefreshToken(): Promise<string> {
  const t = signRefreshToken(TEST_USER);
  await db.insert(refreshTokensTable).values({
    userId: TEST_USER,
    tokenHash: hashRefreshToken(t.token),
    expiresAt: t.expiresAt,
  });
  return t.token;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use("/api", authRouter);
});

afterAll(async () => {
  await db.delete(refreshTokensTable).where(eq(refreshTokensTable.userId, TEST_USER));
});

describe("POST /api/auth/refresh", () => {
  it("rotates a valid refresh token and returns a working pair", async () => {
    const token = await seedRefreshToken();
    const res = await request("/auth/refresh", { refreshToken: token });
    expect(res.status).toBe(200);
    expect(typeof res.json.accessToken).toBe("string");
    expect(typeof res.json.refreshToken).toBe("string");
    expect(res.json.refreshToken).not.toBe(token);
    expect(verifyAccessToken(res.json.accessToken)).toBe(TEST_USER);
  });

  it("rejects reuse of a rotated (revoked) token", async () => {
    const token = await seedRefreshToken();
    const first = await request("/auth/refresh", { refreshToken: token });
    expect(first.status).toBe(200);
    const replay = await request("/auth/refresh", { refreshToken: token });
    expect(replay.status).toBe(401);
  });

  it("allows exactly one winner when the same token is refreshed concurrently", async () => {
    const token = await seedRefreshToken();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request("/auth/refresh", { refreshToken: token })),
    );
    const wins = results.filter((r) => r.status === 200);
    const losses = results.filter((r) => r.status === 401);
    expect(wins.length).toBe(1);
    expect(losses.length).toBe(4);
  });

  it("rejects a token that is not a valid refresh JWT", async () => {
    const res = await request("/auth/refresh", { refreshToken: "not-a-jwt" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/revoke", () => {
  it("revokes a token so it can no longer refresh, and is idempotent", async () => {
    const token = await seedRefreshToken();
    const revoke1 = await request("/auth/revoke", { refreshToken: token });
    expect(revoke1.status).toBe(200);
    const refresh = await request("/auth/refresh", { refreshToken: token });
    expect(refresh.status).toBe(401);
    const revoke2 = await request("/auth/revoke", { refreshToken: token });
    expect(revoke2.status).toBe(200);
  });
});
