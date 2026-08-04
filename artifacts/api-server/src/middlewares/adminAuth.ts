import { type Request, type Response, type NextFunction } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared-secret gate for all /admin surfaces (task #168, hardened in #182).
 *
 * Requests must present the ADMIN_SECRET credential via one of:
 *   - `x-admin-secret: <secret>` header (preferred for scripts/curl)
 *   - `Authorization: Bearer <secret>` header (monitoring/health-check tools)
 *   - a signed `admin_session` cookie (browser access — set by POST
 *     /api/admin/login or by a one-time `?key=` visit that is immediately
 *     redirected to strip the secret from the URL)
 *   - `?key=<secret>` query parameter — accepted for backward compatibility,
 *     but never granted directly: the middleware sets the session cookie and
 *     302-redirects to the same URL without `key`, so the secret does not
 *     persist in browser history / referrers (task #182).
 *
 * When ADMIN_SECRET is not configured the endpoints are disabled entirely
 * (503) — never open.
 */

export const ADMIN_COOKIE_NAME = "admin_session";

function safeEqual(provided: string, expected: Buffer): boolean {
  const a = Buffer.from(provided);
  return provided.length > 0 && a.length === expected.length && timingSafeEqual(a, expected);
}

/** Constant-time check of a raw secret against ADMIN_SECRET. */
export function isValidAdminSecret(provided: string): boolean {
  const configured = process.env.ADMIN_SECRET;
  if (!configured) return false;
  return safeEqual(provided, Buffer.from(configured));
}

/**
 * Cookie value derived from ADMIN_SECRET (HMAC, never the secret itself).
 * Rotating ADMIN_SECRET invalidates all outstanding sessions.
 */
export function adminSessionValue(): string {
  const configured = process.env.ADMIN_SECRET ?? "";
  return createHmac("sha256", configured).update("ghostface-admin-session-v1").digest("hex");
}

export function setAdminSessionCookie(req: Request, res: Response): void {
  const secure = req.secure || req.header("x-forwarded-proto") === "https";
  res.cookie(ADMIN_COOKIE_NAME, adminSessionValue(), {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/api",
    maxAge: 12 * 60 * 60 * 1000, // 12h
  });
}

/** Minimal cookie-header parser (cookie-parser is not mounted app-wide). */
function readCookie(req: Request, name: string): string {
  const raw = req.header("cookie") ?? "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return "";
      }
    }
  }
  return "";
}

/**
 * True when the request carries a valid header credential or a valid signed
 * session cookie. Does NOT consult the `?key=` query parameter.
 */
export function isAdminAuthorized(req: Request): boolean {
  const configured = process.env.ADMIN_SECRET;
  if (!configured) return false;
  const expected = Buffer.from(configured);
  const bearer = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if ([req.header("x-admin-secret") ?? "", bearer].some((p) => safeEqual(p, expected))) {
    return true;
  }
  // Signed session cookie (browser sessions — never contains the secret).
  return safeEqual(readCookie(req, ADMIN_COOKIE_NAME), Buffer.from(adminSessionValue()));
}

export function requireAdminSecret(req: Request, res: Response, next: NextFunction) {
  const configured = process.env.ADMIN_SECRET;
  if (!configured) {
    return res.status(503).json({ error: "admin endpoints disabled (ADMIN_SECRET not set)" });
  }

  const expected = Buffer.from(configured);
  if (isAdminAuthorized(req)) {
    next();
    return undefined;
  }

  // Legacy `?key=` — validate, then set the cookie and strip the key from the
  // URL via redirect so the secret never persists in browser history (task #182).
  const queryKey = typeof req.query["key"] === "string" ? req.query["key"] : "";
  if (queryKey && safeEqual(queryKey, expected)) {
    if (req.method === "GET" || req.method === "HEAD") {
      setAdminSessionCookie(req, res);
      const url = new URL(req.originalUrl, "http://placeholder");
      url.searchParams.delete("key");
      return res.redirect(302, url.pathname + url.search);
    }
    // Non-idempotent methods can't be safely redirected; allow this request
    // through (unchanged behavior for scripted POSTs using ?key=).
    next();
    return undefined;
  }

  return res.status(401).json({ error: "unauthorized" });
}
