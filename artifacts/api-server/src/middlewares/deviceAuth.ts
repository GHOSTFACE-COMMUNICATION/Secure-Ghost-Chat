import type { Request } from "express";
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, deviceTokensTable } from "@workspace/db";
import { normalizeAlias } from "../utils/alias";
import { looksLikeJwt, verifyAccessToken } from "../lib/jwt";

/**
 * Unified Bearer credential resolution (task #198).
 *
 * New clients present a JWT access token — verified statelessly, no DB
 * query. Legacy clients still hold the opaque random-hex device token whose
 * SHA-256 hash lives in device_tokens; those fall back to the old hash
 * lookup during the transition window. A tampered or expired JWT is
 * rejected outright (it never falls through to the legacy path — a JWT can
 * never collide with a stored legacy hash anyway).
 */

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function bearerToken(req: Request): string {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

/**
 * Resolve the authenticated userId from a raw Bearer credential, optionally
 * requiring it to match `expectedUserId`. Returns the authenticated userId
 * or null.
 */
export async function resolveBearerUser(
  token: string,
  expectedUserId?: string,
): Promise<string | null> {
  if (!token) return null;

  if (looksLikeJwt(token)) {
    const sub = verifyAccessToken(token);
    if (!sub) return null; // expired/tampered JWT — hard reject, no DB fallback
    if (expectedUserId !== undefined && sub !== normalizeAlias(expectedUserId)) return null;
    return sub;
  }

  // Legacy opaque device token — requires knowing which user it claims to be.
  if (expectedUserId === undefined) return null;
  const userId = normalizeAlias(expectedUserId);
  const hash = hashToken(token);
  const [row] = await db
    .select()
    .from(deviceTokensTable)
    .where(and(eq(deviceTokensTable.userId, userId), eq(deviceTokensTable.tokenHash, hash)));
  return row ? userId : null;
}

/**
 * Drop-in replacement for the per-route `getAuthedAlias` helpers: reads the
 * Bearer header; for a JWT the alias comes from the token itself (the
 * ?alias/body alias, when present, must match), for a legacy token the
 * caller-supplied alias is required for the hash lookup.
 */
export async function getAuthedAliasUnified(
  req: Request,
  claimedAlias?: string,
): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;
  if (looksLikeJwt(token)) {
    const sub = verifyAccessToken(token);
    if (!sub) return null;
    if (claimedAlias && normalizeAlias(claimedAlias) !== sub) return null;
    return sub;
  }
  if (!claimedAlias) return null;
  return resolveBearerUser(token, claimedAlias);
}
