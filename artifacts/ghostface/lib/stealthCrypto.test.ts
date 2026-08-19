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

function legacyGhx2Payload(plaintext: string, passphrase: string, salt: Uint8Array): string {
  const key = deriveKeyFromPin(passphrase || "GHOSTFACE", salt);
  const chacha = managedNonce(chacha20poly1305);
  const ct = chacha(key).encrypt(new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(salt.length + ct.length);
  combined.set(salt, 0);
  combined.set(ct, salt.length);
  return "GHX2::" + Buffer.from(combined).toString("base64");
}

test("encodeStealthAD: known-answer", () => {
  assert.equal(Buffer.from(encodeStealthAD()).toString("hex"), "4746535401"); // "GFST" || 0x01
});

test("ghostEncrypt output uses the GHX3 prefix", () => {
  const out = ghostEncrypt("hello", "key");
  assert.ok(out.startsWith("GHX3::"));
});

test("ghostEncrypt/ghostDecrypt: round trip", () => {
  const out = ghostEncrypt("hello ghostface", "my-passphrase");
  assert.equal(ghostDecrypt(out, "my-passphrase"), "hello ghostface");
});

test("ghostEncrypt/ghostDecrypt: round trip with blank passphrase (default key)", () => {
  const out = ghostEncrypt("hello", "");
  assert.equal(ghostDecrypt(out, ""), "hello");
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

test("ghostDecrypt still decrypts a legacy GHX2 (pre-AD) payload", () => {
  const salt = new Uint8Array(32).fill(7);
  const legacy = legacyGhx2Payload("old message", "shared-key", salt);
  assert.equal(ghostDecrypt(legacy, "shared-key"), "old message");
});

test("a GHX2 payload does not decrypt via the GHX3 (AD-bound) path and vice versa", () => {
  // Same plaintext/passphrase/salt, encoded once each way — the two
  // ciphertexts must differ (different AD) and each must only decode
  // through ghostDecrypt's matching branch, not by accident cross-decoding.
  const salt = new Uint8Array(32).fill(3);
  const legacy = legacyGhx2Payload("shared", "pw", salt);
  const current = ghostEncrypt("shared", "pw");
  assert.notEqual(legacy.slice(6), current.slice(6));
  assert.equal(ghostDecrypt(legacy, "pw"), "shared");
  assert.equal(ghostDecrypt(current, "pw"), "shared");
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
  assert.equal(ghostDecrypt(extracted!, "pw"), "secret");
});

console.log("All stealthCrypto tests passed.");
