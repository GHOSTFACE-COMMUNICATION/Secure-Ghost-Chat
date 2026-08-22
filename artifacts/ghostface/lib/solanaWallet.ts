/**
 * Non-custodial Solana wallet: key generation, derivation, and recovery.
 *
 * ── Why standard derivation ────────────────────────────────────────────
 * This deliberately uses the ecosystem-standard path — BIP39 mnemonic ->
 * BIP39 seed -> SLIP-0010 ed25519 derivation at m/44'/501'/0'/0' — rather
 * than the entropy-as-key shortcut used by lib/recoveryPhrase.ts for the
 * messaging identity key.
 *
 * The difference matters because this key holds MONEY. A standard phrase
 * can be imported into Phantom, Solflare, or any other Solana wallet and
 * produce the SAME address. That is the user's escape hatch if GHOSTFACE is
 * uninstalled, wiped, or ceases to exist. An app-specific encoding would
 * strand funds behind this one binary, and a user who tried to restore it
 * elsewhere would see a different, empty address and conclude their money
 * was gone.
 *
 * ── Separation from the identity key ───────────────────────────────────
 * This is an INDEPENDENT key with its own phrase, not derived from the
 * identity key. Deriving it from the IK would mean a compromise of the
 * messaging identity is also a compromise of the funds. They are kept
 * cryptographically unrelated on purpose. The cost is that the user has two
 * phrases to keep, which the UI must make unmistakably clear.
 *
 * ── Loss is final ──────────────────────────────────────────────────────
 * There is no server-side copy and no reset. Panic wipe, duress wipe, a
 * lost device, or a reinstall all destroy the key. Only the phrase can
 * bring it back. Callers MUST confirm the user has recorded the phrase
 * before allowing funds anywhere near this wallet.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  entropyToMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { randomBytes } from "@/lib/csprng";
import { base58Encode } from "@/lib/base58";
import { toHex } from "@/lib/doubleRatchet";

/** 24 words = 256 bits of entropy. */
export const WALLET_PHRASE_WORD_COUNT = 24;

/** Standard Solana account path. Every segment is hardened. */
export const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
const HARDENED_OFFSET = 0x80000000;
const PATH_INDICES = [44, 501, 0, 0];

export interface SolanaWallet {
  /** base58 public key — the address shown to users and shared to receive. */
  address: string;
  /** 32-byte ed25519 seed, hex. SECRET. Never log, display, or transmit. */
  privateKeyHex: string;
  /** 32-byte public key, hex. */
  publicKeyHex: string;
}

interface Slip10Node {
  key: Uint8Array;
  chainCode: Uint8Array;
}

function slip10Master(seed: Uint8Array): Slip10Node {
  const I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

/**
 * SLIP-0010 hardened child derivation for ed25519.
 * data = 0x00 || parentKey || ser32(index + 2^31)
 * ed25519 supports hardened derivation only — there is no public-key
 * derivation path, which is why every index here is hardened.
 */
function slip10DeriveHardened(parent: Slip10Node, index: number): Slip10Node {
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parent.key, 1);
  const hardened = (index + HARDENED_OFFSET) >>> 0;
  data[33] = (hardened >>> 24) & 0xff;
  data[34] = (hardened >>> 16) & 0xff;
  data[35] = (hardened >>> 8) & 0xff;
  data[36] = hardened & 0xff;

  const I = hmac(sha512, parent.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

/** Derive the m/44'/501'/0'/0' ed25519 private key from a BIP39 seed. */
function deriveSolanaPrivateKey(seed: Uint8Array): Uint8Array {
  let node = slip10Master(seed);
  for (const index of PATH_INDICES) node = slip10DeriveHardened(node, index);
  return node.key;
}

/** Build the wallet (address + keys) for a private-key seed. */
function walletFromPrivateKey(priv: Uint8Array): SolanaWallet {
  const pub = ed25519.getPublicKey(priv);
  return {
    address: base58Encode(pub),
    privateKeyHex: toHex(priv),
    publicKeyHex: toHex(pub),
  };
}

/**
 * Generate a fresh 24-word wallet phrase from the app's CSPRNG chokepoint.
 *
 * Uses lib/csprng's randomBytes rather than any library default so the
 * hardened native-CSPRNG guarantee (and its boot self-test) covers key
 * generation too — a weak RNG here silently produces guessable keys.
 */
export function generateWalletPhrase(): string {
  return entropyToMnemonic(randomBytes(32), wordlist);
}

/** True if `phrase` is a well-formed 24-word BIP39 mnemonic with a valid checksum. */
export function isValidWalletPhrase(phrase: string): boolean {
  const normalized = normalizePhrase(phrase);
  if (normalized.split(" ").filter(Boolean).length !== WALLET_PHRASE_WORD_COUNT) return false;
  return validateMnemonic(normalized, wordlist);
}

export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Derive the wallet from a recovery phrase.
 * Returns null on an invalid phrase rather than throwing, so callers can show
 * a plain "invalid phrase" message.
 *
 * `passphrase` is the BIP39 25th-word extension. Empty string is the default
 * every mainstream wallet uses; a non-empty value produces a DIFFERENT wallet
 * and must be remembered as carefully as the phrase itself.
 */
export function walletFromPhrase(phrase: string, passphrase = ""): SolanaWallet | null {
  const normalized = normalizePhrase(phrase);
  if (!isValidWalletPhrase(normalized)) return null;
  try {
    const seed = mnemonicToSeedSync(normalized, passphrase);
    return walletFromPrivateKey(deriveSolanaPrivateKey(seed));
  } catch {
    return null;
  }
}

/** Rebuild the wallet from a stored 32-byte private key (hex). */
export function walletFromPrivateKeyHex(privHex: string): SolanaWallet | null {
  if (!/^[0-9a-f]{64}$/i.test(privHex)) return null;
  try {
    const priv = new Uint8Array(32);
    for (let i = 0; i < 32; i++) priv[i] = parseInt(privHex.slice(i * 2, i * 2 + 2), 16);
    return walletFromPrivateKey(priv);
  } catch {
    return null;
  }
}

/**
 * Create a brand-new wallet. Returns the phrase alongside it — the ONLY time
 * it exists outside the user's own record.
 *
 * The caller must show the phrase, confirm the user has written it down, and
 * only then persist the key. Never persist the phrase itself.
 */
export function createWallet(): { wallet: SolanaWallet; phrase: string } {
  const phrase = generateWalletPhrase();
  const wallet = walletFromPhrase(phrase);
  if (!wallet) {
    // Unreachable unless generation or derivation is broken — fail loudly
    // rather than hand back a wallet nobody can restore.
    throw new Error("Wallet generation failed: freshly generated phrase did not derive.");
  }
  return { wallet, phrase };
}
