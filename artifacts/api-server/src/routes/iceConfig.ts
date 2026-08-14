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
  source: "twilio" | "static" | "openrelay";
  ttl: number;
};

const STUN_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const REFRESH_SKEW_MS = 60_000;
const TWILIO_FETCH_TIMEOUT_MS = 4_000;

type CachedConfig = { body: IceConfigResponse; expiresAt: number };
let cached: CachedConfig | null = null;

// Per-IP rate limit. TURN credentials are real money (Twilio NTS) and even
// though we cache them, leaking a fresh token lets a stranger relay media
// through our account. 600 requests / hour / IP covers normal call usage
// (including client reconnect/retry bursts around CallKit answer/WS
// re-auth) while still bounding scraping.
const limiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 600 });

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

// Metered's Open Relay project — a free, public, shared TURN relay. No
// signup/API key needed: credentials are generated locally via the standard
// TURN REST API static-auth-secret scheme (RFC draft-uberti-behave-turn-rest;
// this is the same mechanism coturn's use-auth-secret implements, and what
// Metered's docs say Nextcloud Talk uses against this exact relay). Kept
// below Twilio and any self-hosted TURN_URLS in the fallback chain — it's a
// shared public resource with no capacity/reliability guarantee, meant as a
// stopgap so calls behind strict NAT aren't stuck on STUN-only.
const OPENRELAY_HOST = "staticauth.openrelay.metered.ca";
const OPENRELAY_SECRET = "openrelayprojectsecret";
const OPENRELAY_TTL_SECONDS = 3600;

function openRelayConfig(): IceConfigResponse {
  const username = String(Math.floor(Date.now() / 1000) + OPENRELAY_TTL_SECONDS);
  const credential = createHmac("sha1", OPENRELAY_SECRET).update(username).digest("base64");

  const turnEntries: IceServer[] = [
    { urls: `turn:${OPENRELAY_HOST}:80`, username, credential },
    { urls: `turn:${OPENRELAY_HOST}:443`, username, credential },
    { urls: `turns:${OPENRELAY_HOST}:443?transport=tcp`, username, credential },
  ];

  return {
    iceServers: [...STUN_SERVERS, ...turnEntries],
    source: "openrelay",
    ttl: OPENRELAY_TTL_SECONDS,
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
  // to every source — including the Open Relay fallback — so we don't
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

  const fromStatic = staticConfigFromEnv();
  if (fromStatic) {
    cached = { body: fromStatic, expiresAt: now + fromStatic.ttl * 1000 };
    res.json(fromStatic);
    return;
  }

  const fromOpenRelay = openRelayConfig();
  cached = { body: fromOpenRelay, expiresAt: now + fromOpenRelay.ttl * 1000 };
  logger.warn(
    "No TWILIO_*/TURN_URLS configured — falling back to Metered's public Open Relay TURN.",
  );
  res.json(fromOpenRelay);
});

export default router;
