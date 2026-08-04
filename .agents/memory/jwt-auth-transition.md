---
name: JWT auth transition
description: Dual-credential auth (JWT + legacy opaque token) on the API server and mobile client
---

Auth is JWT-based (15-min access / 30-day refresh with rotation, hashes in `refresh_tokens`), but legacy opaque device tokens (hash in `device_tokens`) are still accepted during a transition window.

**Rules:**
- All server-side Bearer validation must go through the shared helpers in the api-server `middlewares/deviceAuth.ts` (`resolveBearerUser`, `getAuthedAliasUnified`) — never re-add per-route SHA-256 `device_tokens` lookups.
- An expired/tampered JWT is a hard reject; it must NOT fall through to the legacy hash lookup.
- JWT secrets come from `JWT_SECRET`/`JWT_REFRESH_SECRET`, else are HMAC-derived from `SESSION_SECRET` (domain-separated). Changing SESSION_SECRET invalidates all JWTs.
- Refresh rotation is single-use: the row is claimed with an atomic conditional UPDATE (revoked_at IS NULL, unexpired) — keep it that way or concurrent refreshes enable token replay.
- Mobile client: the ghostface `lib/api.ts` module owns the token pair; use `authFetch` for authed calls (it refreshes once on 401/403, single-flight — parallel refreshes would burn the rotated refresh token).
- `state.deviceToken` in AppContext holds the current Bearer credential (access JWT preferred, legacy token fallback).

**Why:** refresh rotation revokes the presented token on first use; duplicate refreshes or stray legacy fallbacks silently log users out or reopen the pre-JWT auth surface.
