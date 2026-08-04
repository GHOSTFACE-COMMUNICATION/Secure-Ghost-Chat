/**
 * Authenticated API client with automatic JWT refresh (task #198).
 *
 * The server now issues a short-lived (15 min) access token and a 30-day
 * refresh token at registration. This module owns the token pair:
 *
 *  - `authFetch` attaches `Authorization: Bearer <accessToken>` and, on a
 *    401/403, transparently rotates the pair via POST /auth/refresh and
 *    retries the original request exactly once.
 *  - Tokens persist in SecureStore (Keychain / Keystore). On web, SecureStore
 *    is unavailable, so AsyncStorage is the fallback — same tradeoff as the
 *    rest of the app's web build.
 *  - Legacy devices that only hold the old opaque device token keep working:
 *    with no refresh token stored, `authFetch` just sends the legacy token
 *    and never attempts a refresh (the server still accepts it).
 *
 * Refresh failure (token expired/revoked server-side) clears the stored pair
 * and fires the registered `onAuthFailure` handler so the app can route the
 * user back through onboarding.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const ACCESS_TOKEN_KEY = "ghostface_access_token";
export const REFRESH_TOKEN_KEY = "ghostface_refresh_token";
// Legacy opaque device token (pre-JWT). Kept as a send-credential fallback.
const LEGACY_DEVICE_TOKEN_KEY = "ghostface_device_token";

const isWeb = Platform.OS === "web";

async function storeGet(key: string): Promise<string | null> {
  try {
    return isWeb ? await AsyncStorage.getItem(key) : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function storeSet(key: string, value: string): Promise<void> {
  try {
    if (isWeb) await AsyncStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // best-effort — in-memory copy still valid for this session
  }
}

async function storeDelete(key: string): Promise<void> {
  try {
    if (isWeb) await AsyncStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

export function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) return "";
  return `https://${domain}/api`;
}

// ── In-memory token state ─────────────────────────────────────────────────────

let accessToken: string | null = null;
let refreshToken: string | null = null;
let legacyDeviceToken: string | null = null;
let onAuthFailure: (() => void) | null = null;
let onTokensRotated: ((access: string) => void) | null = null;

// Single-flight: concurrent 401s must not fire parallel rotations — the
// server revokes the presented refresh token on first use, so a second
// concurrent refresh with the same token would fail and log the user out.
let refreshInFlight: Promise<boolean> | null = null;

/** Load persisted tokens into memory. Call once on app start. */
export async function loadAuthTokens(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
  legacyDeviceToken: string | null;
}> {
  [accessToken, refreshToken, legacyDeviceToken] = await Promise.all([
    storeGet(ACCESS_TOKEN_KEY),
    storeGet(REFRESH_TOKEN_KEY),
    storeGet(LEGACY_DEVICE_TOKEN_KEY),
  ]);
  return { accessToken, refreshToken, legacyDeviceToken };
}

/** Persist and adopt a fresh token set (registration or refresh). */
export async function setAuthTokens(tokens: {
  accessToken?: string | null;
  refreshToken?: string | null;
  legacyDeviceToken?: string | null;
}): Promise<void> {
  if (tokens.accessToken !== undefined) {
    accessToken = tokens.accessToken;
    if (tokens.accessToken) await storeSet(ACCESS_TOKEN_KEY, tokens.accessToken);
    else await storeDelete(ACCESS_TOKEN_KEY);
  }
  if (tokens.refreshToken !== undefined) {
    refreshToken = tokens.refreshToken;
    if (tokens.refreshToken) await storeSet(REFRESH_TOKEN_KEY, tokens.refreshToken);
    else await storeDelete(REFRESH_TOKEN_KEY);
  }
  if (tokens.legacyDeviceToken !== undefined) {
    legacyDeviceToken = tokens.legacyDeviceToken;
    // Legacy key persistence stays owned by AppContext (secureSet), so no
    // write here — this just keeps the in-memory send-credential in sync.
  }
}

/** Remove all auth material (panic wipe / logout). */
export async function clearAuthTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  legacyDeviceToken = null;
  await Promise.all([storeDelete(ACCESS_TOKEN_KEY), storeDelete(REFRESH_TOKEN_KEY)]);
}

/** The credential to present as Bearer right now (JWT preferred). */
export function currentBearerToken(): string | null {
  return accessToken ?? legacyDeviceToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

/** Called when a refresh definitively fails — tokens are already cleared. */
export function setOnAuthFailure(fn: (() => void) | null): void {
  onAuthFailure = fn;
}

/** Called after a successful rotation so app state can track the new access token. */
export function setOnTokensRotated(fn: ((access: string) => void) | null): void {
  onTokensRotated = fn;
}

// ── Refresh ───────────────────────────────────────────────────────────────────

async function doRefresh(): Promise<boolean> {
  const apiBase = getApiBase();
  const presented = refreshToken;
  if (!apiBase || !presented) return false;
  try {
    const res = await fetch(`${apiBase}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: presented }),
    });
    if (res.status === 401) {
      // Expired or revoked server-side — this session is over.
      await clearAuthTokens();
      onAuthFailure?.();
      return false;
    }
    if (!res.ok) return false; // transient (429/5xx/network) — keep tokens, fail this attempt
    const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
    if (!data.accessToken || !data.refreshToken) return false;
    await setAuthTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    onTokensRotated?.(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

/** Rotate the token pair, deduplicating concurrent callers. */
export async function refreshTokens(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// ── Fetch wrapper ─────────────────────────────────────────────────────────────

/**
 * fetch() that injects the current Bearer credential and retries once after
 * a background token refresh when the server answers 401/403. Non-auth
 * options pass through untouched.
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const buildInit = (): RequestInit => {
    const token = currentBearerToken();
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return { ...init, headers };
  };

  const res = await fetch(url, buildInit());
  if ((res.status !== 401 && res.status !== 403) || !refreshToken) return res;

  const refreshed = await refreshTokens();
  if (!refreshed) return res;
  return fetch(url, buildInit());
}

/** Best-effort server-side revocation of the current refresh token. */
export async function revokeRefreshToken(): Promise<void> {
  const apiBase = getApiBase();
  const presented = refreshToken;
  if (!apiBase || !presented) return;
  try {
    await fetch(`${apiBase}/auth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: presented }),
    });
  } catch {
    // wipe must never block on the network
  }
}
