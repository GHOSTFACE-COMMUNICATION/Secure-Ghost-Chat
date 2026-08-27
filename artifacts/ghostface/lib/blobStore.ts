/**
 * Encrypted attachment blob storage.
 *
 * The wire-side encrypted message carries only a small reference — the blob
 * id (server file id) and a fresh per-blob symmetric key — instead of the
 * full base64-encoded attachment. This keeps the Double Ratchet ciphertext
 * tiny no matter how large the photo is.
 *
 * Encryption: chacha20poly1305 with a 24-byte random nonce, exactly the
 * same AEAD the rest of the app uses for sealed/DR payloads. The nonce is
 * prepended to the ciphertext by `managedNonce`.
 *
 * The server stores opaque bytes and never sees the symmetric key.
 */

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { managedNonce } from "@noble/ciphers/utils.js";
import { randomBytes } from "@/lib/csprng";
import { getDeviceAuth } from "@/lib/deviceAuth";

// btoa/atob are provided by Hermes (React Native) and the browser, but
// aren't declared in the Expo TS lib set. Declare them locally so we get
// real types instead of `any` casts.
declare function btoa(input: string): string;
declare function atob(input: string): string;

export const BLOB_KEY_LEN = 32;
export const BLOB_KEY_HEX_LEN = BLOB_KEY_LEN * 2;
const BLOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function isValidBlobId(id: string): boolean {
  return typeof id === "string" && BLOB_ID_RE.test(id);
}

export function isValidBlobKey(hex: string): boolean {
  return typeof hex === "string" && hex.length === BLOB_KEY_HEX_LEN && /^[0-9a-f]+$/i.test(hex);
}

function apiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  return `https://${domain}/api`;
}

/**
 * Encrypt the given plaintext bytes with a fresh symmetric key, upload the
 * ciphertext to the server, and return the blob reference the sender should
 * embed in their message.
 */
export async function uploadEncryptedBlob(
  plain: Uint8Array,
): Promise<{ blobId: string; key: string }> {
  const keyBytes = randomBytes(BLOB_KEY_LEN);
  const cipher = managedNonce(chacha20poly1305)(keyBytes);
  const ciphertext = cipher.encrypt(plain);

  // Upload is an authenticated write: it costs server disk. The alias rides
  // along in the query string because the server matches the Bearer token
  // against the device_tokens row for that alias (token_hash alone is not
  // unique — only user_id is). Sent unconditionally; the server does not
  // enforce this yet, so an unregistered caller behaves exactly as before.
  const auth = await getDeviceAuth();
  const url = auth
    ? `${apiBase()}/blobs?alias=${encodeURIComponent(auth.alias)}`
    : `${apiBase()}/blobs`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    // RN/Hermes fetch accepts an ArrayBuffer body for binary uploads.
    body: ciphertext.buffer.slice(
      ciphertext.byteOffset,
      ciphertext.byteOffset + ciphertext.byteLength,
    ) as ArrayBuffer,
  });
  if (!res.ok) {
    throw new Error(`blob upload failed: ${res.status}`);
  }
  const data = (await res.json()) as { blobId?: string };
  if (!data.blobId || !isValidBlobId(data.blobId)) {
    throw new Error("blob upload returned invalid id");
  }
  return { blobId: data.blobId, key: toHex(keyBytes) };
}

/**
 * Fetch and decrypt a previously uploaded blob. Returns the plaintext bytes.
 *
 * Throws on any network/decrypt failure — the caller is responsible for
 * surfacing a placeholder ("attachment unavailable").
 */
export async function downloadAndDecryptBlob(
  blobId: string,
  keyHex: string,
): Promise<Uint8Array> {
  if (!isValidBlobId(blobId)) throw new Error("invalid blob id");
  if (!isValidBlobKey(keyHex)) throw new Error("invalid blob key");

  const res = await fetch(`${apiBase()}/blobs/${blobId}`);
  if (!res.ok) throw new Error(`blob download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const ciphertext = new Uint8Array(buf);

  const keyBytes = fromHex(keyHex);
  const cipher = managedNonce(chacha20poly1305)(keyBytes);
  return cipher.decrypt(ciphertext);
}

/** Convert raw bytes to a data: URI suitable for <Image source>. */
export function bytesToDataUri(bytes: Uint8Array, mimeType: string): string {
  // Chunked base64 encoding — String.fromCharCode(...veryLarge) blows the
  // JS call stack on large photos.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length))),
    );
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Convert a base64 string (no data: prefix) to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
