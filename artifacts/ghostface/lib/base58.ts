/**
 * Base58 (Bitcoin/Solana alphabet).
 *
 * Hand-rolled rather than pulling in a dependency — this is ~40 lines of
 * well-specified, pure, fully-testable code, and adding a package to the
 * native build for it isn't worth it (see lib/base58.test.ts for the
 * known-answer vectors).
 *
 * Solana addresses ARE base58-encoded 32-byte ed25519 public keys, so this
 * is on the path of anything that displays or accepts an address. Encoding
 * bugs here produce addresses that look plausible and silently lose funds,
 * which is why decode is strict and round-trip tested.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Reverse lookup: char code -> value, -1 for anything not in the alphabet.
// Note the deliberate omissions: 0, O, I, l are absent, which is the whole
// point of base58 — they're the glyphs humans misread.
const DECODE_MAP: readonly number[] = (() => {
  const m = new Array<number>(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) m[ALPHABET.charCodeAt(i)] = i;
  return m;
})();

/**
 * Encode bytes as base58.
 *
 * Leading zero bytes are significant — each encodes as a literal "1" rather
 * than being swallowed by the bignum conversion. A 32-byte key beginning
 * with 0x00 whose leading "1" is dropped is a different, wrong address.
 */
export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Repeated division of the whole byte array by 58, base-256 -> base-58.
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/**
 * Decode base58 back to bytes. Returns null on any invalid character rather
 * than throwing or best-effort-skipping — a mistyped address must fail
 * loudly, never decode to a different valid-looking one.
 */
export function base58Decode(str: string): Uint8Array | null {
  if (str.length === 0) return new Uint8Array(0);

  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;

  const bytes: number[] = [];
  for (let i = zeros; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const value = code < 128 ? DECODE_MAP[code] : -1;
    if (value < 0) return null;

    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
  return out;
}

/**
 * True if `str` is a syntactically valid Solana address: base58 that decodes
 * to exactly 32 bytes.
 *
 * This is a FORMAT check only. It cannot tell you the address exists, is on
 * the ed25519 curve, or belongs to anyone in particular — never treat a
 * `true` here as "safe to send funds to".
 */
export function isValidSolanaAddress(str: string): boolean {
  if (typeof str !== "string" || str.length < 32 || str.length > 44) return false;
  const decoded = base58Decode(str);
  return decoded !== null && decoded.length === 32;
}
