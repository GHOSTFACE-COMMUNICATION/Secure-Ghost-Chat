/**
 * GHOSTFACE Client-Side Cryptography
 *
 * Algorithms:
 *   - ChaCha20-Poly1305 (256-bit key, 96-bit managed nonce, AEAD)
 *   - PBKDF2-SHA256 (600,000 iterations) for PIN-derived keys — OWASP 2023 recommendation
 *   - SHA-256 for fingerprints
 *
 * Sealed Sender (Signal-compatible concept)
 * ─────────────────────────────────────────
 *   Without sealed sender:
 *     stored/transmitted:  { from: "ALICE", to: "BOB", ciphertext: "..." }
 *     → server/storage sees sender in plaintext
 *
 *   With sealed sender:
 *     stored/transmitted:  { to: "BOB", ciphertext: "..." }
 *     → sender identity ("ALICE") is hidden inside the encrypted payload
 *     → only BOB can decrypt and discover the true sender
 *     → server/storage is completely blind to who sent the message
 *
 * Safety Numbers
 * ──────────────
 *   generateSafetyNumber()         — legacy alias-based (kept for compatibility)
 *   generateSafetyNumberFromKeys() — cryptographically correct: derived from
 *                                    both parties' Ed25519 identity signing public keys,
 *                                    matching Signal's safety number design.
 *
 * All operations run 100% on-device. Nothing leaves the device unencrypted.
 */

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { managedNonce } from "@noble/ciphers/utils.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@/lib/csprng";

// ── Helpers ──────────────────────────────────────────────────────────────────

function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToStr(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Derive a 256-bit session key from a PIN + salt using PBKDF2-SHA256.
 * 600,000 iterations — OWASP 2023 recommendation for PBKDF2-HMAC-SHA256.
 * Exceeds NIST SP 800-132 minimum and matches modern password hashing guidance.
 */
export function deriveKeyFromPin(pin: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, strToBytes(pin), salt, { c: 600_000, dkLen: 32 });
}

export function generateSalt(): Uint8Array {
  return randomBytes(32);
}

export function generateConversationKey(): Uint8Array {
  return randomBytes(32);
}

export function keyToHex(key: Uint8Array): string {
  return bytesToHex(key);
}

export function hexToKey(hex: string): Uint8Array {
  return hexToBytes(hex);
}

// ── Canonical AEAD associated data ─────────────────────────────────────────────
//
// encryptMessage/decryptMessage and sealedEncryptMessage/sealedDecryptMessage
// share a ciphertext shape (EncryptedMessage | SealedMessage differ only by
// the `sealed` flag) and could be encrypted under the same key. Without AD,
// a plain ciphertext handed to sealedDecryptMessage() (or vice versa) either
// decrypts into garbage that JSON.parse chokes on, or — worse — parses into
// something plausible-looking. Binding msg_type into the AD makes a
// type-mismatch fail cleanly at the AEAD tag check instead.
//
//   offset  size  content
//   0       4     magic = "GFCM"
//   4       1     protocol_version = 0x01
//   5       1     msg_type (0x01 = plain, 0x02 = sealed)

const AD_MAGIC = new Uint8Array([0x47, 0x46, 0x43, 0x4d]); // "GFCM"
const AD_PROTOCOL_VERSION = 0x01;
const AD_MSGTYPE_PLAIN = 0x01;
const AD_MSGTYPE_SEALED = 0x02;

export function encodeMessageAD(msgType: number): Uint8Array {
  return new Uint8Array([AD_MAGIC[0], AD_MAGIC[1], AD_MAGIC[2], AD_MAGIC[3], AD_PROTOCOL_VERSION, msgType]);
}

// ── Standard encrypted message ────────────────────────────────────────────────

export interface EncryptedMessage {
  ciphertext: string;
  algorithm: "ChaCha20-Poly1305";
  sealed: false;
  version: 1;
}

export function encryptMessage(plaintext: string, key: Uint8Array): EncryptedMessage {
  const chacha = managedNonce(chacha20poly1305, randomBytes);
  const ad = encodeMessageAD(AD_MSGTYPE_PLAIN);
  const encrypted = chacha(key, ad).encrypt(strToBytes(plaintext));
  return { ciphertext: bytesToHex(encrypted), algorithm: "ChaCha20-Poly1305", sealed: false, version: 1 };
}

export function decryptMessage(msg: EncryptedMessage, key: Uint8Array): string {
  const chacha = managedNonce(chacha20poly1305, randomBytes);
  const ad = encodeMessageAD(AD_MSGTYPE_PLAIN);
  const decrypted = chacha(key, ad).decrypt(hexToBytes(msg.ciphertext));
  return bytesToStr(decrypted);
}

