/**
 * Device-token auth for authenticated API calls.
 *
 * The server issues a per-identity device token at registration
 * (POST /api/prekeys/register) and stores only its SHA-256 hash in
 * `device_tokens`, keyed by userId. Authenticated routes match the
 * Bearer token against the row for a given alias, so callers must send
 * BOTH the token and the alias — `token_hash` is not unique on its own,
 * only `user_id` is.
 *
 * This module exists because the token lives in SecureStore and the alias
 * in AsyncStorage, and both were previously reachable only from inside
 * AppContext. Plain lib modules (blobStore, invites) and module-scope
 * helpers (the ICE fetch in app/call.tsx) need them too.
 *
 * Not to be confused with `lib/secureStorage.ts`, which is the
 * encryption-at-rest layer for bulk AsyncStorage blobs. This module is the
 * thin platform wrapper around the keychain itself.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { callWakeLog } from "./callWakeLog";
import { Platform } from "react-native";

/** SecureStore key holding the device token issued at registration. */
export const DEVICE_TOKEN_KEY = "ghostface_device_token";

/** AsyncStorage key holding the registered alias. */
export const ALIAS_KEY = "alias";

// SecureStore is unavailable on web, where Expo falls back to AsyncStorage.
// Kept identical to the implementations these replaced in AppContext.

export async function secureGet(key: string): Promise<string | null> {
  // [CALLWAKE] link 3 of 4 — THE decisive one. Nothing in this codebase passes
  // `keychainAccessible`, so expo-secure-store defaults to WHEN_UNLOCKED. If a
  // PushKit wake on a LOCKED device logs ok:false here for the device token
  // while the same read succeeds unlocked, the locked-ring bug is keychain
  // accessibility and not call logic at all.
  //
  // Logs the KEY NAME and a BOOLEAN only. Never the value — this function
  // returns device tokens and wallet keys.
  // Web keeps its existing AsyncStorage path — the diagnostic must not change
  // WHERE anything is read from, only report on it. (An earlier draft returned
  // early here and would have sent web's token read to SecureStore.)
  if (Platform.OS === "web") return AsyncStorage.getItem(key);
  if (key !== DEVICE_TOKEN_KEY) return SecureStore.getItemAsync(key);
  try {
    const v = await SecureStore.getItemAsync(key);
    callWakeLog("token-read", { key, ok: !!v });
    return v;
  } catch (e) {
    // A throw here is itself the signal: a locked keychain can reject rather
    // than return null, and that distinction changes the fix.
    callWakeLog("token-read", { key, ok: false, threw: String(e).slice(0, 120) });
    return null;
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export type DeviceAuth = { token: string; alias: string };

/**
 * Read the device token and alias. Returns null if either is missing —
 * which is the normal state before onboarding completes, not an error.
 */
export async function getDeviceAuth(): Promise<DeviceAuth | null> {
  const [token, alias] = await Promise.all([
    secureGet(DEVICE_TOKEN_KEY),
    AsyncStorage.getItem(ALIAS_KEY),
  ]);
  if (!token || !alias) return null;
  return { token, alias };
}
