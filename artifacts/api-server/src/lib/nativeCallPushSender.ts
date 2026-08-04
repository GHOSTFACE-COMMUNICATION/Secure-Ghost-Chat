/**
 * Native full-screen call ring pushes (task #152).
 *
 * Delivers the wake-up for dev/production builds that carry the
 * expo-callkit-telecom native module:
 * - iOS:     APNs VoIP push (PushKit) → native CallKit sheet, full-screen
 *            while locked, keeps ringing, answer/decline without unlocking.
 * - Android: FCM v1 data message → Core-Telecom full-screen-intent ring.
 *
 * Both payloads carry the module's `incomingCall` event nested per its
 * transport convention. Privacy contract (same as callPushSender.ts): the
 * payload transits APNs/FCM in the clear, so it holds ONLY the opaque
 * serverCallId and the call mode — the caller field is a fixed, generic
 * "GHOSTFACE" identity, never the alias. The real caller is resolved in-app
 * over the encrypted WebSocket after wake (parked-ring replay).
 *
 * Credentials (all optional — when absent, the transport is reported
 * unconfigured and the ring falls back to whatever Expo alert tokens exist):
 * - APNS_VOIP_KEY   — contents of the .p8 APNs auth key (literal \n accepted)
 * - APNS_KEY_ID     — 10-char key id for that key
 * - APNS_TEAM_ID    — Apple developer team id
 * - APNS_BUNDLE_ID  — app bundle id (default com.ghostface.app; the VoIP
 *                     topic `${bundleId}.voip` is derived from it)
 * - APNS_USE_SANDBOX— "1" to target api.sandbox.push.apple.com (dev builds)
 * - FCM_SERVICE_ACCOUNT — Firebase service-account JSON (client_email,
 *                     private_key, project_id) for FCM HTTP v1
 *
 * Zero new dependencies: ES256/RS256 JWTs via node:crypto, APNs over
 * node:http2, FCM/OAuth over fetch.
 */
import { createPrivateKey, createSign, randomUUID, sign as cryptoSign } from "node:crypto";
import http2 from "node:http2";
import { logger } from "./logger";
import type { CallPushData } from "./callPushSender";

// ── Payload ─────────────────────────────────────────────────────────────────

/** expo-callkit-telecom IncomingCallEvent — identity-free variant. */
function buildIncomingCallEvent(data: CallPushData) {
  return {
    eventId: randomUUID(),
    serverCallId: data.callId,
    hasVideo: data.mode === "video",
    startedAt: new Date().toISOString(),
    // Deliberately generic: the lock-screen sheet must never leak who is
    // calling. "id" is required by the module but only needs to be opaque.
    caller: { id: "ghost", displayName: "GHOSTFACE" },
    metadata: { mode: data.mode },
  };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function normalizePem(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

// ── APNs (iOS) ──────────────────────────────────────────────────────────────

type ApnsConfig = { key: string; keyId: string; teamId: string; bundleId: string; host: string };

function apnsConfig(): ApnsConfig | null {
  const key = process.env.APNS_VOIP_KEY;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!key || !keyId || !teamId) return null;
  return {
    key: normalizePem(key),
    keyId,
    teamId,
    bundleId: process.env.APNS_BUNDLE_ID ?? "com.ghostface.app",
    host:
      process.env.APNS_USE_SANDBOX === "1"
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com",
  };
}

let apnsJwtCache: { jwt: string; issuedAt: number } | null = null;

/** ES256 provider-token JWT, cached ~40 min (APNs allows 20–60 min). */
function apnsJwt(cfg: ApnsConfig): string {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwtCache && now - apnsJwtCache.issuedAt < 40 * 60) return apnsJwtCache.jwt;
  const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: now }));
  const signingInput = `${header}.${claims}`;
  const keyObj = createPrivateKey(cfg.key);
  const sig = cryptoSign("sha256", Buffer.from(signingInput), {
    key: keyObj,
    dsaEncoding: "ieee-p1363", // JOSE raw r||s, not ASN.1
  });
  const jwt = `${signingInput}.${b64url(sig)}`;
  apnsJwtCache = { jwt, issuedAt: now };
  return jwt;
}

/**
 * Sends one APNs VoIP push. Resolves to "ok", "bad-token" (prune it), or
 * "error" (transient/config problem — keep the token).
 */
