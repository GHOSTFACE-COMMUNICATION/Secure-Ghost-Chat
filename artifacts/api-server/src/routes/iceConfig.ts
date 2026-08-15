import { createHmac } from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { RateLimiter, getIpKey } from "../lib/rateLimiter";

const router: IRouter = Router();

type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

type IceConfigResponse = {
  iceServers: IceServer[];
  source: "twilio" | "coturn" | "static" | "stun-only";
  ttl: number;
};

const STUN_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const REFRESH_SKEW_MS = 60_000;
const STUN_FALLBACK_TTL_SECONDS = 300;
const TWILIO_FETCH_TIMEOUT_MS = 4_000;
const DEFAULT_TURN_TTL_SECONDS = 3_600;

type CachedConfig = { body: IceConfigResponse; expiresAt: number };
let cached: CachedConfig | null = null;

// Per-IP rate limit. TURN credentials are real money (Twilio NTS) and even
// though we cache them, leaking a fresh token lets a stranger relay media
// through our account. 600 requests / hour / IP covers normal call usage
// (including client reconnect/retry bursts around CallKit answer/WS
// re-auth) while still bounding scraping.
const limiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 600 });

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

async function twilioConfig(): Promise<IceConfigResponse | null> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  if (!accountSid || !apiKeySid || !apiKeySecret) return null;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
    accountSid,
  )}/Tokens.json`;
  const auth = Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString("base64");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TWILIO_FETCH_TIMEOUT_MS);
  let res: Response | globalThis.Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "Ttl=3600",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio NTS request failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    ice_servers?: Array<{ url?: string; urls?: string; username?: string; credential?: string }>;
    ttl?: string;
  };
  const servers: IceServer[] = (data.ice_servers ?? [])
    .map((s) => {
      const urls = s.urls ?? s.url;
      if (!urls) return null;
      const entry: IceServer = { urls };
      if (s.username) entry.username = s.username;
      if (s.credential) entry.credential = s.credential;
      return entry;
    })
    .filter((s): s is IceServer => s !== null);

  if (servers.length === 0) return null;

  const ttl = Math.max(120, Number(data.ttl ?? 3600) || 3600);
  return { iceServers: servers, source: "twilio", ttl };
}

router.get("/ice-config", async (req: Request, res: Response) => {
  if (!limiter.check(getIpKey(req))) {
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

  try {
    const fromTwilio = await twilioConfig();
    if (fromTwilio) {
      cached = { body: fromTwilio, expiresAt: now + fromTwilio.ttl * 1000 };
      res.json(fromTwilio);
      return;
    }
  } catch (err) {
    logger.warn({ err }, "Twilio NTS unavailable, falling back");
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
  logger.warn(
    "No TWILIO_*/TURN_SECRET/TURN_URLS configured; calls behind strict NAT may fail.",
  );
  res.json(fallback);
});

export default router;
