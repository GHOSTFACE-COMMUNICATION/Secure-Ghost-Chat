/**
 * Stealth-tool crypto: passphrase-derived ChaCha20-Poly1305 AEAD, then
 * hidden via zero-width character steganography. Used by the Stealth tab in
 * components/EncryptionTools.tsx.
 *
 * Extracted out of that component (a pure-logic move, no behavior change
 * beyond audit finding #7 below) so it can be unit tested under node:test —
 * see lib/stealthCrypto.test.ts. The component file pulls in React
 * Native/Expo UI modules this logic has nothing to do with and can't be
 * imported under the test runner.
 */
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { managedNonce } from "@noble/ciphers/utils.js";
import { deriveKeyFromPin, generateSalt } from "@/lib/crypto";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
  }
  return out;
}

function base64ToBytes(str: string): Uint8Array {
  const s = str.replace(/=+$/, "");
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const a = B64.indexOf(s[i] ?? ""), b = B64.indexOf(s[i + 1] ?? "");
    const c = s[i + 2] ? B64.indexOf(s[i + 2]) : -1;
    const d = s[i + 3] ? B64.indexOf(s[i + 3]) : -1;
    out.push((a << 2) | (b >> 4));
    if (c >= 0) out.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) out.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(out);
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrs) { out.set(a, offset); offset += a.length; }
  return out;
}

// ── Canonical AEAD associated data ─────────────────────────────────────────────
//
// Audit finding #7. This construction (passphrase → PBKDF2 → ChaCha20-
// Poly1305) had no AD at all — same gap as #6 (lib/secureStorage.ts,
// lib/crypto.ts). Fixed the same way: a fixed, self-describing magic +
// version tag. There's no header/context to bind beyond that — this format
// carries no fields analogous to the Double Ratchet's header or
// secureStorage's key id, so the AD's only job is domain-separating this
// construction from any other ChaCha20-Poly1305+PBKDF2 use in the app.
//
//   offset  size  content
//   0       4     magic = "GFST"
//   4       1     protocol_version = 0x01

const AD_MAGIC = new Uint8Array([0x47, 0x46, 0x53, 0x54]); // "GFST"
const AD_PROTOCOL_VERSION = 0x01;

export function encodeStealthAD(): Uint8Array {
  return new Uint8Array([AD_MAGIC[0], AD_MAGIC[1], AD_MAGIC[2], AD_MAGIC[3], AD_PROTOCOL_VERSION]);
}

const GHX_PREFIX_CURRENT = "GHX3::";
const GHX_PREFIX_LEGACY = "GHX2::";

/** ChaCha20-Poly1305 AEAD, key derived via PBKDF2-SHA256 (600k iterations) — same construction the app uses for PIN-derived keys. */
export function ghostEncrypt(plaintext: string, passphrase: string): string {
  const salt = generateSalt();
  const key = deriveKeyFromPin(passphrase || "GHOSTFACE", salt);
  const chacha = managedNonce(chacha20poly1305);
  const ad = encodeStealthAD();
  const ciphertext = chacha(key, ad).encrypt(new TextEncoder().encode(plaintext));
  return GHX_PREFIX_CURRENT + bytesToBase64(concatBytes(salt, ciphertext));
}

function ghostDecryptCurrent(combined: Uint8Array, passphrase: string): string {
  const salt = combined.slice(0, 32);
  const ciphertext = combined.slice(32);
  const key = deriveKeyFromPin(passphrase || "GHOSTFACE", salt);
  const chacha = managedNonce(chacha20poly1305);
  const ad = encodeStealthAD();
  return new TextDecoder().decode(chacha(key, ad).decrypt(ciphertext));
}

/**
 * Legacy (pre-audit-#7) decrypt: same cipher and KDF, no AD. GHX2 payloads
 * were produced by app versions before AD binding existed and may already
 * be sitting in an already-sent message, a screenshot, or a notes app —
 * places this app doesn't control and can't rewrite. Unlike
 * lib/secureStorage.ts's migration tiers (audit #6), this branch is
 * permanent, not a temporary one slated for removal: there's no telemetry
 * signal, device-local or otherwise, that could ever show a GHX2 payload
 * won't be pasted in tomorrow. Dropping support for GHX2 is a deliberate
 * future product decision, not something to infer from usage.
 */
function ghostDecryptLegacyNoAD(combined: Uint8Array, passphrase: string): string {
  const salt = combined.slice(0, 32);
  const ciphertext = combined.slice(32);
  const key = deriveKeyFromPin(passphrase || "GHOSTFACE", salt);
  const chacha = managedNonce(chacha20poly1305);
  return new TextDecoder().decode(chacha(key).decrypt(ciphertext));
}

export function ghostDecrypt(payload: string, passphrase: string): string | null {
  try {
    if (payload.startsWith(GHX_PREFIX_CURRENT)) {
      return ghostDecryptCurrent(base64ToBytes(payload.slice(GHX_PREFIX_CURRENT.length)), passphrase);
    }
    if (payload.startsWith(GHX_PREFIX_LEGACY)) {
      return ghostDecryptLegacyNoAD(base64ToBytes(payload.slice(GHX_PREFIX_LEGACY.length)), passphrase);
    }
    return null;
  } catch {
    return null;
  }
}

/** Zero-width character steganography — hides a string (here, always ciphertext) inside an innocent-looking word. */
export function stealthEncode(payload: string): string {
  const bits = Array.from(payload).map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join("");
  return "GHOSTFACE" + bits.split("").map((b) => (b === "0" ? "​" : "‌")).join("");
}

export function stealthDecode(carrier: string): string | null {
  const bits = Array.from(carrier).filter((c) => c === "​" || c === "‌")
    .map((c) => (c === "​" ? "0" : "1")).join("");
  let out = "";
  for (let i = 0; i < bits.length; i += 8) {
    const byte = bits.slice(i, i + 8);
    if (byte.length === 8) out += String.fromCharCode(parseInt(byte, 2));
  }
  return out || null;
}
