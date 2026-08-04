import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createHash, randomBytes } from "crypto";
import { db, deviceTokensTable, callPushTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signAccessToken } from "../lib/jwt";
import callPushRouter from "../routes/callPush";

// ---------------------------------------------------------------------------
// Call-push registration auth must accept BOTH credential types during the
// JWT transition window:
//   (a) a JWT access token whose subject matches the alias, and
//   (b) a legacy opaque device token whose hash matches device_tokens,
// and must reject a credential minted for a different alias.
// ---------------------------------------------------------------------------

const TEST_USER = "CALLPUSH_AUTH_VITEST";
const OTHER_USER = "CALLPUSH_AUTH_OTHER";
let app: express.Express;
let legacyToken: string;

async function request(path: string, body: unknown, bearer?: string): Promise<{ status: number }> {
  const { createServer } = await import("http");
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/api${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

function registerBody(): Record<string, unknown> {
  return {
    token: `ExponentPushToken[test-${randomBytes(8).toString("hex")}]`,
    platform: "ios",
    alias: TEST_USER,
    tokenType: "expo",
  };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/api", callPushRouter);

  legacyToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(legacyToken).digest("hex");
  await db.delete(deviceTokensTable).where(eq(deviceTokensTable.userId, TEST_USER));
  await db.insert(deviceTokensTable).values({ userId: TEST_USER, tokenHash });
});

afterAll(async () => {
  await db.delete(callPushTokensTable).where(eq(callPushTokensTable.userId, TEST_USER));
  await db.delete(deviceTokensTable).where(eq(deviceTokensTable.userId, TEST_USER));
});

describe("call-push auth (JWT transition)", () => {
  it("accepts a JWT access token for the matching alias", async () => {
    const res = await request(
      "/calls/register-voip-token",
      registerBody(),
      signAccessToken(TEST_USER),
    );
    expect(res.status).toBe(204);
  });

  it("accepts a legacy opaque device token", async () => {
    const res = await request("/calls/register-voip-token", registerBody(), legacyToken);
    expect(res.status).toBe(204);
  });

  it("rejects a JWT minted for a different alias", async () => {
    const res = await request(
      "/calls/register-voip-token",
      registerBody(),
      signAccessToken(OTHER_USER),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a tampered JWT outright (no legacy fallback)", async () => {
    const res = await request(
      "/calls/register-voip-token",
      registerBody(),
      `${signAccessToken(TEST_USER)}x`,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a missing bearer", async () => {
    const res = await request("/calls/register-voip-token", registerBody());
    expect(res.status).toBe(401);
  });

  it("unregister accepts a JWT access token", async () => {
    const res = await request(
      "/calls/unregister-voip-token",
      { alias: TEST_USER },
      signAccessToken(TEST_USER),
    );
    expect(res.status).toBe(204);
  });
});
