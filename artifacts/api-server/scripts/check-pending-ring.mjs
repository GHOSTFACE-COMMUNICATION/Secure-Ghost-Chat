#!/usr/bin/env node
/**
 * check-pending-ring.mjs — WS-level regression check for the pending-ring
 * bridge (task #150 / verified by task #154).
 *
 * When a call-ring targets an offline callee that has a registered call-push
 * token, the server parks the ring in memory (pendingRings in
 * src/ws/manager.ts) and replays it once when the callee's WebSocket
 * authenticates within the ring TTL. This script boots the REAL server
 * (built dist bundle, real Postgres via DATABASE_URL) with a short
 * PENDING_RING_TTL_MS and asserts, over actual WebSocket clients:
 *
 *   1. Replay: callee reconnects within TTL → call-ring replayed exactly
 *      once, carrying the caller alias / callId / callMode.
 *   2. No double replay: a second reconnect gets nothing.
 *   3. Hangup cancel: caller hangs up while callee is offline → no replay.
 *   4. TTL expiry: callee connects after the TTL → no replay.
 *   5. Overwrite: a second call-ring to the same callee replaces the first —
 *      exactly one ring is replayed, and it is the newest one.
 *
 * Exit 0 → all assertions hold. Exit 1 → regression.
 */

import { spawn, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "..");

