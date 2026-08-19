import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decryptMessage,
  encodeMessageAD,
  encryptMessage,
  generateConversationKey,
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

console.log("All crypto tests passed.");
