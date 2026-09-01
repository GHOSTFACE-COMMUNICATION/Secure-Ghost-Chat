import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decryptMessage,
  encodeMessageAD,
  encryptMessage,
  generateConversationKey,
  generateSafetyNumberFromKeys,
  sealedDecryptMessage,
  sealedEncryptMessage,
  type EncryptedMessage,
  type SealedMessage,
} from "./crypto.ts";

test("encodeMessageAD: known-answer", () => {
  const ad = encodeMessageAD(0x01);
  assert.equal(
    Buffer.from(ad).toString("hex"),
    "4746434d0101", // "GFCM" || 0x01 (version) || 0x01 (msg_type)
  );
});

test("encodeMessageAD: plain and sealed types produce different AD", () => {
  const plain = encodeMessageAD(0x01);
  const sealed = encodeMessageAD(0x02);
  assert.notEqual(Buffer.from(plain).toString("hex"), Buffer.from(sealed).toString("hex"));
});

test("encryptMessage/decryptMessage: round trip", () => {
  const key = generateConversationKey();
  const msg = encryptMessage("hello ghostface", key);
  assert.equal(decryptMessage(msg, key), "hello ghostface");
});

test("sealedEncryptMessage/sealedDecryptMessage: round trip", () => {
  const key = generateConversationKey();
  const msg = sealedEncryptMessage("hi", "ALICE", key);
  const envelope = sealedDecryptMessage(msg, key);
  assert.equal(envelope.from, "ALICE");
  assert.equal(envelope.content, "hi");
});

test("decryptMessage rejects a ciphertext produced by sealedEncryptMessage under the same key", () => {
  const key = generateConversationKey();
  const sealed = sealedEncryptMessage("hi", "ALICE", key);
  const asPlain: EncryptedMessage = {
    ciphertext: sealed.ciphertext,
    algorithm: "ChaCha20-Poly1305",
    sealed: false,
    version: 1,
  };
  assert.throws(() => decryptMessage(asPlain, key));
});

test("sealedDecryptMessage rejects a ciphertext produced by encryptMessage under the same key", () => {
  const key = generateConversationKey();
  const plain = encryptMessage("hello", key);
  const asSealed: SealedMessage = {
    ciphertext: plain.ciphertext,
    algorithm: "ChaCha20-Poly1305",
    sealed: true,
    version: 1,
  };
  assert.throws(() => sealedDecryptMessage(asSealed, key));
});

test("decryptMessage fails when ciphertext is tampered", () => {
  const key = generateConversationKey();
  const msg = encryptMessage("hello", key);
  const bytes = Buffer.from(msg.ciphertext, "hex");
  bytes[bytes.length - 1] ^= 0xff; // flip a byte inside the auth tag
  const tampered: EncryptedMessage = { ...msg, ciphertext: bytes.toString("hex") };
  assert.throws(() => decryptMessage(tampered, key));
});

// ── Safety numbers (audit #11) ────────────────────────────────────────────────
//
// The function these replace hashed two ALIAS strings and no key material, so
// its output matched whenever two usernames matched — including when identity
// keys had been substituted, which is the only thing a safety number exists to
// detect. These tests pin the properties that failure lacked.

const IK_ALICE = "a1".repeat(32);
const IK_BOB   = "b2".repeat(32);
const IK_MITM  = "cc".repeat(32);

test("safety number: both parties derive the same value from the same key pair", () => {
  // Alice computes (mine, theirs); Bob computes (mine, theirs) with the operands
  // reversed. Canonical sorting must make these agree, or verification fails for
  // every legitimate pair.
  assert.equal(
    generateSafetyNumberFromKeys(IK_ALICE, IK_BOB),
    generateSafetyNumberFromKeys(IK_BOB, IK_ALICE),
  );
});

test("safety number: a substituted peer key changes the number", () => {
  // The MITM detection property. Without this the control is decorative.
  assert.notEqual(
    generateSafetyNumberFromKeys(IK_ALICE, IK_BOB),
    generateSafetyNumberFromKeys(IK_ALICE, IK_MITM),
  );
});

test("safety number: hex case does not change the value", () => {
  // The two ends receive this key from different sources (fetched bundle vs
  // wire header) and the codebase compares such keys case-insensitively
  // elsewhere. Without normalisation the devices would disagree.
  assert.equal(
    generateSafetyNumberFromKeys(IK_ALICE, IK_BOB),
    generateSafetyNumberFromKeys(IK_ALICE.toUpperCase(), IK_BOB.toUpperCase()),
  );
});

test("safety number: format is 6 groups of 5 digits", () => {
  const sn = generateSafetyNumberFromKeys(IK_ALICE, IK_BOB);
  assert.match(sn, /^\d{5}( \d{5}){5}$/);
});

test("safety number: refuses to derive from absent or malformed key material", () => {
  // Must never produce a displayable number without real keys — that is exactly
  // how the alias version manufactured false confidence.
  assert.throws(() => generateSafetyNumberFromKeys("", IK_BOB));
  assert.throws(() => generateSafetyNumberFromKeys(IK_ALICE, ""));
  assert.throws(() => generateSafetyNumberFromKeys("ALICE", "BOB"));
  assert.throws(() => generateSafetyNumberFromKeys(IK_ALICE, "zz".repeat(32)));
  assert.throws(() => generateSafetyNumberFromKeys(IK_ALICE, "a1".repeat(16)));
});

console.log("All crypto tests passed.");
