import { type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

/**
 * Shared-secret gate for all /admin surfaces (task #168).
 *
 * Requests must present the ADMIN_SECRET credential via one of:
 *   - `x-admin-secret: <secret>` header (preferred for scripts/curl)
 *   - `Authorization: Bearer <secret>` header (monitoring/health-check tools)
 *   - `?key=<secret>` query parameter (browser access to the HTML dashboard;
 *     note the logger redacts auth headers and strips query strings from logs)
 *
 * When ADMIN_SECRET is not configured the endpoints are disabled entirely
 * (503) — never open.
 */
export function requireAdminSecret(req: Request, res: Response, next: NextFunction) {
  const configured = process.env.ADMIN_SECRET;
  if (!configured) {
    return res.status(503).json({ error: "admin endpoints disabled (ADMIN_SECRET not set)" });
  }

  const bearer = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const queryKey = typeof req.query["key"] === "string" ? req.query["key"] : "";
  const candidates = [req.header("x-admin-secret") ?? "", bearer, queryKey];

  const expected = Buffer.from(configured);
  const ok = candidates.some((provided) => {
    const a = Buffer.from(provided);
    return provided.length > 0 && a.length === expected.length && timingSafeEqual(a, expected);
  });

  if (!ok) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
  return undefined;
}
