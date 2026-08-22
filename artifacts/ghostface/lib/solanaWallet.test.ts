import test from "node:test";
import assert from "node:assert/strict";
import {
  createWallet,
  generateWalletPhrase,
  isValidWalletPhrase,
  walletFromPhrase,
  walletFromPrivateKeyHex,
  normalizePhrase,
  WALLET_PHRASE_WORD_COUNT,
  SOLANA_DERIVATION_PATH,
} from "./solanaWallet.ts";
import { isValidSolanaAddress, base58Decode } from "./base58.ts";

// Standard all-zeros-entropy BIP39 mnemonic. Used here only as a fixed input
// for determinism checks — NOT as an expected-address vector (see the
// cross-wallet note at the bottom of this file).
const FIXED_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon abandon abandon abandon abandon art";

test("uses the standard Solana derivation path", () => {
  // Guard against a well-meaning edit silently changing the path — that would
  // move every user's funds to a different address on the next release.
  assert.equal(SOLANA_DERIVATION_PATH, "m/44'/501'/0'/0'");
});

test("generated phrases are 24 valid words", () => {
  for (let i = 0; i < 20; i++) {
    const phrase = generateWalletPhrase();
    assert.equal(phrase.split(" ").length, WALLET_PHRASE_WORD_COUNT);
    assert.equal(isValidWalletPhrase(phrase), true);
  }
});

test("generated phrases are distinct", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) seen.add(generateWalletPhrase());
  assert.equal(seen.size, 50, "CSPRNG produced a duplicate phrase");
});

test("derivation is deterministic", () => {
  const a = walletFromPhrase(FIXED_PHRASE);
  const b = walletFromPhrase(FIXED_PHRASE);
  assert.notEqual(a, null);
  assert.deepEqual(a, b);
});

test("derived address is a valid 32-byte Solana address", () => {
  const w = walletFromPhrase(FIXED_PHRASE)!;
  assert.equal(isValidSolanaAddress(w.address), true);
  assert.equal(base58Decode(w.address)!.length, 32);
  assert.match(w.privateKeyHex, /^[0-9a-f]{64}$/);
  assert.match(w.publicKeyHex, /^[0-9a-f]{64}$/);
});

test("public key hex and address encode the same bytes", () => {
  const w = walletFromPhrase(FIXED_PHRASE)!;
  assert.equal(Buffer.from(base58Decode(w.address)!).toString("hex"), w.publicKeyHex);
});

test("different phrases derive different wallets", () => {
  const a = createWallet().wallet;
  const b = createWallet().wallet;
  assert.notEqual(a.address, b.address);
  assert.notEqual(a.privateKeyHex, b.privateKeyHex);
});

test("a BIP39 passphrase produces a different wallet", () => {
  const plain = walletFromPhrase(FIXED_PHRASE, "")!;
  const withPass = walletFromPhrase(FIXED_PHRASE, "hunter2")!;
  assert.notEqual(plain.address, withPass.address);
});

test("phrase normalisation tolerates case and whitespace", () => {
  const messy = `  ${FIXED_PHRASE.toUpperCase().replace(/ /g, "   ")}  `;
  assert.equal(normalizePhrase(messy), FIXED_PHRASE);
  assert.deepEqual(walletFromPhrase(messy), walletFromPhrase(FIXED_PHRASE));
});

test("invalid phrases are rejected, not guessed at", () => {
  const bad = [
    "",
    "not a real phrase",
    FIXED_PHRASE.split(" ").slice(0, 12).join(" "), // wrong word count
    FIXED_PHRASE.replace(/art$/, "abandon"),        // bad checksum
    FIXED_PHRASE.replace(/^abandon/, "zzzzzz"),     // not in wordlist
  ];
  for (const phrase of bad) {
    assert.equal(isValidWalletPhrase(phrase), false, `should reject: ${phrase.slice(0, 30)}`);
    assert.equal(walletFromPhrase(phrase), null, `should not derive: ${phrase.slice(0, 30)}`);
  }
});

test("createWallet round-trips through its own phrase", () => {
  // The property that matters most: a user who writes down the phrase we
  // showed them gets this exact wallet back.
  for (let i = 0; i < 10; i++) {
    const { wallet, phrase } = createWallet();
    assert.deepEqual(walletFromPhrase(phrase), wallet);
  }
});

test("wallet rebuilds from a stored private key", () => {
  const { wallet } = createWallet();
  assert.deepEqual(walletFromPrivateKeyHex(wallet.privateKeyHex), wallet);
});

test("walletFromPrivateKeyHex rejects malformed keys", () => {
  for (const bad of ["", "abc", "z".repeat(64), "ab".repeat(31), "ab".repeat(33)]) {
    assert.equal(walletFromPrivateKeyHex(bad), null, `should reject ${bad.slice(0, 12)}`);
  }
});

test("the placeholder address is not a valid address", () => {
  // The bug this module exists to fix.
  assert.equal(isValidSolanaAddress("GhFc3...x9mKr4"), false);
});

/*
 * NOT COVERED HERE — must be verified manually before this wallet holds funds:
 *
 *   Cross-wallet compatibility. These tests prove derivation is correct,
 *   deterministic, and self-consistent, but they cannot prove it matches
 *   what Phantom/Solflare compute, because that needs an external
 *   implementation to compare against. Asserting an address vector from
 *   memory would be worse than not asserting one.
 *
 *   Do this before any real funds: generate a phrase, import it into Phantom
 *   (or solflare), and confirm the address matches this module's output
 *   exactly. If it does not, the phrase is NOT a real escape hatch and the
 *   derivation must be fixed before shipping.
 */
