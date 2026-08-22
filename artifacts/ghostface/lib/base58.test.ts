import test from "node:test";
import assert from "node:assert/strict";
import { base58Encode, base58Decode, isValidSolanaAddress } from "./base58.ts";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Standard Bitcoin base58 known-answer vectors. Same alphabet Solana uses.
const VECTORS: [hex: string, base58: string][] = [
  ["", ""],
  ["61", "2g"],
  ["626262", "a3gV"],
  ["636363", "aPEr"],
  ["73696d706c792061206c6f6e6720737472696e67", "2cFupjhnEsSn59qHXstmK2ffpLv2"],
  ["00eb15231dfceb60925886b67d065299925915aeb172c06647", "1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L"],
  ["516b6fcd0f", "ABnLTmg"],
  ["bf4f89001e670274dd", "3SEo3LWLoPntC"],
  ["572e4794", "3EFU7m"],
  ["ecac89cad93923c02321", "EJDM8drfXA6uyA"],
  ["10c8511e", "Rt5zm"],
  ["00000000000000000000", "1111111111"],
];

test("base58Encode matches known vectors", () => {
  for (const [hex, expected] of VECTORS) {
    assert.equal(base58Encode(hexToBytes(hex)), expected, `encode ${hex}`);
  }
});

test("base58Decode matches known vectors", () => {
  for (const [hex, b58] of VECTORS) {
    const decoded = base58Decode(b58);
    assert.notEqual(decoded, null, `decode ${b58}`);
    assert.equal(Buffer.from(decoded!).toString("hex"), hex, `decode ${b58}`);
  }
});

test("leading zero bytes survive a round trip", () => {
  // Regression guard: leading zeros are encoded as literal "1"s, not consumed
  // by the bignum conversion. Dropping one yields a different, wrong address.
  for (const zeros of [1, 2, 5, 32]) {
    const bytes = new Uint8Array(zeros); // all zero
    const encoded = base58Encode(bytes);
    assert.equal(encoded, "1".repeat(zeros));
    assert.deepEqual(base58Decode(encoded), bytes);
  }
});

test("32 zero bytes encode to the Solana System Program id", () => {
  // Real-world anchor: the System Program is 32 zero bytes.
  assert.equal(base58Encode(new Uint8Array(32)), "11111111111111111111111111111111");
});

test("random 32-byte round trips are stable", () => {
  for (let i = 0; i < 200; i++) {
    const bytes = new Uint8Array(32);
    for (let j = 0; j < 32; j++) bytes[j] = Math.floor(Math.random() * 256);
    const decoded = base58Decode(base58Encode(bytes));
    assert.deepEqual(decoded, bytes);
  }
});

test("decode rejects characters outside the alphabet", () => {
  // 0, O, I, l are deliberately absent — these are the confusable glyphs.
  for (const bad of ["0", "O", "I", "l", "abc0def", "hello!", "  ", "+/="]) {
    assert.equal(base58Decode(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test("decode rejects non-ASCII without indexing out of bounds", () => {
  assert.equal(base58Decode("héllo"), null);
  assert.equal(base58Decode("日本語"), null);
});

test("isValidSolanaAddress accepts real 32-byte addresses", () => {
  assert.equal(isValidSolanaAddress("11111111111111111111111111111111"), true);
  assert.equal(
    isValidSolanaAddress("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    true,
  );
});

test("isValidSolanaAddress rejects malformed input", () => {
  assert.equal(isValidSolanaAddress(""), false);
  assert.equal(isValidSolanaAddress("too-short"), false);
  assert.equal(isValidSolanaAddress("0".repeat(44)), false, "invalid alphabet");
  // The placeholder this whole change exists to remove.
  assert.equal(isValidSolanaAddress("GhFc3...x9mKr4"), false);
  // Valid base58, wrong length (not 32 bytes decoded).
  assert.equal(isValidSolanaAddress(base58Encode(new Uint8Array(31))), false);
  assert.equal(isValidSolanaAddress(base58Encode(new Uint8Array(33))), false);
});
