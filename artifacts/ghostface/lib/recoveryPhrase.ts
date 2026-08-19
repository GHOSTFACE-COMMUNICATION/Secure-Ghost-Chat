/**
 * Local recovery phrase for the identity key (IK).
 *
 * The IK (X25519, 32 bytes) is this app's one stable, long-term identity
 * anchor — SPK/PQKEM/ikSign are all ephemeral and rotate. A BIP39 mnemonic
 * is a reversible encoding of raw entropy, so a 24-word phrase (256 bits)
 * encodes the IK private key directly — this is a backup of the EXACT
 * existing key, not a KDF that derives a new one from the phrase.
 *
 * Never persisted anywhere — shown once at generation time, decoded back
 * to bytes only in-memory during a recovery attempt.
 */
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { fromHex, toHex } from "@/lib/doubleRatchet";

export const RECOVERY_PHRASE_WORD_COUNT = 24;

/** Encode a 32-byte private key (hex) as a 24-word BIP39 recovery phrase. */
export function keyToRecoveryPhrase(privKeyHex: string): string {
  return entropyToMnemonic(fromHex(privKeyHex), wordlist);
}

/**
 * Decode a recovery phrase back to the original private key (hex).
 * Returns null on a malformed phrase, wrong word count, or failed checksum —
 * never throws, so callers can show a plain "invalid phrase" message.
 */
export function recoveryPhraseToKey(phrase: string): string | null {
  const normalized = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  const words = normalized.split(" ").filter(Boolean);
  if (words.length !== RECOVERY_PHRASE_WORD_COUNT) return null;
  if (!validateMnemonic(normalized, wordlist)) return null;
  try {
    return toHex(mnemonicToEntropy(normalized, wordlist));
  } catch {
    return null;
  }
}

/** For live per-word validation while typing (e.g. red-underline a bad word). */
export function isRecoveryPhraseWord(word: string): boolean {
  return wordlist.includes(word.trim().toLowerCase());
}
