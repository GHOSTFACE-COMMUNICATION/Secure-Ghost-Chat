# Crypto audit findings

Tracking doc for findings from an external crypto audit (source: a separate
Claude.ai conversation, per the person driving this — not derived from an
in-repo review). Each finding gets its own PR; this file tracks status only.

## #1 — Canonical AEAD associated-data encoding — **RESOLVED**

**Finding**: `ratchetEncrypt`/`ratchetDecrypt` authenticated the message
header as AEAD associated data using `strToBytes(JSON.stringify(header))` —
not a canonical, fixed binary encoding. Not exploitable today (single JS
implementation, deterministic in practice), but unsound as a long-term
invariant: no fixed field order guarantee, optional fields omitted rather
than explicitly framed, no interop guarantee for a future second
implementation, no protocol version carried in the AD itself.

**Fix**: `encodeHeaderAD()` in `lib/doubleRatchet.ts` — a fixed,
self-describing binary layout (magic bytes, protocol version, explicit
field IDs, fixed-width big-endian integers, raw bytes instead of hex
strings for key material, explicit presence+length framing for optional
fields, never omission). One function, used identically by both
`ratchetEncrypt` and `ratchetDecrypt`. Full layout and rationale in
`docs/PROTOCOL.md`. Test coverage in `lib/doubleRatchet.test.ts` (known-answer,
determinism, field-sensitivity, tamper-detection, round-trip with and
without PQ fields, integer-range validation, hex strictness).

## #2 — *(not yet logged)*

Not included in the request that produced this file — the four bullets for
findings #2–#5 didn't come through in the message that asked for this doc
(it ended right after "fold in #2-#5 as follows:" with no bullets attached).
Paste them and I'll fill these in rather than leaving placeholders.

## #3 — *(not yet logged)*

See #2.

## #4 — *(not yet logged)*

See #2.

## #5 — CSPRNG wiring not verified for release builds — **RESOLVED**

**Finding**: key generation, nonces, and ML-KEM encapsulation randomness
must come from a true OS CSPRNG in production bundles, not a JS
polyfill/fallback (e.g. a `Math.random`-backed shim, or a dev-only global
that's absent in release) — but nothing in the app verified that at
runtime, and the actual wiring had never been traced end to end.

**Trace**: `index.js` installs `react-native-get-random-values` as its
first statement (before `expo-router/entry`), backing
`globalThis.crypto.getRandomValues` with `SecRandomCopyBytes` on iOS and
`java.security.SecureRandom` on Android. `@noble/hashes/utils.js`'s
`randomBytes()` reads that global and throws if it's absent — no silent
fallback at that layer — and `@noble/post-quantum/utils.js` (used by
`ml_kem768`'s `encapsulate`) re-exports that exact same function, so ML-KEM
encapsulation, DH ratchet keys, AEAD nonces, and storage/blob keys all
funnel through one identical call. The one real gap: `react-native-get-random-values`
itself has a dev-only fallback (`isRemoteDebuggingInChrome()` →
`Math.random()`-backed shim, `console.warn` only, never throws) that
nothing in the app detected or asserted against.

**Fix**: `lib/csprng.ts` — the single approved randomness source. Positively
detects the native module (`NativeModules.RNGetRandomValues`/`ExpoRandom`/
`ExpoCrypto`, mirroring `react-native-get-random-values`'s own branching)
before trusting the global at all, and throws `InsecureCsprngError` instead
of ever drawing from a non-native fallback. All five direct call sites
(`context/AppContext.tsx`, `lib/secureStorage.ts`, `lib/blobStore.ts`,
`lib/crypto.ts`, `lib/doubleRatchet.ts`) now import `randomBytes` from this
module instead of `@noble/hashes/utils.js` directly; `lib/crypto.ts`'s four
`managedNonce(chacha20poly1305)` call sites now pass it explicitly too, so
even ChaCha20-Poly1305's auto-nonce generation (previously defaulting to
`@noble/ciphers`'s own independent `randomBytes`) routes through the same
chokepoint. `index.js` calls `assertCsprngHealthy()` — generates 32 bytes
twice, asserts non-equal, asserts not all-zero, asserts native backing —
immediately after the polyfill import and before `expo-router/entry`, so
no code path can create identity/key material without this having already
passed; it fails closed (throws, refuses to boot) rather than continuing on
unverified randomness. Test coverage in `lib/csprng.test.ts` (native-backing
detection incl. alternate native surfaces, throw-not-fallback behavior with
native backing absent, self-test pass/fail-closed paths).

**Native backing, explicitly**: iOS release and Android release both go
through `react-native-get-random-values`'s native module —
`SecRandomCopyBytes(kSecRandomDefault, ...)` on iOS,
`java.security.SecureRandom` on Android — never the JS fallback, which is
unreachable when `__DEV__` is false.

## #6 — No associated data on `secureStorage.ts` / `crypto.ts` sealed envelopes — **OPEN**

**Finding**: `lib/secureStorage.ts`'s `encryptForStorage`/`decryptFromStorage`
(AsyncStorage-at-rest encryption) and `lib/crypto.ts`'s `encryptMessage`/
`decryptMessage` and `sealedEncryptMessage`/`sealedDecryptMessage` all call
`managedNonce(chacha20poly1305)` with **no associated-data argument at
all** — zero context/domain binding on those ciphertexts, unlike the
Double Ratchet's header-bound AD. Logged during finding #1's diagnosis
(Step 1c/d of that investigation).

**Status**: open, deferred to a separate PR — not touched by the finding #1
change. No design proposed yet.
