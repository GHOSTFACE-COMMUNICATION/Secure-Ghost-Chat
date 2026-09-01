import { createHmac } from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { RateLimiter, GlobalLimiter, getIpKey } from "../lib/rateLimiter";
import { checkAuth } from "../lib/auth";

const router: IRouter = Router();

type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

type IceConfigResponse = {
  iceServers: IceServer[];
  source: "coturn" | "static" | "stun-only";
  ttl: number;
};

const STUN_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const REFRESH_SKEW_MS = 60_000;
const STUN_FALLBACK_TTL_SECONDS = 300;
const DEFAULT_TURN_TTL_SECONDS = 3_600;

type CachedConfig = { body: IceConfigResponse; expiresAt: number };
let cached: CachedConfig | null = null;

// Per-IP rate limit. A leaked credential lets a stranger relay media through
// our own coturn box — bandwidth and CPU on hardware we pay for — so these
// stay bounded even though the credentials are cached. 600 requests / hour / IP
// covers normal call usage
// (including client reconnect/retry bursts around CallKit answer/WS
// re-auth) while still bounding scraping.
const limiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 6_000, prefix: "iceConfig" });
// This hands out credentials to our own relay, so the cost is ours. Per-IP
// cannot discriminate under carrier NAT; the global cap is what actually
// bounds abuse.
const globalLimiter = new GlobalLimiter({ windowMs: 60 * 60 * 1000, max: 30_000, prefix: "iceConfigGlobal" });

// Literal, pre-issued static credentials — only reached when TURN_SECRET
// isn't set (see coturnConfig below, which takes priority when it is).
function staticConfigFromEnv(): IceConfigResponse | null {
  const urlsRaw = process.env.TURN_URLS?.trim();
  if (!urlsRaw) return null;
  const urls = urlsRaw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length === 0) return null;

  const username = process.env.TURN_USERNAME?.trim();
  const credential = process.env.TURN_CREDENTIAL?.trim();

  const turnEntry: IceServer = { urls };
  if (username) turnEntry.username = username;
  if (credential) turnEntry.credential = credential;

  return {
    iceServers: [...STUN_SERVERS, turnEntry],
    source: "static",
    ttl: 3600,
  };
}

// Self-hosted coturn, authenticated via use-auth-secret (RFC
// draft-uberti-behave-turn-rest's "TURN REST API" convention). coturn parses
// everything before the first colon in `username` as the credential's unix
// expiry timestamp, and computes the expected password as
// base64(HMAC-SHA1(secret, username)) over the FULL username string —
// timestamp, colon, and label all included. A bare timestamp with no colon
// (what this file used to send, aimed at Metered's Open Relay) doesn't parse
// as a valid coturn username at all and gets rejected outright.
function coturnConfig(): IceConfigResponse | null {
  const urlsRaw = process.env.TURN_URLS?.trim();
  const secret = process.env.TURN_SECRET?.trim();
  if (!urlsRaw || !secret) return null;
  const urls = urlsRaw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length === 0) return null;

  const ttl = Math.max(120, Number(process.env.TURN_TTL_SECONDS) || DEFAULT_TURN_TTL_SECONDS);
  const username = `${Math.floor(Date.now() / 1000) + ttl}:ghostface`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");

  return {
    iceServers: [...STUN_SERVERS, { urls, username, credential }],
    source: "coturn",
    ttl,
  };
}

router.get("/ice-config", async (req: Request, res: Response) => {
  // Authenticated read — the TURN credentials handed out here are our spend.
  // Gated by ENFORCE_ENDPOINT_AUTH; off (the default) this is a no-op.
  //
  // ⚠️ Flip the flag for this endpoint LAST and watch calls. The client
  // (app/call.tsx) catches any failure and falls back to STUN-only, so a 401
  // here does not surface an error to the user — it silently breaks calls for
  // anyone behind a symmetric NAT. Nothing will alert.
  const auth = await checkAuth(req, res, "GET /ice-config", "query");
  if (!auth.ok) return;

  if (!(await limiter.check(getIpKey(req))) || !(await globalLimiter.check())) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const now = Date.now();
  // Serve from cache until we're inside the refresh skew window. This applies
  // to every source — including the STUN-only fallback — so we don't
  // recompute on every request.
  if (cached && now < cached.expiresAt - REFRESH_SKEW_MS) {
    res.json(cached.body);
    return;
  }

  const fromCoturn = coturnConfig();
  if (fromCoturn) {
    cached = { body: fromCoturn, expiresAt: now + fromCoturn.ttl * 1000 };
    res.json(fromCoturn);
    return;
  }

  const fromStatic = staticConfigFromEnv();
  if (fromStatic) {
    cached = { body: fromStatic, expiresAt: now + fromStatic.ttl * 1000 };
    res.json(fromStatic);
    return;
  }

  const fallback: IceConfigResponse = {
    iceServers: STUN_SERVERS,
    source: "stun-only",
    ttl: STUN_FALLBACK_TTL_SECONDS,
  };
  cached = { body: fallback, expiresAt: now + STUN_FALLBACK_TTL_SECONDS * 1000 };
  // Silent degradation to STUN-only is exactly what made the last TURN outage
  // hard to find — signalling and ICE both "connect" fine, media just never
  // flows for anyone behind a symmetric NAT. Log loudly so this shows up in
  // deploy logs immediately instead of only surfacing as a user report.
  logger.warn(
    "No TURN configured (TURN_SECRET, or TURN_USERNAME/TURN_CREDENTIAL); " +
      "serving STUN-only. Calls will fail behind symmetric NAT.",
  );
  res.json(fallback);
});

export default router;
