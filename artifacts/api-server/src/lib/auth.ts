/**
 * Device-token authentication, shared.
 *
 * The server issues a per-identity device token at registration and stores
 * only its SHA-256 hash in `device_tokens`. A caller proves identity by
 * sending `Authorization: Bearer <token>` together with the alias it claims
 * — the alias is required because `device_tokens.token_hash` is not unique,
 * only `user_id` is, so there is no way to resolve a token on its own.
 *
 * ── The enforcement flag ──────────────────────────────────────────────────
 *
 * `ENFORCE_ENDPOINT_AUTH` gates whether a missing/bad credential is REJECTED
 * on the endpoints that were historically unauthenticated (POST /blobs,
 * GET /ice-config, POST /invites). It defaults to OFF, and that default is
 * deliberate and load-bearing:
 *
 *   No app build shipped before 27 Aug 2026 sends this header. Turning
 *   enforcement on before such a release is in users' hands breaks blob
 *   upload and TURN for every existing install. /ice-config is the worst
 *   of the three — the client fails OPEN to STUN-only, so a 401 does not
 *   surface an error, it silently degrades calls for anyone behind a
 *   symmetric NAT.
 *
 * So this ships to production OFF, behaves exactly as today, and is flipped
 * to "1" only once the app release carrying the client half is out. Flipping
 * it is a Railway variable change, not a deploy, so it is also instantly
 * reversible if something was missed.
 *
 * While it is off, unauthenticated requests are logged (see `logUnauthed`)
 * so the remaining volume of legacy clients is observable before flipping.
 */

import { createHash } from "crypto";
import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { normalizeAlias } from "../utils/alias";
import { RateLimiter, getIpKey } from "./rateLimiter";
import { logger } from "./logger";

/**
 * Failed-auth gate, per IP. Same rationale as the one in messages.ts: only
 * requests that fail authentication charge this bucket, so legitimate users
 * behind carrier NAT never touch it, while an unauthenticated flood is cut
 * off before it reaches the device-token lookup.
 */
const authFailureGate = new RateLimiter({ windowMs: 60_000, max: 30, prefix: "authFailShared" });

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** True when auth is being enforced on the historically-open endpoints. */
export function isAuthEnforced(): boolean {
  const raw = process.env.ENFORCE_ENDPOINT_AUTH?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Resolve the authenticated alias from a Bearer token plus a claimed alias
 * (`?alias=` or `body.alias`/`body.ownerAlias`). Returns null when the
 * credential is absent, malformed, or does not match a stored device token.
 *
 * Never throws for a bad credential — callers decide what a null means.
 */
export async function getAuthedAlias(req: Request): Promise<string | null> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;

  const claimed =
    (req.query["alias"] as string | undefined) ??
    (req.body?.alias as string | undefined) ??
    (req.body?.ownerAlias as string | undefined);
  if (!claimed) return null;

  const alias = normalizeAlias(claimed);
  if (!alias) return null;

  // Imported lazily and only once a credential is actually present.
  // `@workspace/db` throws at import time when DATABASE_URL is unset, and a
  // static import here would drag that requirement into every module that
  // gates on auth — including routes/blobs.ts, whose test suite is
  // deliberately hermetic and runs with no database at all.
  const { db, deviceTokensTable } = await import("@workspace/db");

  const [row] = await db
    .select()
    .from(deviceTokensTable)
    .where(
      and(eq(deviceTokensTable.userId, alias), eq(deviceTokensTable.tokenHash, hashToken(token))),
    );

  return row ? alias : null;
}

export type AuthOutcome =
  /** Authenticated, or unauthenticated while enforcement is off. */
  | { ok: true; alias: string | null }
  /** Rejected — a 401/403/429 has already been written to `res`. */
  | { ok: false };

/**
 * Gate a historically-unauthenticated endpoint.
 *
 * With `ENFORCE_ENDPOINT_AUTH` off (the default) this never rejects: it
 * resolves the alias when a valid credential is present and otherwise
 * returns `{ ok: true, alias: null }`, so pre-27-Aug clients behave exactly
 * as they do today. With the flag on, a missing or bad credential is a 401.
 *
 * Usage:
 *   const auth = await checkAuth(req, res, "blobUpload");
 *   if (!auth.ok) return;            // response already sent
 *   // auth.alias is the caller, or null only while enforcement is off
 */
export async function checkAuth(
  req: Request,
  res: Response,
  label: string,
): Promise<AuthOutcome> {
  const alias = await getAuthedAlias(req);
  if (alias) return { ok: true, alias };

  if (!isAuthEnforced()) {
    logUnauthed(req, label);
    return { ok: true, alias: null };
  }

  // Enforcing: charge the failed-auth bucket before answering, so a flood of
  // bad credentials is cut off rather than each one costing a DB lookup.
  if (!(await authFailureGate.check(getIpKey(req)))) {
    res.status(429).json({ error: "Too many failed authentication attempts" });
    return { ok: false };
  }
  res.status(401).json({
    error: "Authorization: Bearer <device-token> and a matching alias are required",
  });
  return { ok: false };
}

/**
 * Record an unauthenticated call while enforcement is off. This is the
 * signal for deciding when it is safe to flip the flag: once these stop
 * appearing, every live client is sending the header. Logged at `warn` so
 * it survives a production LOG_LEVEL of `info` and is greppable by `label`.
 */
function logUnauthed(req: Request, label: string): void {
  logger.warn(
    { endpoint: label, ip: getIpKey(req) },
    "unauthenticated request allowed (ENFORCE_ENDPOINT_AUTH is off)",
  );
}