function sendApnsVoipPush(
  cfg: ApnsConfig,
  deviceToken: string,
  body: string,
): Promise<"ok" | "bad-token" | "error"> {
  return new Promise((resolve) => {
    const client = http2.connect(cfg.host);
    const finish = (r: "ok" | "bad-token" | "error") => {
      client.close();
      resolve(r);
    };
    client.on("error", (err) => {
      logger.warn({ err }, "[nativeCallPush] APNs connection error");
      finish("error");
    });
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${apnsJwt(cfg)}`,
      "apns-topic": `${cfg.bundleId}.voip`,
      "apns-push-type": "voip",
      "apns-priority": "10",
      // Ring window: caller gives up after 30 s (app/call.tsx).
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 30),
      "content-type": "application/json",
    });
    let status = 0;
    let responseBody = "";
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      responseBody += c;
    });
    req.on("end", () => {
      if (status === 200) return finish("ok");
      const reason = /"reason"\s*:\s*"([^"]+)"/.exec(responseBody)?.[1] ?? "";
      const badToken = status === 410 || reason === "BadDeviceToken" || reason === "Unregistered";
      logger.warn({ status, reason }, "[nativeCallPush] APNs VoIP push rejected");
      finish(badToken ? "bad-token" : "error");
    });
    req.on("error", (err) => {
      logger.warn({ err }, "[nativeCallPush] APNs request error");
      finish("error");
    });
    req.end(body);
  });
}

// ── FCM v1 (Android) ────────────────────────────────────────────────────────

type FcmConfig = { clientEmail: string; privateKey: string; projectId: string };

function fcmConfig(): FcmConfig | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as {
      client_email?: string;
      private_key?: string;
      project_id?: string;
    };
    if (!sa.client_email || !sa.private_key || !sa.project_id) return null;
    return {
      clientEmail: sa.client_email,
      privateKey: normalizePem(sa.private_key),
      projectId: sa.project_id,
    };
  } catch {
    logger.warn("[nativeCallPush] FCM_SERVICE_ACCOUNT is not valid JSON");
    return null;
  }
}

let fcmTokenCache: { accessToken: string; expiresAt: number } | null = null;

/** OAuth2 access token via the RS256 service-account JWT grant, cached. */
async function fcmAccessToken(cfg: FcmConfig): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (fcmTokenCache && now < fcmTokenCache.expiresAt - 60) return fcmTokenCache.accessToken;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(signer.sign(cfg.privateKey))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    logger.warn({ status: res.status }, "[nativeCallPush] FCM OAuth token exchange failed");
    return null;
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  fcmTokenCache = { accessToken: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
  return json.access_token;
}

async function sendFcmDataMessage(
  cfg: FcmConfig,
  deviceToken: string,
  incomingCallEvent: object,
): Promise<"ok" | "bad-token" | "error"> {
  const accessToken = await fcmAccessToken(cfg);
  if (!accessToken) return "error";
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${cfg.projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        android: { priority: "HIGH", ttl: "30s" },
        // expo-callkit-telecom's FCM service expects the event JSON-encoded
        // under data.incomingCall (FCM data values must be strings).
        data: {
          messageType: "incomingCall",
          incomingCall: JSON.stringify(incomingCallEvent),
        },
      },
    }),
  });
  if (res.ok) return "ok";
  const text = await res.text().catch(() => "");
  const badToken = res.status === 404 || text.includes("UNREGISTERED");
  logger.warn({ status: res.status }, "[nativeCallPush] FCM data message rejected");
  return badToken ? "bad-token" : "error";
}

// ── Public API ──────────────────────────────────────────────────────────────

export type NativeTokenType = "apns-voip" | "fcm";

/** True when the transport for `tokenType` has credentials configured. */
export function isNativeCallPushConfigured(tokenType: NativeTokenType): boolean {
  return tokenType === "apns-voip" ? apnsConfig() !== null : fcmConfig() !== null;
}

/**
 * Sends the native ring push to one device token. Returns "bad-token" when
 * the token should be pruned, "unconfigured" when credentials for its
 * transport are missing.
 */
export async function sendNativeCallPush(
  tokenType: NativeTokenType,
  deviceToken: string,
  data: CallPushData,
): Promise<"ok" | "bad-token" | "error" | "unconfigured"> {
  const event = buildIncomingCallEvent(data);
  if (tokenType === "apns-voip") {
    const cfg = apnsConfig();
    if (!cfg) return "unconfigured";
    // APNs nests the event directly in the push dictionary.
    return sendApnsVoipPush(cfg, deviceToken, JSON.stringify({ incomingCall: event }));
  }
  const cfg = fcmConfig();
  if (!cfg) return "unconfigured";
  return sendFcmDataMessage(cfg, deviceToken, event);
}
