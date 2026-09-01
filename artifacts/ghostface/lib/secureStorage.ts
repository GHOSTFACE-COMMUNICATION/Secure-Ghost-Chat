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
import { randomBytes } from "@/lib/csprng";

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

// ── Canonical AEAD associated data ─────────────────────────────────────────────
//
// Every blob is encrypted under the same master key regardless of which
// AsyncStorage slot it's stored under (conversations vs. call history today,
// more slots possibly later). Without AD, a ciphertext that decrypts validly
// under one slot also decrypts validly if substituted into another slot —
// same key, same cipher, nothing to tell them apart. That's a real risk on a
// jailbroken/rooted device, from a corrupted/malicious backup restore, or
// from an app bug that writes to the wrong key: the swap succeeds silently
// (valid tag) instead of failing loudly.
//
// AD here binds the AsyncStorage key name itself into the tag, so a blob
// only decrypts under the slot it was actually encrypted for:
//
//   offset  size  content
//   0       4     magic = "GFSS"
//   4       1     protocol_version = 0x01
//   5       1     key_id_len (bytes)
//   6       len   key_id — UTF-8 bytes of the AsyncStorage key string
//
// This does NOT stop replay (an old valid ciphertext for the *same* slot
// can still be written back by anyone with raw storage write access) or
// protect against the master key itself being exfiltrated — see
// docs/PROTOCOL.md for the full writeup.

const AD_MAGIC = new Uint8Array([0x47, 0x46, 0x53, 0x53]); // "GFSS"
const AD_PROTOCOL_VERSION = 0x01;

export function encodeStorageAD(keyId: string): Uint8Array {
  const keyIdBytes = new TextEncoder().encode(keyId);
  if (keyIdBytes.length > 0xff) {
    throw new Error(`[secureStorage] AD: keyId too long (${keyIdBytes.length} bytes, max 255)`);
  }
  const out = new Uint8Array(4 + 1 + 1 + keyIdBytes.length);
  out.set(AD_MAGIC, 0);
  out[4] = AD_PROTOCOL_VERSION;
  out[5] = keyIdBytes.length;
  out.set(keyIdBytes, 6);
  return out;
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

/** Encrypt a plaintext string for storage in AsyncStorage under `keyId`. */
export async function encryptForStorage(plaintext: string, keyId: string): Promise<string> {
  const key = await getOrCreateStorageKey();
  const chacha = managedNonce(chacha20poly1305);
  const ad = encodeStorageAD(keyId);
  const ct = chacha(key, ad).encrypt(new TextEncoder().encode(plaintext));
  return toHex(ct);
}

/**
 * Decrypt a string previously produced by encryptForStorage() under the
 * same `keyId`. Throws if the ciphertext was produced under a different
 * keyId, is legacy (pre-AD) format, or is tampered.
 */
export async function decryptFromStorage(ciphertextHex: string, keyId: string): Promise<string> {
  const key = await getOrCreateStorageKey();
  const chacha = managedNonce(chacha20poly1305);
  const ad = encodeStorageAD(keyId);
  const pt = chacha(key, ad).decrypt(fromHex(ciphertextHex));
  return new TextDecoder().decode(pt);
}

/**
 * Legacy (pre-audit-#6) decrypt: same cipher and key, no AD. Only used as a
 * migration fallback inside readEncryptedString() for data written by an
 * already-installed build before AD binding existed — never called on new
 * writes. Remove once migration telemetry (the console.warn below) shows
 * this tier is no longer being hit by real installs.
 */
async function decryptFromStorageLegacyNoAD(ciphertextHex: string): Promise<string> {
  const key = await getOrCreateStorageKey();
  const chacha = managedNonce(chacha20poly1305);
  const pt = chacha(key).decrypt(fromHex(ciphertextHex));
  return new TextDecoder().decode(pt);
}

/**
 * Read a string previously written with writeEncryptedString(), decrypting
 * it transparently. Two tiers, oldest data first:
 *   1. Current AD-bound format.
 *   2. Legacy no-AD format (data from a build that predates audit #6) —
 *      decrypts under the same master key, just without AD. On success,
 *      immediately re-encrypts in the current format so this tier isn't
 *      hit again for this key.
 * Both tiers are authenticated by the master key: tier 2 drops the AD
 * binding, not the AEAD tag, so it still proves the bytes were written by
 * something holding the Keychain key. Tier 2 is temporary; once real-world
 * migration telemetry shows it's no longer hit, it should be deleted
 * (tracked as a follow-up in docs/AUDIT_FINDINGS.md).
 *
 * Audit finding #7. There used to be a third tier: if both decrypts failed,
 * the raw stored bytes were RETURNED AS PLAINTEXT and re-encrypted under the
 * master key. That turned an AEAD tag failure — the one signal that says
 * "these bytes are not ours" — into "assume they're pre-encryption legacy
 * data and adopt them". Anything that could write the AsyncStorage slot
 * could therefore choose the value this function returns, and have it
 * durably re-encrypted so it looked authentic ever after. The blast radius
 * was not limited to conversation history: LOCAL_WALLET_PRIV_KEY is read
 * through here too, so the same path could substitute the user's wallet key.
 *
 * A failed read now returns null. Callers treat that as "no stored data" and
 * start clean, which is the correct failure mode: losing local history is
 * recoverable, silently adopting an attacker's bytes is not. The stored value
 * is deliberately left untouched rather than cleared, so a genuinely corrupted
 * blob can still be recovered off-device for diagnosis.
 */
export async function readEncryptedString(key: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;

  try {
    return await decryptFromStorage(raw, key);
  } catch {
    // fall through to the legacy tier
  }

  try {
    const plaintext = await decryptFromStorageLegacyNoAD(raw);
    console.warn(`[secureStorage] migrated "${key}" from legacy no-AD format`);
    await writeEncryptedString(key, plaintext).catch(() => {});
    return plaintext;
  } catch {
    // Not ours. Do NOT adopt it — see the note above.
  }

  console.error(
    `[secureStorage] "${key}" failed authenticated decryption under every ` +
      `supported format — refusing to adopt it. Treating as absent. The stored ` +
      `value has been left in place for diagnosis.`,
  );
  return null;
}

/** Encrypt and write a string to AsyncStorage under `key`. */
export async function writeEncryptedString(key: string, plaintext: string): Promise<void> {
  const ciphertext = await encryptForStorage(plaintext, key);
  await AsyncStorage.setItem(key, ciphertext);
}
