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
import { Platform } from "react-native";

/** SecureStore key holding the device token issued at registration. */
export const DEVICE_TOKEN_KEY = "ghostface_device_token";

/** AsyncStorage key holding the registered alias. */
export const ALIAS_KEY = "alias";

// SecureStore is unavailable on web, where Expo falls back to AsyncStorage.
// Kept identical to the implementations these replaced in AppContext.

export async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
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

/**
 * Authorization header for an authenticated request, or an empty object
 * when unregistered.
 *
 * Empty rather than throwing: these endpoints do not enforce auth yet, so
 * an unregistered caller must keep working exactly as it does today. Once
 * enforcement lands server-side the same call returns 401, which is the
 * correct outcome for a caller with no identity.
 */
export async function authHeader(): Promise<Record<string, string>> {
  const auth = await getDeviceAuth();
  return auth ? { Authorization: `Bearer ${auth.token}` } : {};
}
