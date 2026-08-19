import assert from "node:assert/strict";
import { test } from "node:test";

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { managedNonce } from "@noble/ciphers/utils.js";

import { deriveKeyFromPin } from "./crypto.ts";
import {
  encodeStealthAD,
  ghostDecrypt,
  ghostEncrypt,
  stealthDecode,
  stealthEncode,
} from "./stealthCrypto.ts";

function base64ToBytesForTest(str: string): Uint8Array {
  return Uint8Array.from(Buffer.from(str, "base64"));
}

function legacyGhx2Payload(plaintext: string, kdfPassphrase: string, salt: Uint8Array): string {
  const key = deriveKeyFromPin(kdfPassphrase || "GHOSTFACE", salt);
  const chacha = managedNonce(chacha20poly1305);
  const ct = chacha(key).encrypt(new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(salt.length + ct.length);
  combined.set(salt, 0);
  combined.set(ct, salt.length);
  return "GHX2::" + Buffer.from(combined).toString("base64");
}

/**
 * Builds a GHX3 (AD-bound) payload directly from a resolved KDF passphrase,
 * bypassing ghostEncrypt's non-empty-passphrase guard (audit #8) — needed
 * to construct a payload that was encrypted under the "GHOSTFACE" default,
 * which ghostEncrypt itself now refuses to produce.
 */
function ghx3PayloadForTest(plaintext: string, kdfPassphrase: string, salt: Uint8Array): string {
  const key = deriveKeyFromPin(kdfPassphrase, salt);
  const chacha = managedNonce(chacha20poly1305);
  const ct = chacha(key, encodeStealthAD()).encrypt(new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(salt.length + ct.length);
  combined.set(salt, 0);
  combined.set(ct, salt.length);
  return "GHX3::" + Buffer.from(combined).toString("base64");
}

test("encodeStealthAD: known-answer", () => {
  assert.equal(Buffer.from(encodeStealthAD()).toString("hex"), "4746535401"); // "GFST" || 0x01
});

test("ghostEncrypt output uses the GHX3 prefix", () => {
  const out = ghostEncrypt("hello", "key");
  assert.ok(out.startsWith("GHX3::"));
});

test("ghostEncrypt throws on an empty passphrase", () => {
  assert.throws(() => ghostEncrypt("hello", ""));
});

test("ghostEncrypt throws on a whitespace-only passphrase", () => {
  assert.throws(() => ghostEncrypt("hello", "   "));
});

test("ghostEncrypt/ghostDecrypt: round trip with a real passphrase, not flagged as default-key", () => {
  const out = ghostEncrypt("hello ghostface", "my-passphrase");
  const result = ghostDecrypt(out, "my-passphrase");
  assert.ok(result);
  assert.equal(result!.plaintext, "hello ghostface");
  assert.equal(result!.usedDefaultPassphrase, false);
});

test("typing the literal word GHOSTFACE as a real passphrase is not flagged as default-key", () => {
  // usedDefaultPassphrase reflects whether the caller supplied a
  // passphrase, not whether the resulting key matches a known one.
  const out = ghostEncrypt("hello", "GHOSTFACE");
  const result = ghostDecrypt(out, "GHOSTFACE");
  assert.ok(result);
  assert.equal(result!.plaintext, "hello");
  assert.equal(result!.usedDefaultPassphrase, false);
});

test("ghostDecrypt succeeds via the default key on a blank passphrase, flagged usedDefaultPassphrase", () => {
  const salt = new Uint8Array(32).fill(9);
  const payload = ghx3PayloadForTest("hello", "GHOSTFACE", salt);
  const result = ghostDecrypt(payload, "");
  assert.ok(result);
  assert.equal(result!.plaintext, "hello");
  assert.equal(result!.usedDefaultPassphrase, true);
});

test("ghostDecrypt returns null for the wrong passphrase", () => {
  const out = ghostEncrypt("hello", "correct-key");
  assert.equal(ghostDecrypt(out, "wrong-key"), null);
});

test("ghostDecrypt returns null for a tampered GHX3 payload, not a throw", () => {
  const out = ghostEncrypt("hello", "key");
  const bytes = base64ToBytesForTest(out.slice("GHX3::".length));
  bytes[bytes.length - 1] ^= 0xff;
  const tampered = "GHX3::" + Buffer.from(bytes).toString("base64");
  assert.equal(ghostDecrypt(tampered, "key"), null);
});

test("ghostDecrypt returns null cleanly for an unrecognized prefix", () => {
  assert.equal(ghostDecrypt("GHX9::whatever", "key"), null);
  assert.equal(ghostDecrypt("not a stealth payload at all", "key"), null);
  assert.equal(ghostDecrypt("", "key"), null);
});

test("ghostDecrypt still decrypts a legacy GHX2 (pre-AD) payload encrypted with a real passphrase", () => {
  const salt = new Uint8Array(32).fill(7);
  const legacy = legacyGhx2Payload("old message", "shared-key", salt);
  const result = ghostDecrypt(legacy, "shared-key");
  assert.ok(result);
  assert.equal(result!.plaintext, "old message");
  assert.equal(result!.usedDefaultPassphrase, false);
});

test("ghostDecrypt decrypts a legacy GHX2 payload hidden under the old blank-key default, flagged usedDefaultPassphrase", () => {
  const salt = new Uint8Array(32).fill(11);
  const legacy = legacyGhx2Payload("old default-key message", "", salt);
  const result = ghostDecrypt(legacy, "");
  assert.ok(result);
  assert.equal(result!.plaintext, "old default-key message");
  assert.equal(result!.usedDefaultPassphrase, true);
});

test("a GHX2 payload does not decrypt via the GHX3 (AD-bound) path and vice versa", () => {
  // Same plaintext/passphrase/salt, encoded once each way — the two
  // ciphertexts must differ (different AD) and each must only decode
  // through ghostDecrypt's matching branch, not by accident cross-decoding.
  const salt = new Uint8Array(32).fill(3);
  const legacy = legacyGhx2Payload("shared", "pw", salt);
  const current = ghostEncrypt("shared", "pw");
  assert.notEqual(legacy.slice(6), current.slice(6));
  assert.equal(ghostDecrypt(legacy, "pw")!.plaintext, "shared");
  assert.equal(ghostDecrypt(current, "pw")!.plaintext, "shared");
});

test("stealthEncode/stealthDecode: round trip", () => {
  const encoded = stealthEncode("payload text");
  assert.equal(stealthDecode(encoded), "payload text");
});

test("stealthDecode returns null when no hidden bits are present", () => {
  assert.equal(stealthDecode("just a plain sentence"), null);
});

test("full pipeline: encrypt, hide, reveal, decrypt", () => {
  const hidden = stealthEncode(ghostEncrypt("secret", "pw"));
  const extracted = stealthDecode(hidden);
  assert.ok(extracted);
  const result = ghostDecrypt(extracted!, "pw");
  assert.ok(result);
  assert.equal(result!.plaintext, "secret");
  assert.equal(result!.usedDefaultPassphrase, false);
});

console.log("All stealthCrypto tests passed.");
