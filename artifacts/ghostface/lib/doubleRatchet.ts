/**
 * GHOSTFACE Double Ratchet Protocol
 *
 * Implements the Signal Protocol Double Ratchet Algorithm with X3DH initialization.
 *
 * Cryptographic primitives:
 *   - X25519 (Curve25519 ECDH) for DH ratchet key exchange
 *   - HKDF-SHA256 for root key derivation (KDF_RK)
 *   - HMAC-SHA256 for chain key / message key derivation (KDF_CK)
 *   - ChaCha20-Poly1305 for AEAD message encryption
 *   - 96-bit random nonce per message (prepended to ciphertext)
 *
 * Protocol guarantees:
 *   - Forward secrecy: every message uses a unique per-message key that is
 *     immediately discarded after use
 *   - Break-in recovery: after each round-trip, a new DH ratchet step rotates
 *     the root key, making past message keys unrecoverable even if the current
 *     state is compromised
 *   - Out-of-order delivery: skipped message keys are cached (up to MAX_SKIP)
 *
 * References:
 *   https://signal.org/docs/specifications/doubleratchet/
 *   https://signal.org/docs/specifications/x3dh/
 */

import { x25519, ed25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";

const MAX_SKIP = 1000;
const PQ_CT_RESEND_WINDOW = 4;

// ── Byte helpers ──────────────────────────────────────────────────────────────

function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToStr(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

export function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

// ── DH keypair ────────────────────────────────────────────────────────────────

interface DHKeyPair {
  priv: Uint8Array;
  pub: Uint8Array;
}

function generateDH(): DHKeyPair {
  const priv = randomBytes(32);
  const pub = x25519.getPublicKey(priv);
  return { priv, pub };
}

function dhCompute(kp: DHKeyPair, theirPub: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(kp.priv, theirPub);
}

// ── KDF functions ─────────────────────────────────────────────────────────────

const ROOT_INFO = strToBytes("GHOSTFACE_RATCHET_ROOT_v1");
const CHAIN_KEY_CONSTANT = new Uint8Array([0x02]);
const MSG_KEY_CONSTANT   = new Uint8Array([0x01]);

/**
 * KDF_RK(rk, dh_out) → (new_rk, ck)
 * Advances the root chain. Uses HKDF-SHA256 with rk as salt.
 */
function kdfRk(rk: Uint8Array, dhOut: Uint8Array): { rk: Uint8Array; ck: Uint8Array } {
  const out = hkdf(sha256, dhOut, rk, ROOT_INFO, 64);
  return { rk: out.slice(0, 32), ck: out.slice(32) };
}

/**
 * KDF_CK(ck) → (new_ck, mk)
 * Advances one sending or receiving chain. Uses HMAC-SHA256 (Signal spec §2.2).
 */
function kdfCk(ck: Uint8Array): { ck: Uint8Array; mk: Uint8Array } {
  const mk     = hmac(sha256, ck, MSG_KEY_CONSTANT);
  const nextCk = hmac(sha256, ck, CHAIN_KEY_CONSTANT);
  return { ck: nextCk, mk };
}

// ── AEAD ──────────────────────────────────────────────────────────────────────

/**
 * ChaCha20-Poly1305 with a random 12-byte nonce prepended to the output.
 * Associated data (the serialised header) is passed to the AEAD cipher so the
 * header is cryptographically bound to the ciphertext — tampering with either
 * causes decryption to throw.  This is the standard Signal DR binding step.
 */
function aeadEncrypt(mk: Uint8Array, plaintext: Uint8Array, ad: Uint8Array): Uint8Array {
  const nonce = randomBytes(12);
  const ct    = chacha20poly1305(mk, nonce, ad).encrypt(plaintext);
  const out   = new Uint8Array(12 + ct.length);
  out.set(nonce, 0);
  out.set(ct, 12);
  return out;
}

function aeadDecrypt(mk: Uint8Array, data: Uint8Array, ad: Uint8Array): Uint8Array {
  const nonce = data.slice(0, 12);
  const ct    = data.slice(12);
  return chacha20poly1305(mk, nonce, ad).decrypt(ct);
}

// ── X3DH ──────────────────────────────────────────────────────────────────────

/**
 * Full X3DH key agreement supporting both 3-DH and 4-DH (Signal spec).
 *
 * 3-DH (no OPK):  SK = HKDF(F || DH1 || DH2 || DH3)
 * 4-DH (with OPK): SK = HKDF(F || DH1 || DH2 || DH3 || DH4)
 *
 *   DH1 = DH(IK_A, SPK_B)
 *   DH2 = DH(EK_A, IK_B)
 *   DH3 = DH(EK_A, SPK_B)
 *   DH4 = DH(EK_A, OPK_B)  — only when a one-time prekey is available
 *
 * F = 0xFF * 32 (Signal spec: domain-separation constant)
 */
function x3dhShared(
  dh1: Uint8Array,
  dh2: Uint8Array,
  dh3: Uint8Array,
  dh4?: Uint8Array,
): Uint8Array {
  const F   = new Uint8Array(32).fill(0xff);
  const dhParts = dh4
    ? [dh1, dh2, dh3, dh4]
    : [dh1, dh2, dh3];
  const raw = new Uint8Array(32 + dhParts.length * 32);
  raw.set(F, 0);
  dhParts.forEach((dh, i) => raw.set(dh, 32 + i * 32));
  return hkdf(sha256, raw, new Uint8Array(32), strToBytes("GHOSTFACE_X3DH_v1"), 32);
}

// ── Post-quantum KEM (ML-KEM-768 hybrid layer) ─────────────────────────────────
//
// GHOSTFACE mixes an ML-KEM (Kyber) encapsulated secret into BOTH the X3DH
// handshake (PQXDH-style) and the ongoing Double Ratchet root key (PQ3-style
// continuous rekey).  The KEM secret is always COMBINED with the classical
// X25519 output through a KDF, never used alone — so the hybrid construction is
// at least as strong as the existing X25519 design and additionally resists a
// future quantum adversary ("harvest-now, decrypt-later").
//
// ML-KEM-768 (NIST level 3) sizes, in bytes:
//   public key 1184, secret key 2400, ciphertext 1088, shared secret 32.
// The parameter set is centralised here so it can be changed in one place.
const MLKEM = ml_kem768;
export const PQKEM_PUBLIC_BYTES = 1184;
export const PQKEM_SECRET_BYTES = 2400;
export const PQKEM_CIPHERTEXT_BYTES = 1088;

export interface KemKeyPair {
  pub: string; // ML-KEM public key, hex
  priv: string; // ML-KEM secret key, hex
}

/** Generate a fresh ML-KEM-768 keypair (hex-encoded). */
export function generateKemKeyPair(): KemKeyPair {
  const { publicKey, secretKey } = MLKEM.keygen();
  return { pub: toHex(publicKey), priv: toHex(secretKey) };
}

/** Encapsulate to an ML-KEM public key → (ciphertext, shared secret). */
function kemEncapsulate(pubHex: string): { ct: Uint8Array; ss: Uint8Array } {
  const { cipherText, sharedSecret } = MLKEM.encapsulate(fromHex(pubHex));
  return { ct: cipherText, ss: sharedSecret };
}

/** Decapsulate an ML-KEM ciphertext with our secret key → shared secret. */
function kemDecapsulate(ctHex: string, privHex: string): Uint8Array {
  return MLKEM.decapsulate(fromHex(ctHex), fromHex(privHex));
}

/**
 * Sign an ML-KEM public prekey with the IK Ed25519 signing key — the SAME key
 * that signs the SPK.  Lets the recipient bind the PQ prekey to the verified
 * identity and reject a server-substituted KEM key (PQ MITM defence).
 */
export function signKemPreKey(kemPubHex: string, ikSignPrivHex: string): string {
  return toHex(ed25519.sign(fromHex(kemPubHex), fromHex(ikSignPrivHex)));
}

/** Verify an ML-KEM prekey signature. Never throws (returns false on error). */
export function verifyKemPreKey(
  kemPubHex: string,
  sigHex: string,
  ikSignPublicHex: string,
): boolean {
  try {
    return ed25519.verify(fromHex(sigHex), fromHex(kemPubHex), fromHex(ikSignPublicHex));
  } catch {
    return false;
  }
}

const X3DH_PQ_INFO = strToBytes("GHOSTFACE_X3DH_PQ_v1");
const ROOT_INFO_PQ = strToBytes("GHOSTFACE_RATCHET_ROOT_PQ_v1");

/**
 * Fold an ML-KEM shared secret into the classical X3DH shared secret.
 * SK_hybrid = HKDF(ikm = classicalSK || kemSS).  Domain-separated from the
 * classical X3DH KDF so the two transcripts never collide.
 */
function hybridMixSK(classicalSK: Uint8Array, kemSS: Uint8Array): Uint8Array {
  const ikm = new Uint8Array(classicalSK.length + kemSS.length);
  ikm.set(classicalSK, 0);
  ikm.set(kemSS, classicalSK.length);
  return hkdf(sha256, ikm, new Uint8Array(32), X3DH_PQ_INFO, 32);
}

/**
 * KDF_RK variant that folds an ML-KEM shared secret into the root step
 * alongside the DH output: (new_rk, ck) = HKDF(ikm = dhOut || kemSS, salt = rk).
 * Domain-separated from the classical kdfRk via ROOT_INFO_PQ.  Both parties run
 * this identically on the matching ratchet step so their chains stay in sync.
 */
function kdfRkPQ(
  rk: Uint8Array,
  dhOut: Uint8Array,
  kemSS: Uint8Array,
): { rk: Uint8Array; ck: Uint8Array } {
  const ikm = new Uint8Array(dhOut.length + kemSS.length);
  ikm.set(dhOut, 0);
  ikm.set(kemSS, dhOut.length);
  const out = hkdf(sha256, ikm, rk, ROOT_INFO_PQ, 64);
  return { rk: out.slice(0, 32), ck: out.slice(32) };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RatchetHeader {
  dh: string;  // hex X25519 public key
  n:  number;  // message index in this chain
  pn: number;  // previous sending chain length
  /**
   * Post-quantum continuous rekey (PQ3-style). Present only when the session is
   * PQ-enabled:
   *   pqPub — our CURRENT ML-KEM public key, advertised so the peer can
   *           encapsulate to us on its next DH ratchet step.
   *   pqCt  — an ML-KEM ciphertext encapsulated to the peer's last-advertised
   *           pqPub, set on every message of a sending chain that begins with a
   *           DH ratchet step. Folded into the root key by both parties.
   * Both fields are part of the AEAD associated data (the serialised header), so
   * tampering with the PQ material breaks decryption.
   */
  pqPub?: string;
  pqCt?:  string;
}

export interface RatchetMessage {
  header:     RatchetHeader;
  ciphertext: string; // hex: 12-byte nonce + ChaCha20-Poly1305 ciphertext
}

interface RatchetState {
  DHs:       DHKeyPair;
  DHr:       Uint8Array | null;
  RK:        Uint8Array;
  CKs:       Uint8Array | null;
  CKr:       Uint8Array | null;
  Ns:        number;
  Nr:        number;
  PN:        number;
  MKSKIPPED: Map<string, Uint8Array>;
  step:      number;
  // ── Post-quantum continuous-rekey state ──
  pq:          boolean;          // PQ rekey enabled for this session
  PQs:         KemKeyPair | null; // our current ML-KEM keypair (we advertise PQs.pub)
  PQr:         string | null;     // peer's last-advertised ML-KEM public key (hex)
  pendingPqCt: string | null;     // ct attached to outgoing headers in the current sending chain
}

/** Serialised form for AsyncStorage (all byte arrays as hex strings). */
export interface SerializedRatchetState {
  DHs:       { priv: string; pub: string };
  DHr:       string | null;
  RK:        string;
  CKs:       string | null;
  CKr:       string | null;
  Ns:        number;
  Nr:        number;
  PN:        number;
  MKSKIPPED: Record<string, string>;
  step:      number;
  // PQ fields are optional for backward compatibility with pre-PQ sessions —
  // an absent/false `pq` means the session runs classical-only.
  pq?:          boolean;
  PQs?:         { priv: string; pub: string } | null;
  PQr?:         string | null;
  pendingPqCt?: string | null;
}

/** Both sides of a DR session stored per conversation. */
export interface DRSession {
  alice:           SerializedRatchetState;
  bob:             SerializedRatchetState;
  lastAliceHeader: RatchetHeader | null;
  /** True if the session was established with a one-time prekey (4-DH X3DH). */
  usedOPK?:        boolean;
}

/** A one-time prekey: public key (hex) and private key (hex). */
export interface OneTimePreKey {
  pub:  string;
  priv: string;
}

// ── Ed25519 SPK Signing ───────────────────────────────────────────────────────
//
// Signal X3DH §2.4 requires the Signed PreKey (SPK) to be signed by the
// Identity Key.  Without this, a malicious server can substitute its own
// SPK and silently MITM every new session — the recipient would derive a
// different shared secret and authentication would fail, but the initiator
// would be talking to the attacker.
//
// Implementation:
//   - A separate Ed25519 signing key pair (ikSign) is generated at registration.
//   - The SPK X25519 public key bytes are signed: sig = Ed25519.sign(spkPub, ikSignPriv)
//   - ikSignPublicKey (Ed25519 pub) and spkSignature are stored on the server.
//   - Alice verifies: Ed25519.verify(spkSignature, spkPub, ikSignPublicKey)
//     before proceeding with X3DH.  A bad signature throws immediately.

export interface SigningKeyPair {
  priv: string; // Ed25519 private key, hex (32 bytes = 64 chars)
  pub:  string; // Ed25519 public key,  hex (32 bytes = 64 chars)
}

/**
 * Generate a fresh Ed25519 signing key pair.
 * Used to create the IK signing key at device registration time.
 */
export function generateSigningKeyPair(): SigningKeyPair {
  const priv = randomBytes(32);
  const pub  = ed25519.getPublicKey(priv);
  return { priv: toHex(priv), pub: toHex(pub) };
}

/**
 * Sign a SPK X25519 public key (hex) with the IK Ed25519 signing private key (hex).
 * Returns the 64-byte signature as hex (128 chars).
 *
 * Signal spec: sign(spkPub, ikSignPriv)
 */
export function signSPK(spkPublicKeyHex: string, ikSignPrivHex: string): string {
  const sig = ed25519.sign(fromHex(spkPublicKeyHex), fromHex(ikSignPrivHex));
  return toHex(sig);
}

/**
 * Verify that a SPK public key was signed by the given IK Ed25519 signing key.
 * Returns true if the signature is valid, false otherwise (never throws).
 *
 * Alice MUST call this before proceeding with X3DH.
 */
export function verifySPKSignature(
  spkPublicKeyHex:  string,
  signatureHex:     string,
  ikSignPublicHex:  string,
): boolean {
  try {
    return ed25519.verify(fromHex(signatureHex), fromHex(spkPublicKeyHex), fromHex(ikSignPublicHex));
  } catch {
    return false;
  }
}

// ── One-time prekeys ───────────────────────────────────────────────────────────

/**
 * Generate a batch of one-time prekeys for upload.
 * @param count Number of prekeys to generate (default 10).
 * @returns Array of { pub, priv } pairs. Only pub is sent to the server.
 */
export function generateOneTimePreKeys(count = 10): OneTimePreKey[] {
  return Array.from({ length: count }, () => {
    const kp = generateDH();
    return { pub: toHex(kp.pub), priv: toHex(kp.priv) };
  });
}

/**
 * A prekey bundle as fetched from the server for initiating an X3DH session.
 *
 * Public keys only — this is exactly what the server stores and transmits.
 * Alice never sees Bob's private keys; Bob keeps them on his own device and
 * completes his side of X3DH from the first message's X3DH header.
 *
 *   ikPublicKey  — Bob's long-term identity public key
 *   spkPublicKey — Bob's signed prekey public key
 *   opkPublicKey — Bob's one-time prekey public key (null → 3-DH fallback)
 */
export interface PreKeyBundle {
  ikPublicKey:     string;
  spkPublicKey:    string;
  opkPublicKey:    string | null;
  /**
   * Ed25519 signature of the SPK X25519 public key bytes, produced by the
   * registering device using ikSignPriv.  Alice MUST verify this before
   * accepting the bundle.  Without it, the server can MITM every new session.
   * Signal X3DH spec §2.4.
   */
  spkSignature?:    string;
  /**
   * Ed25519 public key of the IK signing key pair — used to verify spkSignature.
   * Separate from the X25519 ikPublicKey used for DH operations.
   */
  ikSignPublicKey?: string;
  /**
   * Bob's signed ML-KEM (Kyber) public prekey, enabling the post-quantum hybrid
   * handshake. Public-only. When present it MUST be accompanied by
   * pqkemSignature (Ed25519 over the KEM pub bytes, signed by ikSign) — Alice
   * verifies it before encapsulating. Absent → classical-only fallback.
   */
  pqkemPublicKey?: string;
  pqkemSignature?: string;
}


// ── Serialisation ─────────────────────────────────────────────────────────────

function serializeState(s: RatchetState): SerializedRatchetState {
  const MKSKIPPED: Record<string, string> = {};
  s.MKSKIPPED.forEach((v, k) => { MKSKIPPED[k] = toHex(v); });
  return {
    DHs:       { priv: toHex(s.DHs.priv), pub: toHex(s.DHs.pub) },
    DHr:       s.DHr  ? toHex(s.DHr)  : null,
    RK:        toHex(s.RK),
    CKs:       s.CKs  ? toHex(s.CKs)  : null,
    CKr:       s.CKr  ? toHex(s.CKr)  : null,
    Ns: s.Ns, Nr: s.Nr, PN: s.PN,
    MKSKIPPED,
    step: s.step,
    pq:          s.pq,
    PQs:         s.PQs ? { priv: s.PQs.priv, pub: s.PQs.pub } : null,
    PQr:         s.PQr,
    pendingPqCt: s.pendingPqCt,
  };
}

function deserializeState(s: SerializedRatchetState): RatchetState {
  const MKSKIPPED = new Map<string, Uint8Array>();
  Object.entries(s.MKSKIPPED).forEach(([k, v]) => { MKSKIPPED.set(k, fromHex(v)); });
  return {
    DHs: { priv: fromHex(s.DHs.priv), pub: fromHex(s.DHs.pub) },
    DHr:  s.DHr  ? fromHex(s.DHr)  : null,
    RK:   fromHex(s.RK),
    CKs:  s.CKs  ? fromHex(s.CKs)  : null,
    CKr:  s.CKr  ? fromHex(s.CKr)  : null,
    Ns: s.Ns, Nr: s.Nr, PN: s.PN,
    MKSKIPPED,
    step: s.step,
    // Legacy (pre-PQ) states have no PQ fields → default to classical-only.
    pq:          s.pq ?? false,
    PQs:         s.PQs ? { priv: s.PQs.priv, pub: s.PQs.pub } : null,
    PQr:         s.PQr ?? null,
    pendingPqCt: s.pendingPqCt ?? null,
  };
}


// ── Ratchet Encrypt ───────────────────────────────────────────────────────────

// ── Length-hiding padding ─────────────────────────────────────────────────────
//
// Plaintext length leaks content size even under AEAD: a one-word reply and a
// long paragraph produce visibly different ciphertext lengths, and an
// attachment dwarfs a text line. To make on-the-wire and at-rest ciphertext
// length blind to the actual content, every plaintext is framed and padded to a
// fixed-size bucket BEFORE encryption and stripped exactly after decryption.
//
// Framing: [4-byte big-endian body length] [body bytes] [zero filler]. The
// total is padded up to the smallest bucket that fits. Beyond the largest fixed
// bucket (e.g. large attachments) we round up to the next 64 KiB multiple so the
// leak is bounded to bucket granularity rather than exact size.
const PAD_PREFIX_BYTES = 4;
const PAD_BUCKETS = [256, 1024, 4096, 16384, 65536];
const PAD_MAX_BUCKET = PAD_BUCKETS[PAD_BUCKETS.length - 1];

function paddedBucketSize(framedLen: number): number {
  for (const b of PAD_BUCKETS) if (framedLen <= b) return b;
  return Math.ceil(framedLen / PAD_MAX_BUCKET) * PAD_MAX_BUCKET;
}

/** Frame `plaintext` and pad to a fixed bucket. Returns the bytes to encrypt. */
function padPlaintext(plaintext: string): Uint8Array {
  const body = strToBytes(plaintext);
  const total = paddedBucketSize(body.length + PAD_PREFIX_BYTES);
  const out = new Uint8Array(total);
  out[0] = (body.length >>> 24) & 0xff;
  out[1] = (body.length >>> 16) & 0xff;
  out[2] = (body.length >>> 8) & 0xff;
  out[3] = body.length & 0xff;
  out.set(body, PAD_PREFIX_BYTES);
  return out;
}

/**
 * Reverse padPlaintext. Defensive against legacy un-padded ciphertext: a
 * plaintext that was encrypted before padding existed has its first 4 bytes
 * interpreted as a length prefix; for any printable/JSON payload that yields a
 * value far larger than the buffer, so we fall back to decoding the whole thing.
 */
function unpadPlaintext(padded: Uint8Array): string {
  if (padded.length < PAD_PREFIX_BYTES) return bytesToStr(padded);
  const len =
    ((padded[0] << 24) | (padded[1] << 16) | (padded[2] << 8) | padded[3]) >>> 0;
  if (len + PAD_PREFIX_BYTES > padded.length) return bytesToStr(padded);
  return bytesToStr(padded.subarray(PAD_PREFIX_BYTES, PAD_PREFIX_BYTES + len));
}

/**
 * Encrypt `plaintext` with the given ratchet state.
 * Advances the sending chain key (forward secrecy).
 * Returns the updated state and the wire-format message.
 */
export function ratchetEncrypt(
  serialized: SerializedRatchetState,
  plaintext: string,
): { state: SerializedRatchetState; message: RatchetMessage } {
  const s = deserializeState(serialized);
  if (!s.CKs) throw new Error("[DR] No sending chain key — cannot encrypt");

  const { ck: newCKs, mk } = kdfCk(s.CKs);

  const header: RatchetHeader = {
    dh: toHex(s.DHs.pub),
    n:  s.Ns,
    pn: s.PN,
  };

  // Post-quantum: advertise our current ML-KEM public key on every message and
  // attach the ciphertext for the peer (set when this sending chain began with a
  // DH ratchet). Both ride inside the AEAD associated data via the serialised header.
  if (s.pq && s.PQs) header.pqPub = s.PQs.pub;
  if (s.pq && s.pendingPqCt && s.Ns < PQ_CT_RESEND_WINDOW) header.pqCt = s.pendingPqCt;

  const ad         = strToBytes(JSON.stringify(header));
  const ciphertext = aeadEncrypt(mk, padPlaintext(plaintext), ad);

  s.CKs = newCKs;
  s.Ns  += 1;

  return {
    state:   serializeState(s),
    message: { header, ciphertext: toHex(ciphertext) },
  };
}

// ── Ratchet Decrypt ───────────────────────────────────────────────────────────

function trySkippedKey(
  s: RatchetState,
  header: RatchetHeader,
  ct: Uint8Array,
  ad: Uint8Array,
): Uint8Array | null {
  const k  = `${header.dh}:${header.n}`;
  const mk = s.MKSKIPPED.get(k);
  if (!mk) return null;
  s.MKSKIPPED.delete(k);
  return aeadDecrypt(mk, ct, ad);
}

function skipChainKeys(s: RatchetState, until: number): void {
  if (s.Nr + MAX_SKIP < until) throw new Error("[DR] Too many skipped messages");
  if (!s.CKr || !s.DHr) return;
  while (s.Nr < until) {
    const { ck, mk } = kdfCk(s.CKr);
    s.CKr = ck;
    s.MKSKIPPED.set(`${toHex(s.DHr)}:${s.Nr}`, mk);
    s.Nr  += 1;
  }
}

function performDHRatchet(s: RatchetState, header: RatchetHeader): void {
  const newDHr = fromHex(header.dh);
  s.PN  = s.Ns;
  s.Ns  = 0;
  s.Nr  = 0;
  s.DHr = newDHr;

  // ── Receiving chain: DH(our_current_DHs, their_new_DHr) ──
  // PQ3 continuous rekey: if the peer attached a KEM ciphertext, decapsulate it
  // with our CURRENT (not-yet-rotated) KEM private key and fold the secret in.
  // This MUST happen before we rotate PQs below.
  const dhOutR = dhCompute(s.DHs, newDHr);
  if (s.pq && header.pqCt && s.PQs) {
    const ssIn = kemDecapsulate(header.pqCt, s.PQs.priv);
    const { rk, ck } = kdfRkPQ(s.RK, dhOutR, ssIn);
    s.RK = rk; s.CKr = ck;
  } else {
    const { rk, ck } = kdfRk(s.RK, dhOutR);
    s.RK = rk; s.CKr = ck;
  }

  // Record the peer's latest advertised KEM public key, then rotate our own
  // KEM keypair (forward secrecy — the old private key is discarded).
  if (s.pq && header.pqPub) s.PQr = header.pqPub;
  if (s.pq) s.PQs = generateKemKeyPair();

  // ── Sending chain: generate fresh DH keypair, advance root again ──
  s.DHs = generateDH();
  const dhOutS = dhCompute(s.DHs, newDHr);
  if (s.pq && s.PQr) {
    // Encapsulate to the peer's latest KEM key; the ciphertext travels on every
    // message of this new sending chain, the secret folds into our sending root.
    const { ct, ss } = kemEncapsulate(s.PQr);
    s.pendingPqCt = toHex(ct);
    const { rk, ck } = kdfRkPQ(s.RK, dhOutS, ss);
    s.RK = rk; s.CKs = ck;
  } else {
    s.pendingPqCt = null;
    const { rk, ck } = kdfRk(s.RK, dhOutS);
    s.RK = rk; s.CKs = ck;
  }
  s.step += 1;
}

/**
 * Decrypt a Double Ratchet message.
 * Automatically performs a DH ratchet step when the sender's DH key changes.
 */
export function ratchetDecrypt(
  serialized: SerializedRatchetState,
  message: RatchetMessage,
): { state: SerializedRatchetState; plaintext: string } {
  const s  = deserializeState(serialized);
  const { header, ciphertext: ctHex } = message;
  const ct = fromHex(ctHex);
  const ad = strToBytes(JSON.stringify(header));

  // 1. Try a cached skipped-message key
  const fromSkip = trySkippedKey(s, header, ct, ad);
  if (fromSkip !== null) {
    return { state: serializeState(s), plaintext: unpadPlaintext(fromSkip) };
  }

  // 2. If new DH key in header → perform DH ratchet step
  const isNewDH = !s.DHr || toHex(s.DHr) !== header.dh;
  if (isNewDH) {
    skipChainKeys(s, header.pn);          // cache any skipped keys from previous chain
    performDHRatchet(s, header);
  }

  // 3. Skip to the right message index in the current receiving chain
  skipChainKeys(s, header.n);

  // 4. Consume the next chain key to get the message key
  if (!s.CKr) throw new Error("[DR] No receiving chain key");
  const { ck, mk } = kdfCk(s.CKr);
  s.CKr = ck;
  s.Nr  += 1;

  const plaintext = unpadPlaintext(aeadDecrypt(mk, ct, ad));
  return { state: serializeState(s), plaintext };
}

// ── Helpers for UI ────────────────────────────────────────────────────────────

/** 8-char hex fingerprint of a serialised state's active DH public key. */
export function drKeyFingerprint(state: SerializedRatchetState): string {
  return state.DHs.pub.substring(0, 8).toUpperCase();
}

// ── Integrity validation ──────────────────────────────────────────────────────

/** Check that a hex string has the expected byte length (n bytes = 2n hex chars). */
function isHex(v: unknown, bytes: number): boolean {
  return typeof v === "string" && v.length === bytes * 2 && /^[0-9a-f]+$/i.test(v);
}

/**
 * Validate the shape of a deserialised ratchet state.
 * Returns true only if all required fields are well-formed hex values.
 * Call this on startup to detect corrupted / migrated states.
 */
export function isValidRatchetState(s: unknown): s is SerializedRatchetState {
  if (!s || typeof s !== "object") return false;
  const r = s as Record<string, unknown>;
  if (!r.DHs || typeof r.DHs !== "object") return false;
  const dhs = r.DHs as Record<string, unknown>;
  // PQ fields are OPTIONAL — legacy (pre-PQ) states omit them and run classical.
  const pqs = r.PQs as Record<string, unknown> | null | undefined;
  const pqsValidPair =
    typeof pqs === "object" && pqs !== null &&
    isHex(pqs.pub,  PQKEM_PUBLIC_BYTES) &&
    isHex(pqs.priv, PQKEM_SECRET_BYTES);
  // A post-quantum session (pq===true) MUST carry a valid rotating ML-KEM
  // keypair (PQs); without it the next DH ratchet step cannot encapsulate and
  // the session would silently de-sync. Reject such broken states so the app
  // rebuilds a fresh (classical or hybrid) session instead of losing messages.
  const pqsOk = r.pq === true
    ? pqsValidPair
    : (pqs === null || pqs === undefined || pqsValidPair);
  return (
    isHex(dhs.priv, 32) &&
    isHex(dhs.pub,  32) &&
    isHex(r.RK,     32) &&
    (r.DHr  === null || isHex(r.DHr,  32)) &&
    (r.CKs  === null || isHex(r.CKs,  32)) &&
    (r.CKr  === null || isHex(r.CKr,  32)) &&
    typeof r.Ns === "number" &&
    typeof r.Nr === "number" &&
    typeof r.PN === "number" &&
    typeof r.step === "number" &&
    (r.pq === undefined || typeof r.pq === "boolean") &&
    pqsOk &&
    (r.PQr === undefined || r.PQr === null || isHex(r.PQr, PQKEM_PUBLIC_BYTES)) &&
    (r.pendingPqCt === undefined || r.pendingPqCt === null ||
      isHex(r.pendingPqCt, PQKEM_CIPHERTEXT_BYTES))
  );
}

/**
 * Validate a complete DRSession object.
 * Returns true only if both alice and bob states are well-formed.
 */
export function isValidDRSession(session: unknown): session is DRSession {
  if (!session || typeof session !== "object") return false;
  const s = session as Record<string, unknown>;
  return isValidRatchetState(s.alice) && isValidRatchetState(s.bob);
}

// ── Real multi-device X3DH ────────────────────────────────────────────────────

/**
 * X3DH header included in the very first message of a conversation.
 * The sender (Alice) embeds her long-term IK public key, a fresh ephemeral
 * public key, and optionally the one-time prekey ID she consumed, so the
 * recipient (Bob) can independently derive the same shared secret using only
 * his own private keys.
 *
 * This is the standard Signal "PreKeySignalMessage" header.
 * Only needed for the first message — subsequent messages use the DR header.
 */
export interface X3DHHeader {
  ikA:   string;  // Alice's IK public key (hex, 64 chars)
  ekA:   string;  // Alice's ephemeral public key for this session (hex, 64 chars)
  opkId?: string; // Bob's OPK public key that was consumed (hex, 64 chars). Null → 3-DH.
  /**
   * PQXDH: ML-KEM ciphertext encapsulated to Bob's signed KEM prekey. Present
   * only when the bundle carried a (verified) ML-KEM prekey. Bob decapsulates it
   * with his stored KEM secret key and folds the result into the shared secret.
   */
  pqkemCt?: string;
}

/**
 * Initiate a real X3DH session from Alice's side.
 *
 * Uses Alice's stored long-term IK keypair (not re-generated).  Generates a fresh
 * ephemeral key EK for this session.  Computes the shared secret SK using only
 * Bob's PUBLIC keys from the prekey bundle (protocol-correct: no private keys cross
 * the wire to the server).
 *
 * Returns:
 *   session.alice — Alice's properly initialised DR state ready for ratchetEncrypt
 *   session.bob   — stub only (Bob's real state lives on Bob's device)
 *   x3dhHeader    — must be included in the first message payload so Bob can init
 *
 * ALL further DR operations on Alice's device use session.alice.
 * Convention: drSession.alice always holds the CURRENT DEVICE's ratchet state.
 */
export function initSessionAliceWithHeader(
  bundle: PreKeyBundle,
  myIKPriv: string,
  myIKPub:  string,
): { session: DRSession; x3dhHeader: X3DHHeader } {
  // ── SPK signature verification (Signal X3DH §2.4) ─────────────────────────
  // Must verify before performing any DH operations. An invalid signature means
  // the server returned a tampered bundle — reject immediately.
  if (bundle.spkSignature && bundle.ikSignPublicKey) {
    const valid = verifySPKSignature(bundle.spkPublicKey, bundle.spkSignature, bundle.ikSignPublicKey);
    if (!valid) {
      throw new Error("[X3DH] SPK signature verification FAILED — bundle rejected (possible MITM)");
    }
  } else {
    console.warn("[X3DH] Bundle has no SPK signature — proceeding without MITM protection (legacy registration)");
  }

  const IK_A: DHKeyPair = { priv: fromHex(myIKPriv), pub: fromHex(myIKPub) };
  const EK_A = generateDH();

  const ikBPub  = fromHex(bundle.ikPublicKey);
  const spkBPub = fromHex(bundle.spkPublicKey);
  const opkBPub: Uint8Array | undefined = bundle.opkPublicKey
    ? fromHex(bundle.opkPublicKey)
    : undefined;

  let SK = x3dhShared(
    dhCompute(IK_A, spkBPub),
    dhCompute(EK_A, ikBPub),
    dhCompute(EK_A, spkBPub),
    opkBPub ? dhCompute(EK_A, opkBPub) : undefined,
  );

  // ── PQXDH: hybrid post-quantum handshake ──────────────────────────────────
  // If Bob published a signed ML-KEM prekey, verify it with the SAME Ed25519 IK
  // signing key that signs the SPK, encapsulate to it, and fold the KEM secret
  // into SK. Strict: a KEM prekey WITHOUT a valid signature is rejected (never
  // silently downgraded), preventing a server-substituted KEM key.
  let pqEnabled = false;
  let pqkemCt: string | undefined;
  if (bundle.pqkemPublicKey) {
    if (!bundle.pqkemSignature || !bundle.ikSignPublicKey) {
      throw new Error("[PQXDH] ML-KEM prekey present without a signature — bundle rejected");
    }
    const okPq = verifyKemPreKey(bundle.pqkemPublicKey, bundle.pqkemSignature, bundle.ikSignPublicKey);
    if (!okPq) {
      throw new Error("[PQXDH] ML-KEM prekey signature verification FAILED — bundle rejected (possible MITM)");
    }
    const { ct, ss } = kemEncapsulate(bundle.pqkemPublicKey);
    SK = hybridMixSK(SK, ss);
    pqkemCt = toHex(ct);
    pqEnabled = true;
  }

  const aliceDHs = generateDH();
  const { rk: aliceRK, ck: aliceCKs } = kdfRk(SK, dhCompute(aliceDHs, spkBPub));

  const aliceState: RatchetState = {
    DHs: aliceDHs,
    DHr: spkBPub,
    RK:  aliceRK,
    CKs: aliceCKs,
    CKr: null,
    Ns: 0, Nr: 0, PN: 0,
    MKSKIPPED: new Map(),
    step: 0,
    // PQ continuous rekey: start advertising a fresh KEM key; we learn the
    // peer's pub from their first reply (PQr stays null until then).
    pq:          pqEnabled,
    PQs:         pqEnabled ? generateKemKeyPair() : null,
    PQr:         null,
    pendingPqCt: null,
  };

  const bobStub: RatchetState = {
    DHs: generateDH(),
    DHr: null,
    RK:  SK,
    CKs: null,
    CKr: null,
    Ns: 0, Nr: 0, PN: 0,
    MKSKIPPED: new Map(),
    step: 0,
    pq:          false,
    PQs:         null,
    PQr:         null,
    pendingPqCt: null,
  };

  const session: DRSession = {
    alice:           serializeState(aliceState),
    bob:             serializeState(bobStub),
    lastAliceHeader: null,
    usedOPK:         !!opkBPub,
  };

  const x3dhHeader: X3DHHeader = {
    ikA:   myIKPub,
    ekA:   toHex(EK_A.pub),
    opkId: bundle.opkPublicKey ?? undefined,
    pqkemCt,
  };

  return { session, x3dhHeader };
}

/**
 * Set up Bob's DR session from an incoming X3DH header (the first message Alice sends).
 *
 * Bob uses his own stored private keys (IK, SPK, optionally OPK) to derive the
 * same shared secret SK that Alice computed without either party exchanging private keys.
 *
 * Returns a DRSession where session.alice holds BOB'S initialised ratchet state.
 * Convention: drSession.alice is always the CURRENT DEVICE's state, whether initiator
 * or responder.  Callers should use ratchetDecrypt(drSession.alice, ...) to process
 * Alice's first message immediately after calling this.
 */
export function initSessionBobFromHeader(
  x3dhHeader: X3DHHeader,
  bobIKPriv: string,
  bobIKPub:  string,
  bobSPKPriv: string,
  bobSPKPub:  string,
  opkPriv?:   string,
  bobKemPriv?: string,
): DRSession {
  const IK_B:  DHKeyPair = { priv: fromHex(bobIKPriv),  pub: fromHex(bobIKPub)  };
  const SPK_B: DHKeyPair = { priv: fromHex(bobSPKPriv), pub: fromHex(bobSPKPub) };

  const ikAPub  = fromHex(x3dhHeader.ikA);
  const ekAPub  = fromHex(x3dhHeader.ekA);
  const opkPub: Uint8Array | undefined = x3dhHeader.opkId
    ? fromHex(x3dhHeader.opkId)
    : undefined;
  const opkKP: DHKeyPair | undefined = (opkPriv && opkPub)
    ? { priv: fromHex(opkPriv), pub: opkPub }
    : undefined;

  let SK = x3dhShared(
    dhCompute(SPK_B, ikAPub),
    dhCompute(IK_B,  ekAPub),
    dhCompute(SPK_B, ekAPub),
    opkKP ? dhCompute(opkKP, ekAPub) : undefined,
  );

  // ── PQXDH: decapsulate Alice's ML-KEM ciphertext (if present) ──────────────
  // Bob folds the same KEM secret into SK. If the handshake carried a KEM
  // ciphertext but Bob has no stored KEM private key, fail loudly rather than
  // silently deriving a mismatched (classical-only) key.
  let pqEnabled = false;
  if (x3dhHeader.pqkemCt) {
    if (!bobKemPriv) {
      throw new Error("[PQXDH] handshake carries an ML-KEM ciphertext but no KEM private key is available");
    }
    const ss = kemDecapsulate(x3dhHeader.pqkemCt, bobKemPriv);
    SK = hybridMixSK(SK, ss);
    pqEnabled = true;
  }

  const bobState: RatchetState = {
    DHs: SPK_B,
    DHr: null,
    RK:  SK,
    CKs: null,
    CKr: null,
    Ns: 0, Nr: 0, PN: 0,
    MKSKIPPED: new Map(),
    step: 0,
    // Bob starts advertising a fresh KEM key; learns Alice's pub from her first
    // DR message (header.pqPub) during the first DH ratchet.
    pq:          pqEnabled,
    PQs:         pqEnabled ? generateKemKeyPair() : null,
    PQr:         null,
    pendingPqCt: null,
  };

  const aliceStub: RatchetState = {
    DHs: generateDH(),
    DHr: null,
    RK:  SK,
    CKs: null,
    CKr: null,
    Ns: 0, Nr: 0, PN: 0,
    MKSKIPPED: new Map(),
    step: 0,
    pq:          false,
    PQs:         null,
    PQr:         null,
    pendingPqCt: null,
  };

  return {
    alice:           serializeState(bobState),
    bob:             serializeState(aliceStub),
    lastAliceHeader: null,
    usedOPK:         !!opkPub,
  };
}
