/**
 * Encryption-at-rest for bulk data persisted via AsyncStorage.
 *
 * AsyncStorage has no platform-level encryption — on a jailbroken/rooted
 * device, or via an unencrypted backup, anything stored there (including
 * Double Ratchet session state: root keys, chain keys, private DH/ML-KEM
 * keys) is readable directly off disk, no cryptanalysis required.
 *
 * SecureStore (Keychain on iOS, Keystore-backed on Android) is the right
 * place for secrets, but it's sized for small values, not a growing
 * conversations blob. So a single random master key lives in SecureStore,
 * and that key encrypts the bulk AsyncStorage blob with ChaCha20-Poly1305.
 * The data on disk in AsyncStorage is now ciphertext; the only thing that
 * decrypts it lives behind the Keychain.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { managedNonce } from "@noble/ciphers/utils.js";
import { randomBytes } from "@noble/hashes/utils.js";

const STORAGE_KEY_NAME = "ghostface_storage_enc_key";

function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

let cachedKey: Uint8Array | null = null;

/**
 * Fetch the master storage-encryption key from SecureStore, generating a
 * fresh random one on first run. Falls back to AsyncStorage only on web,
 * where SecureStore isn't available and there's no OS keychain to protect
 * anyway — web already has no equivalent guarantee.
 */
async function getOrCreateStorageKey(): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;

  const isWeb = Platform.OS === "web";
  const hex = isWeb
    ? await AsyncStorage.getItem(STORAGE_KEY_NAME)
    : await SecureStore.getItemAsync(STORAGE_KEY_NAME);

  if (hex) {
    cachedKey = fromHex(hex);
    return cachedKey;
  }

  const fresh = randomBytes(32);
  const freshHex = toHex(fresh);
  if (isWeb) {
    await AsyncStorage.setItem(STORAGE_KEY_NAME, freshHex);
  } else {
    await SecureStore.setItemAsync(STORAGE_KEY_NAME, freshHex);
  }
  cachedKey = fresh;
  return cachedKey;
}

/** Encrypt a plaintext string for storage in AsyncStorage. */
export async function encryptForStorage(plaintext: string): Promise<string> {
  const key = await getOrCreateStorageKey();
  const chacha = managedNonce(chacha20poly1305);
  const ct = chacha(key).encrypt(new TextEncoder().encode(plaintext));
  return toHex(ct);
}

/** Decrypt a string previously produced by encryptForStorage(). */
export async function decryptFromStorage(ciphertextHex: string): Promise<string> {
  const key = await getOrCreateStorageKey();
  const chacha = managedNonce(chacha20poly1305);
  const pt = chacha(key).decrypt(fromHex(ciphertextHex));
  return new TextDecoder().decode(pt);
}

/**
 * Read a string previously written with writeEncryptedString(), decrypting
 * it transparently. Falls back to treating the raw value as legacy
 * plaintext (pre-encryption-at-rest data) so existing local data isn't
 * silently dropped on upgrade — the next write re-saves it encrypted.
 */
export async function readEncryptedString(key: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return await decryptFromStorage(raw);
  } catch {
    return raw;
  }
}

/** Encrypt and write a string to AsyncStorage under `key`. */
export async function writeEncryptedString(key: string, plaintext: string): Promise<void> {
  const ciphertext = await encryptForStorage(plaintext);
  await AsyncStorage.setItem(key, ciphertext);
}
