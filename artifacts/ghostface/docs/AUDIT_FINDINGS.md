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

## #5 — *(not yet logged)*

See #2.

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
