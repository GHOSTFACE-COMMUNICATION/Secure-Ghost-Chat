import jwt from "jsonwebtoken";
import { createHash, createHmac, randomBytes } from "crypto";

/**
 * JWT helpers for device auth (task #198).
 *
 * Access token:  15-minute JWT signed with the access secret. Verified
 *                stateless on every request — no DB query.
 * Refresh token: 30-day JWT signed with a separate refresh secret. Its
 *                SHA-256 hash is stored in refresh_tokens so it can be
 *                rotated / revoked server-side.
 *
 * Secrets come from JWT_SECRET / JWT_REFRESH_SECRET. If those are unset we
 * derive stable, distinct secrets from SESSION_SECRET (HMAC domain
 * separation) so the server still starts securely with the existing secret
 * material. If nothing is configured, startup fails loudly.
 */

const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
const ISSUER = "ghostface-api";

function resolveSecret(envKey: string, derivationLabel: string): string {
  const explicit = process.env[envKey];
  if (explicit && explicit.length >= 16) return explicit;
  const session = process.env.SESSION_SECRET;
  if (session && session.length >= 16) {
    // Domain-separated derivation so access and refresh secrets differ.
    return createHmac("sha256", session).update(derivationLabel).digest("hex");
  }
  throw new Error(
    `Missing JWT signing secret: set ${envKey} (or SESSION_SECRET as a fallback) in the environment`,
  );
}

const ACCESS_SECRET = resolveSecret("JWT_SECRET", "ghostface-jwt-access-v1");
const REFRESH_SECRET = resolveSecret("JWT_REFRESH_SECRET", "ghostface-jwt-refresh-v1");

export interface AccessTokenClaims {
  sub: string; // userId (normalized alias)
  typ: "access";
}

export interface RefreshTokenClaims {
  sub: string;
  typ: "refresh";
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ typ: "access" }, ACCESS_SECRET, {
    subject: userId,
    issuer: ISSUER,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
  });
}

/** Returns the signed refresh token plus its absolute expiry (Date). */
export function signRefreshToken(userId: string): { token: string; expiresAt: Date } {
  // jti makes every refresh token unique even when minted for the same user
  // within the same second — required because refresh_tokens.token_hash is
  // UNIQUE and rotation would otherwise collide on rapid re-registration.
  const token = jwt.sign({ typ: "refresh" }, REFRESH_SECRET, {
    subject: userId,
    issuer: ISSUER,
    expiresIn: REFRESH_TOKEN_TTL_SEC,
    jwtid: randomBytes(16).toString("hex"),
  });
  return { token, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000) };
}

/** Verify an access token. Returns the userId (sub) or null if invalid/expired. */
export function verifyAccessToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, ACCESS_SECRET, { issuer: ISSUER }) as jwt.JwtPayload;
    if (payload.typ !== "access" || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/** Verify a refresh token signature/expiry. Returns the userId or null. */
export function verifyRefreshToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, REFRESH_SECRET, { issuer: ISSUER }) as jwt.JwtPayload;
    if (payload.typ !== "refresh" || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/** Cheap structural test: is this Bearer credential shaped like a JWT? */
export function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

/** SHA-256 hex hash used to store/lookup refresh tokens at rest. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
