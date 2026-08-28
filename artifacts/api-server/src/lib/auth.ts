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
 * Where a route accepts the caller's *claimed* alias from.
 *
 * Required at every call site — there is deliberately no default. The alias
 * a route reads for auth must be the same one its handler acts on, and a
 * default would let a new route silently inherit a wider source than it
 * means. Audited 27 Aug: every current handler uses the alias this function
 * *returns* and never re-reads `req.query.alias` / `req.body.alias` itself,
 * which is what makes the sources safe to differ. Keep it that way — if a
 * handler starts reading the raw field, it must read the same source named
 * here, or it will authenticate one user and act on another.
 */
export type AliasSource =
  /** `?alias=` only. */
  | "query"
  /** `?alias=`, falling back to `body.alias`. */
  | "query-or-body"
  /** `body.ownerAlias` — POST /invites, whose body names the owner. */
  | "body-owner-alias";

function claimedAlias(req: Request, source: AliasSource): string | undefined {
  switch (source) {
    case "query":
      return req.query["alias"] as string | undefined;
    case "query-or-body":
      return (
        (req.query["alias"] as string | undefined) ?? (req.body?.alias as string | undefined)
      );
    case "body-owner-alias":
      return req.body?.ownerAlias as string | undefined;
  }
}

/**
 * Check a device token against a claimed alias. Returns the normalized alias
 * on a match, else null. Throws only on an actual database fault — callers
 * that must never throw (the WebSocket handshake) wrap this themselves.
 */
export async function verifyDeviceToken(alias: string, token: string): Promise<string | null> {
  const normalized = normalizeAlias(alias);
  if (!normalized) return null;

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
      and(
        eq(deviceTokensTable.userId, normalized),
        eq(deviceTokensTable.tokenHash, hashToken(token)),
      ),
    );

  return row ? normalized : null;
}

/**
 * Resolve the authenticated alias from a Bearer token plus the alias claimed
 * in `source`. Returns null when the credential is absent, malformed, or does
 * not match a stored device token.
 *
 * Never throws for a bad credential — callers decide what a null means.
 */
export async function getAuthedAlias(req: Request, source: AliasSource): Promise<string | null> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;

  const claimed = claimedAlias(req, source);
  if (!claimed) return null;

  return verifyDeviceToken(claimed, token);
}

/**
 * Middleware for routes that carry the caller's identity in a `:userId` path
 * parameter (prekeys, push, vpn) rather than a query/body alias.
 *
 * Behaviour is the union of the three copies this replaces, which were code-
 * identical apart from vpn's failure gate:
 *   401  no Bearer token
 *   400  `:userId` is not a valid alias
 *   403  token does not match the stored device token for that userId
 * On success `req.params.userId` is overwritten with the normalized form, so
 * downstream handlers — which read it directly — never see the raw value.
 *
 * Pass `failureGate` to charge an IP bucket for failed authentication, as
 * vpn.ts does. It is consulted *before* the token lookup so an
 * unauthenticated flood cannot drive database load, and charged only on the
 * 401 and 403 paths: a malformed `:userId` is a client bug, not an auth
 * attempt, and must not fill the bucket. Only failures charge it, so
 * legitimate users behind carrier NAT never touch it.
 */
export function deviceAuthMiddleware(options: { failureGate?: RateLimiter } = {}) {
  const { failureGate } = options;

  return async function deviceAuth(
    req: Request,
    res: Response,
    next: () => void,
  ): Promise<void> {
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    const ipKey = failureGate ? getIpKey(req) : "";
    if (failureGate && !(await failureGate.allowed(ipKey))) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    if (!token) {
      if (failureGate) await failureGate.record(ipKey);
      res.status(401).json({ error: "Authorization: Bearer <token> header required" });
      return;
    }

    const normalizedUserId = normalizeAlias((req.params["userId"] as string) ?? "");
    if (!normalizedUserId) {
      res.status(400).json({ error: "userId must be 3-20 characters: A-Z, 0-9, underscore only" });
      return;
    }
    req.params["userId"] = normalizedUserId;

    if ((await verifyDeviceToken(normalizedUserId, token)) === null) {
      if (failureGate) await failureGate.record(ipKey);
      res.status(403).json({ error: "Invalid or mismatched device token for userId" });
      return;
    }

    next();
  };
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
 *   const auth = await checkAuth(req, res, "blobUpload", "query");
 *   if (!auth.ok) return;            // response already sent
 *   // auth.alias is the caller, or null only while enforcement is off
 */
export async function checkAuth(
  req: Request,
  res: Response,
  label: string,
  source: AliasSource,
): Promise<AuthOutcome> {
  const alias = await getAuthedAlias(req, source);
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
 * appearing, every live client is sending the header.
 *
 * Emitted at pino `warn` so it survives a production LOG_LEVEL of `info`.
 * Note that Railway renders it as `info` regardless — verified against the
 * live deploy 27 Aug, and the pre-existing logger.warn in iceConfig.ts does
 * the same, so it is platform behaviour, not ours. **Filter by the message
 * text or the `endpoint` attribute, never by severity**: a severity filter
 * finds nothing and would read as "all clients have updated".
 */
function logUnauthed(req: Request, label: string): void {
  logger.warn(
    { endpoint: label, ip: getIpKey(req) },
    "unauthenticated request allowed (ENFORCE_ENDPOINT_AUTH is off)",
  );
}