const PORT = 4700 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/api/ws`;
// Short TTL so the expiry scenario runs in seconds. Long enough that the
// "reconnect in time" scenarios are nowhere near the edge.
const TTL_MS = 2_000;

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    console.error(`  ✗ ${msg}`);
    failures += 1;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Server lifecycle ────────────────────────────────────────────────────────

let serverProc = null;

async function startServer() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (real Postgres, same as the dev server).");
    process.exit(1);
  }
  // Self-provision the call_push_tokens table (dev DB is not auto-migrated;
  // mirrors lib/db/src/schema/callPushTokens.ts and the pattern used by the
  // invite-expiry e2e test).
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS call_push_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL,
      token      TEXT NOT NULL UNIQUE,
      platform   TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await client.end();

  console.log("Building api-server bundle…");
  execSync("node ./build.mjs", { cwd: serverDir, stdio: "inherit" });

  console.log(`Starting server on :${PORT} with PENDING_RING_TTL_MS=${TTL_MS}…`);
  serverProc = spawn("node", ["dist/index.mjs"], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      PENDING_RING_TTL_MS: String(TTL_MS),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error("Server failed to become healthy within 30 s");
}

function stopServer() {
  if (serverProc && serverProc.exitCode === null) serverProc.kill("SIGKILL");
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

const hex = (n) => randomBytes(n).toString("hex");

/** Register a fresh user; returns { alias, token }. */
async function registerUser(alias) {
  const res = await fetch(`${BASE}/api/prekeys/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: alias,
      ikPublicKey: hex(32),
      spkPublicKey: hex(32),
    }),
  });
  if (!res.ok) throw new Error(`register ${alias} failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { alias: body.userId, token: body.token };
}

/**
 * Register a call-push token for the callee so the server takes the
 * "park + push" path instead of bouncing offline. The token is deliberately
 * NOT a valid Expo push token: hasCallPushTokens() sees the row and parks
 * the ring, while sendCallPush() filters it out without any network call
 * (and prunes the row) — so each scenario re-registers a fresh one.
 */
async function registerVoipToken(user) {
  const res = await fetch(`${BASE}/api/calls/register-voip-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${user.token}`,
    },
    body: JSON.stringify({
      token: `check-pending-ring-${hex(8)}`,
      platform: "android",
      alias: user.alias,
    }),
  });
  if (res.status !== 204) {
    throw new Error(`register-voip-token failed: ${res.status} ${await res.text()}`);
  }
}

// ── WS client helper ────────────────────────────────────────────────────────

/** Connect + authenticate; returns a client that records every frame. */
function connectClient(user) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const frames = [];
    const client = {
      ws,
      frames,
      ringsFor: () => frames.filter((f) => f.type === "call-ring"),
      send: (obj) => ws.send(JSON.stringify(obj)),
      close: () =>
        new Promise((r) => {
          if (ws.readyState === WebSocket.CLOSED) return r();
          ws.once("close", () => r());
          ws.close();
        }),
    };
    const timer = setTimeout(() => reject(new Error("WS auth timed out")), 10_000);
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      frames.push(msg);
      // First ack (no msgId) confirms auth. Pending-ring replay is sent right
      // after — give callers a moment via settle() before asserting.
      if (msg.type === "ack" && msg.msgId === undefined) {
        clearTimeout(timer);
        resolve(client);
      }
      if (msg.type === "error") {
        clearTimeout(timer);
        reject(new Error(`WS error frame: ${msg.message}`));
      }
    });
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth", alias: user.alias, token: user.token }));
    });
  });
}

/** Let post-auth server pushes (replay etc.) land. */
const settle = () => sleep(500);

// ── Scenarios ───────────────────────────────────────────────────────────────

async function main() {
  await startServer();

  const suffix = Date.now().toString(36).toUpperCase();
  const caller = await registerUser(`RINGCALLER${suffix}`);
  const callee = await registerUser(`RINGCALLEE${suffix}`);

  // ── 1 + 2. Replay exactly once on slow wake ──────────────────────────────
  console.log("\nScenario 1: callee wakes within TTL → ring replayed exactly once");
  {
    await registerVoipToken(callee);
    const callerWs = await connectClient(caller);
    const callId = `call-${hex(6)}`;
    callerWs.send({ type: "call-ring", to: callee.alias, callId, callMode: "video" });
    await settle(); // let the server park the ring (async hasCallPushTokens)

    const calleeWs = await connectClient(callee); // "phone woke up"
    await settle();
    const rings = calleeWs.ringsFor();
    assert(rings.length === 1, "exactly one call-ring replayed after reconnect");
    assert(rings[0]?.from === caller.alias, "replayed ring carries the caller alias");
    assert(rings[0]?.callId === callId, "replayed ring carries the original callId");
    assert(rings[0]?.callMode === "video", "replayed ring carries the original callMode");
    await calleeWs.close();

    const calleeWs2 = await connectClient(callee);
    await settle();
    assert(calleeWs2.ringsFor().length === 0, "no second replay on a subsequent reconnect");
    await calleeWs2.close();
    await callerWs.close();
  }

  // ── 3. Caller hangs up while callee is offline → parked ring dropped ─────
  console.log("\nScenario 2: caller hangs up before callee wakes → no replay");
  {
    await registerVoipToken(callee);
    const callerWs = await connectClient(caller);
    const callId = `call-${hex(6)}`;
    callerWs.send({ type: "call-ring", to: callee.alias, callId, callMode: "voice" });
    await settle();
    callerWs.send({ type: "call-hangup", to: callee.alias, callId });
    await settle();

    const calleeWs = await connectClient(callee);
    await settle();
    assert(calleeWs.ringsFor().length === 0, "no call-ring replayed after caller hangup");
    await calleeWs.close();
    await callerWs.close();
  }

  // ── 4. TTL expiry → no replay ─────────────────────────────────────────────
  console.log("\nScenario 3: callee wakes after TTL expiry → no replay");
  {
    await registerVoipToken(callee);
    const callerWs = await connectClient(caller);
    callerWs.send({ type: "call-ring", to: callee.alias, callId: `call-${hex(6)}` });
    await settle();
    await sleep(TTL_MS + 500); // sleep past expiry (sweep may or may not have run)

    const calleeWs = await connectClient(callee);
    await settle();
    assert(calleeWs.ringsFor().length === 0, "no call-ring replayed after TTL expiry");
    await calleeWs.close();
    await callerWs.close();
  }

  // ── 5. Second ring overwrites the first ──────────────────────────────────
  console.log("\nScenario 4: second call-ring overwrites the first parked ring");
  {
    await registerVoipToken(callee);
    const callerWs = await connectClient(caller);
    callerWs.send({ type: "call-ring", to: callee.alias, callId: `stale-${hex(6)}` });
    await settle();
    await registerVoipToken(callee); // first push attempt pruned the test token
    const freshCallId = `fresh-${hex(6)}`;
    callerWs.send({ type: "call-ring", to: callee.alias, callId: freshCallId });
    await settle();

    const calleeWs = await connectClient(callee);
    await settle();
    const rings = calleeWs.ringsFor();
    assert(rings.length === 1, "exactly one ring replayed when two were parked");
    assert(rings[0]?.callId === freshCallId, "the replayed ring is the NEWEST call");
    await calleeWs.close();
    await callerWs.close();
  }

  // ── Cleanup: drop the throwaway test users ────────────────────────────────
  const cleanup = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cleanup.connect();
  for (const table of ["device_tokens", "identity_keys", "call_push_tokens"]) {
    await cleanup.query(`DELETE FROM ${table} WHERE user_id = ANY($1)`, [
      [caller.alias, callee.alias],
    ]);
  }
  await cleanup.end();

  console.log(
    failures === 0 ? "\nAll pending-ring checks passed." : `\n${failures} check(s) FAILED.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => stopServer());
