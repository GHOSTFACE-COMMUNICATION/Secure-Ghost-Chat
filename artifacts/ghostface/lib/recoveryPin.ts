/**
 * Recovery PIN — a real second factor for identity restore.
 *
 * The 24-word recovery phrase is a reversible BIP39 encoding of the raw
 * identity key (see lib/recoveryPhrase.ts). On its own, a leaked phrase is
 * total compromise. This module blinds the key with a user-chosen PIN before
 * it is encoded as a phrase:
 *
 *     phraseValue = identityKey XOR argon2id(pin, salt)
 *
 * so the phrase alone is useless — restore needs BOTH the phrase and the PIN.
 * We never store the PIN anywhere; it is the second factor.
 *
 * Because an alias's PUBLIC identity key is fetchable by anyone (the prekey
 * bundle endpoint is unauthenticated), an attacker with the phrase can brute
 * the PIN offline: derive a candidate key, compute its public key, compare.
 * The only defence is making each guess expensive — hence argon2id (memory
 * hard) with strong params, run in NATIVE code (react-native-argon2) because
 * pure-JS argon2 under Hermes is ~8s+ and unusable. The PIN length is the
 * hard ceiling; a 6-digit PIN + these params puts an offline sweep in the
 * weeks-of-dedicated-compute range.
 *
 * Salt: derived deterministically from the alias (SHA-256 of a domain tag +
 * the normalized alias). A salt only needs to be UNIQUE per identity, not
 * secret; hashing the alias gives that without storing anything server-side,
 * so the whole feature stays client-only and preserves the "we never store
 * your recovery material" property. (A server-stored random salt only adds
 * value when paired with server-side rate-limiting — a future hardening.)
 */
import argon2 from "react-native-argon2";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

import { fromHex, toHex } from "@/lib/doubleRatchet";

export const RECOVERY_PIN_LENGTH = 6;

// argon2id cost. Measured native on-device: ~0.5s (sim) / ~1.5–2.5s (mid
// phone) at 64 MiB / t=3. Strong and memory-hard, tolerable for a set-once /
// restore-only operation. Do NOT lower without re-checking the offline-brute
// math above — these numbers are the whole security argument.
const ARGON2_OPTS = {
  iterations: 3,
  memory: 64 * 1024, // KiB → 64 MiB
  parallelism: 1,
  hashLength: 32,
  mode: "argon2id" as const,
  saltEncoding: "hex" as const,
};

// Bump this tag only with a migration plan — it is baked into every phrase
// ever shown, so changing it invalidates all existing recovery phrases.
const SALT_DOMAIN = "ghostface/recovery-pin/v1|";

/** A 6-digit numeric PIN. */
export function isValidRecoveryPin(pin: string): boolean {
  return new RegExp(`^\\d{${RECOVERY_PIN_LENGTH}}$`).test(pin);
}

/**
 * Deterministic per-alias argon2 salt (hex). Public and derivable by design —
 * uniqueness per alias (not secrecy) is what a salt needs, and deriving it
 * from the alias keeps restore possible on a fresh device with nothing stored.
 */
export function recoverySaltForAlias(alias: string): string {
  return toHex(sha256(utf8ToBytes(SALT_DOMAIN + alias.trim().toLowerCase())));
}

function xorHex(aHex: string, bHex: string): string {
  const a = fromHex(aHex);
  const b = fromHex(bHex);
  if (a.length !== b.length) {
    throw new Error("recoveryPin: XOR operand length mismatch");
  }
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return toHex(out);
}

/** 32-byte blind (hex) derived from the PIN + alias salt via native argon2id. */
async function deriveBlind(pin: string, alias: string): Promise<string> {
  const { rawHash } = await argon2(pin, recoverySaltForAlias(alias), ARGON2_OPTS);
  // rawHash is the hex representation of the 32-byte output.
  if (typeof rawHash !== "string" || rawHash.length !== 64) {
    throw new Error("recoveryPin: unexpected argon2 output");
  }
  return rawHash;
}

/**
 * Blind the identity private key with the recovery PIN. The returned 32-byte
 * hex is what gets encoded as the 24-word phrase shown to the user — NOT the
 * raw key. Restore reverses this with the same PIN.
 */
export async function blindKeyForPhrase(
  ikPrivHex: string,
  pin: string,
  alias: string,
): Promise<string> {
  return xorHex(ikPrivHex, await deriveBlind(pin, alias));
}

/**
 * Recover the identity private key from a blinded phrase value + the recovery
 * PIN. A wrong PIN yields a wrong key (which then fails the server reclaim
 * challenge), so this never signals "wrong PIN" directly — the caller treats a
 * failed reclaim as "wrong PIN or phrase".
 */
export async function unblindKeyFromPhrase(
  blindedHex: string,
  pin: string,
  alias: string,
): Promise<string> {
  return xorHex(blindedHex, await deriveBlind(pin, alias));
}

/**
 * A non-reversible check value for the recovery PIN, stored on THIS device so
 * "view recovery phrase" in Settings can reject a mistyped PIN (which would
 * otherwise render a plausible-but-wrong phrase). Safe to store locally: the
 * threat model for the recovery PIN is a leaked PHRASE, not a compromised
 * device — a device that has this value already holds the raw identity key.
 */
export async function recoveryPinVerifier(pin: string, alias: string): Promise<string> {
  return toHex(sha256(utf8ToBytes("ghostface/recovery-pin-verifier/v1|" + (await deriveBlind(pin, alias)))));
}
