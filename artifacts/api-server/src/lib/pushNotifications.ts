import { createSign } from "crypto";
import http2 from "http2";
import { logger } from "./logger";

export interface ExpoPushResult {
  ok: boolean;
  /**
   * True when Expo reported this exact token as permanently dead
   * (DeviceNotRegistered — app uninstalled, token revoked, etc.). The
   * caller should clear the stored token so we stop pushing to it forever;
   * every other failure (rate limit, transient network error, malformed
   * request) leaves the token alone since it may still be good.
   */
  invalidToken?: boolean;
}

/**
 * Regular push, via Expo's relay (which itself rides APNs on iOS and FCM on
 * Android). Used for "you have a new message" wake and, on Android only, for
 * incoming-call wake — Expo's relay has no VoIP-push equivalent, so iOS call
 * wake goes through sendVoipPushIOS below instead.
 *
 * Deliberately content-free beyond a generic body: never pass the sender's
 * alias or message plaintext here — this app's server never learns either,
 * and a push payload is visible to Apple/Google/Expo in transit.
 */
export async function sendExpoPush(
  token: string,
  body: string,
  data?: Record<string, unknown>,
  opts?: { channelId?: string },
): Promise<ExpoPushResult> {
  try {
    // This Expo project has "enhanced security for push notifications"
    // enabled (expo.dev → project → push notifications settings), which
    // rejects every send with 403 UNAUTHORIZED unless it carries an Expo
    // access token — generated at expo.dev/accounts/[account]/settings/
    // access-tokens, not the same as an EAS CLI login session. Without
    // this, every push silently fails (logged, but never delivered) —
    // exactly the "no notifications while backgrounded" symptom this was
    // added to fix.
    const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;

    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers,
      body: JSON.stringify([
        {
          to: token,
          sound: "default",
          title: "GHOSTFACE",
          body,
          priority: "high",
          data,
          channelId: opts?.channelId,
        },
      ]),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Expo push send failed");
      return { ok: false };
    }
    const json = (await res.json().catch(() => null)) as {
      data?: Array<{ status: string; message?: string; details?: { error?: string } }>;
    } | null;
    const result = json?.data?.[0];
    if (result?.status === "error") {
      logger.warn({ message: result.message }, "Expo push rejected");
      return { ok: false, invalidToken: result.details?.error === "DeviceNotRegistered" };
    }
    return { ok: true };
  } catch (err) {
    logger.warn({ err }, "Expo push send threw");
    return { ok: false };
  }
}

// ── Direct APNs VoIP push (iOS CallKit wake) ────────────────────────────────
// PushKit tokens can't be reached through Expo's relay — VoIP pushes require
// a direct HTTP/2 connection to APNs with `apns-push-type: voip` on the
// bundle's `.voip` topic. This needs an Apple Push Notifications Service
// Auth Key (.p8), configured via env vars below. Until those are set, this
// no-ops (logged once per attempt) rather than throwing — the rest of the
// call-signalling path degrades to the existing "callee offline" bounce.
interface ApnsConfig {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
  production: boolean;
}

function loadApnsConfig(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const privateKey = process.env.APNS_AUTH_KEY?.trim();
  if (!keyId || !teamId || !privateKey) return null;
  return {
    keyId,
    teamId,
    privateKey,
    bundleId: process.env.APNS_BUNDLE_ID?.trim() || "com.ghostface.app",
    production: process.env.APNS_ENV !== "sandbox",
  };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Apple provider tokens are valid up to 60 minutes; reusing one avoids
// resigning a JWT on every call push.
let cachedProviderToken: { jwt: string; expiresAt: number } | null = null;

function getProviderToken(config: ApnsConfig): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedProviderToken && cachedProviderToken.expiresAt > now + 60) return cachedProviderToken.jwt;

  const header = base64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const payload = base64url(JSON.stringify({ iss: config.teamId, iat: now }));
  const signingInput = `${header}.${payload}`;
  const signature = createSign("SHA256").update(signingInput).sign({
    key: config.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  const jwt = `${signingInput}.${base64url(signature)}`;
  cachedProviderToken = { jwt, expiresAt: now + 55 * 60 };
  return jwt;
}

/**
 * Sends a VoIP push carrying just enough to display a CallKit incoming-call
 * screen (callId/from/callMode) — never message content, since VoIP push
 * payloads aren't part of this app's E2EE envelope at all.
 */
export async function sendVoipPushIOS(voipToken: string, payload: Record<string, unknown>): Promise<void> {
  const config = loadApnsConfig();
  if (!config) {
    logger.warn(
      "APNS_KEY_ID/APNS_TEAM_ID/APNS_AUTH_KEY not configured — VoIP push skipped, " +
        "incoming calls will not wake a killed app on iOS until these are set",
    );
    return;
  }

  const host = config.production ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const jwt = getProviderToken(config);
  const body = JSON.stringify(payload);

  await new Promise<void>((resolve) => {
    const client = http2.connect(`https://${host}`);
    client.on("error", (err) => {
      logger.warn({ err }, "APNs VoIP push connection failed");
      resolve();
    });

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${voipToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": `${config.bundleId}.voip`,
      "apns-push-type": "voip",
      "apns-priority": "10",
      "apns-expiration": "0",
      "content-type": "application/json",
    });

    let responseBody = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      responseBody += chunk;
    });
    req.on("response", (headers) => {
      const status = headers[":status"];
      if (status !== 200) {
        logger.warn({ status, responseBody }, "APNs VoIP push rejected");
      }
    });
    req.on("end", () => {
      client.close();
      resolve();
    });
    req.on("error", (err) => {
      logger.warn({ err }, "APNs VoIP push request failed");
      client.close();
      resolve();
    });

    req.write(body);
    req.end();
  });
}
