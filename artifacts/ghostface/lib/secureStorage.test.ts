import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { managedNonce } from "@noble/ciphers/utils.js";

// Both of these resolve to in-memory stubs under the test runner — see
// scripts/rn-test-loader.mjs. __getRaw/__setRaw/__reset are test-only
// extras the stub adds beyond the real AsyncStorage API.
import {
  __getRaw as getRawStorage,
  __setRaw as setRawStorage,
  __reset as resetStorage,
} from "@react-native-async-storage/async-storage";
import { __reset as resetSecureStore } from "expo-secure-store";

import {
  decryptFromStorage,
  encodeStorageAD,
  encryptForStorage,
  readEncryptedString,
  writeEncryptedString,
} from "./secureStorage.ts";

// Mirrors the private STORAGE_KEY_NAME constant in secureStorage.ts — the
// SecureStore key the module caches its master key under. Not exported (no
// reason to widen the module's public surface just for tests), so this is
// duplicated here deliberately, same as other test files pin known internal
// constants for known-answer checks.
const MASTER_KEY_SECURE_STORE_NAME = "ghostface_storage_enc_key";

function fromHex(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return arr;
}

function legacyEncryptNoAD(plaintext: string, key: Uint8Array): string {
  const chacha = managedNonce(chacha20poly1305);
  const ct = chacha(key).encrypt(new TextEncoder().encode(plaintext));
  return Buffer.from(ct).toString("hex");
}

// secureStorage.ts caches its master key at module scope for the process
// lifetime (mirrors real app behavior — one key per launch), so it survives
// the per-test resetStorage()/resetSecureStore() below. Capture the key
// bytes exactly once, here, before any reset can wipe the SecureStore
// stub's copy of it.
let masterKeyBytes: Uint8Array;

before(async () => {
  await encryptForStorage("warmup", "warmup-key");
  const { getItemAsync } = await import("expo-secure-store");
  const hex = await getItemAsync(MASTER_KEY_SECURE_STORE_NAME);
  assert.ok(hex, "master key should have been generated into SecureStore stub");
  masterKeyBytes = fromHex(hex);
});

beforeEach(() => {
  resetStorage();
  resetSecureStore();
});

test("encodeStorageAD: known-answer", () => {
  const keyId = "ghostface_conversations";
  const ad = encodeStorageAD(keyId);
  const keyIdHex = Buffer.from(keyId, "utf8").toString("hex");
  const lenHex = keyId.length.toString(16).padStart(2, "0");
  // "GFSS" || version(0x01) || key_id_len || key_id bytes
  assert.equal(Buffer.from(ad).toString("hex"), `4746535301${lenHex}${keyIdHex}`);
});

test("encodeStorageAD: different keyIds produce different AD", () => {
  const a = encodeStorageAD("ghostface_conversations");
  const b = encodeStorageAD("ghostface_call_history");
  assert.notEqual(Buffer.from(a).toString("hex"), Buffer.from(b).toString("hex"));
});

test("encryptForStorage/decryptFromStorage: round trip under the same keyId", async () => {
  const ct = await encryptForStorage("hello ghostface", "ghostface_conversations");
  const pt = await decryptFromStorage(ct, "ghostface_conversations");
  assert.equal(pt, "hello ghostface");
});

test("decryptFromStorage rejects a ciphertext encrypted under a different keyId", async () => {
  const ct = await encryptForStorage("hello ghostface", "ghostface_conversations");
  await assert.rejects(() => decryptFromStorage(ct, "ghostface_call_history"));
});

test("readEncryptedString/writeEncryptedString: round trip through AsyncStorage stub", async () => {
  await writeEncryptedString("ghostface_conversations", "[]");
  const raw = getRawStorage("ghostface_conversations");
  assert.ok(raw, "expected a value to have been written");
  const result = await readEncryptedString("ghostface_conversations");
  assert.equal(result, "[]");
});

test("readEncryptedString migrates legacy no-AD data and rewrites it immediately", async () => {
  const legacyCt = legacyEncryptNoAD('{"legacy":true}', masterKeyBytes);
  setRawStorage("ghostface_conversations", legacyCt);

  const result = await readEncryptedString("ghostface_conversations");
  assert.equal(result, '{"legacy":true}');

  // Storage should now hold the current AD-bound format, not the legacy
  // ciphertext — decrypting it via the new-format path must succeed.
  const rewritten = getRawStorage("ghostface_conversations")!;
  assert.notEqual(rewritten, legacyCt);
  const migrated = await decryptFromStorage(rewritten, "ghostface_conversations");
  assert.equal(migrated, '{"legacy":true}');
});

/**
 * Audit finding #7. These four tests pin the behaviour that replaced the
 * pre-encryption plaintext migration tier. That tier returned any blob which
 * failed both authenticated decrypts as if it were legacy plaintext, and
 * re-encrypted it under the master key — so whoever could write the storage
 * slot chose the value this function returned, permanently. The test that
 * used to live here asserted exactly that behaviour and had to be inverted.
 */
test("readEncryptedString REFUSES unauthenticated bytes instead of adopting them", async () => {
  const attackerBytes = '{"conversations":"attacker-chosen, never encrypted by us"}';
  setRawStorage("ghostface_call_history", attackerBytes);

  const result = await readEncryptedString("ghostface_call_history");
  assert.equal(result, null, "unauthenticated bytes must not be returned to the caller");
});

test("readEncryptedString does not rewrite unauthenticated bytes into the encrypted format", async () => {
  const attackerBytes = "not our ciphertext";
  setRawStorage("ghostface_call_history", attackerBytes);

  await readEncryptedString("ghostface_call_history");

  // Left exactly as found: not adopted, not laundered into the current format,
  // and not destroyed — a genuinely corrupted blob stays recoverable.
  assert.equal(getRawStorage("ghostface_call_history"), attackerBytes);
});

test("readEncryptedString refuses a valid ciphertext moved to a different key", async () => {
  // AD binds the slot name, so a blob lifted from one slot into another fails
  // tier 1. It must not then fall through to being adopted as plaintext.
  await writeEncryptedString("ghostface_conversations", '{"real":"data"}');
  const validButForAnotherSlot = getRawStorage("ghostface_conversations")!;
  setRawStorage("ghostface_call_history", validButForAnotherSlot);

  assert.equal(await readEncryptedString("ghostface_call_history"), null);
});

test("the wallet key path cannot be substituted through a failed read", async () => {
  // LOCAL_WALLET_PRIV_KEY is read through readEncryptedString. Under the old
  // tier 3 this returned the attacker's hex string as the wallet private key.
  const attackerKeyHex = "de".repeat(32);
  setRawStorage("ghostface_local_wallet_priv", attackerKeyHex);

  assert.equal(await readEncryptedString("ghostface_local_wallet_priv"), null);
});

test("readEncryptedString returns null for a missing key", async () => {
  assert.equal(await readEncryptedString("does_not_exist"), null);
});

console.log("All secureStorage tests passed.");