// ── Sealed Sender ─────────────────────────────────────────────────────────────
//
// The sealed envelope format embeds the sender's identity inside the
// encrypted payload — identical in principle to Signal's sealed sender.
//
// Plaintext envelope (before encryption):
//   { from: "ALICE", content: "hello", ts: 1714000000000 }
//
// After sealedEncryptMessage():
//   { ciphertext: "<hex>", sealed: true, algorithm: "ChaCha20-Poly1305" }
//
// What the server/storage sees:
//   { to: "BOB", ciphertext: "<hex>" }    ← no sender field whatsoever
//
// Only BOB, who holds the shared key, can run sealedDecryptMessage()
// and recover { from: "ALICE", content: "hello" }.

export interface SealedEnvelope {
  from: string;
  content: string;
  ts: number;
}

export interface SealedMessage {
  ciphertext: string;
  algorithm: "ChaCha20-Poly1305";
  sealed: true;
  version: 1;
}

/**
 * Encrypt a message with the sender's identity sealed inside.
 * The returned object contains NO plaintext sender field.
 */
export function sealedEncryptMessage(
  content: string,
  senderAlias: string,
  key: Uint8Array
): SealedMessage {
  const envelope: SealedEnvelope = { from: senderAlias, content, ts: Date.now() };
  const payload = JSON.stringify(envelope);
  const chacha = managedNonce(chacha20poly1305, randomBytes);
  const ad = encodeMessageAD(AD_MSGTYPE_SEALED);
  const encrypted = chacha(key, ad).encrypt(strToBytes(payload));
  return {
    ciphertext: bytesToHex(encrypted),
    algorithm: "ChaCha20-Poly1305",
    sealed: true,
    version: 1,
  };
}

/**
 * Decrypt a sealed message, recovering both the sender and content.
 * Throws if the MAC tag is invalid (tampered ciphertext or wrong key).
 */
export function sealedDecryptMessage(
  msg: SealedMessage,
  key: Uint8Array
): SealedEnvelope {
  const chacha = managedNonce(chacha20poly1305, randomBytes);
  const ad = encodeMessageAD(AD_MSGTYPE_SEALED);
  const decrypted = chacha(key, ad).decrypt(hexToBytes(msg.ciphertext));
  return JSON.parse(bytesToStr(decrypted)) as SealedEnvelope;
}

// ── Union type ────────────────────────────────────────────────────────────────

export type AnyEncryptedMessage = EncryptedMessage | SealedMessage;

// ── Fingerprints ──────────────────────────────────────────────────────────────

/** 8-char SHA-256 fingerprint of ciphertext — shown below each message bubble */
export function messageFingerprint(msg: AnyEncryptedMessage): string {
  const hash = sha256(hexToBytes(msg.ciphertext));
  return bytesToHex(hash).substring(0, 8).toUpperCase();
}

// ── Safety numbers ────────────────────────────────────────────────────────────

/**
 * Derive a human-readable safety number from two Ed25519 identity signing public keys.
 *
 * Cryptographically correct approach — matches Signal's safety number design:
 *   - Uses the actual cryptographic identity material (IK signing public keys)
 *   - Keys are sorted canonically so A↔B and B↔A produce the same number
 *   - Displayed as 6 groups of 5 digits for out-of-band verification
 *
 * Preferred over generateSafetyNumber() when IK public keys are available.
 */
export function generateSafetyNumberFromKeys(
  myIKSignPub: string,
  theirIKSignPub: string,
): string {
  const [keyA, keyB] = [myIKSignPub, theirIKSignPub].sort();
  const combined = strToBytes(`GHOSTFACE_SAFETY_NUMBER_v2:${keyA}:${keyB}`);
  const hash = sha256(combined);
  return Array.from({ length: 6 }, (_, i) => {
    const slice = hash.slice(i * 5, i * 5 + 5);
    const num = Array.from<number>(slice).reduce((acc, b) => acc * 256 + b, 0);
    return (num % 100000).toString().padStart(5, "0");
  }).join(" ");
}

/**
 * Derive a human-readable safety number from two aliases (legacy).
 * Kept for backward compatibility — prefer generateSafetyNumberFromKeys()
 * when Ed25519 identity keys are available, as aliases are not cryptographic
 * identity material and can be impersonated.
 */
export function generateSafetyNumber(myAlias: string, theirAlias: string): string {
  const combined = strToBytes(`${myAlias}:${theirAlias}`);
  const hash = sha256(combined);
  return Array.from({ length: 6 }, (_, i) => {
    const slice = hash.slice(i * 5, i * 5 + 5);
    const num = Array.from<number>(slice).reduce((acc, b) => acc * 256 + b, 0);
    return (num % 100000).toString().padStart(5, "0");
  }).join(" ");
}

