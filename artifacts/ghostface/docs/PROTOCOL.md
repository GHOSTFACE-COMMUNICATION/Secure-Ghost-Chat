# Double Ratchet AEAD associated data — canonical encoding

This document specifies the on-the-wire-equivalent binary layout used as
AEAD associated data (AD) for every Double Ratchet message, and why it
exists. Implemented in `lib/doubleRatchet.ts` as `encodeHeaderAD()`.

## Why

`ratchetEncrypt`/`ratchetDecrypt` pass the message header to the AEAD cipher
as associated data, cryptographically binding the header to the ciphertext —
tampering with either causes decryption to throw (Signal's standard DR
binding step; see `aeadEncrypt`/`aeadDecrypt` in `lib/doubleRatchet.ts`).

Prior to this change, the AD was `strToBytes(JSON.stringify(header))`. This
is **not currently exploitable** — GHOSTFACE has exactly one implementation
of this protocol, in this one file, and `JSON.stringify` on a plain object
with a small fixed key set (`dh`, `n`, `pn`, optional `pqPub`/`pqCt`) is
deterministic in practice across repeated calls in the same JS engine. But it
is not a *sound* long-term invariant:

- **No fixed field order guarantee.** `JSON.stringify` key order follows
  insertion order for string keys — reliable today because the header is
  always built the same way, but a single incidental refactor (an object
  spread that reconstructs the header, a field added out of order) silently
  changes the serialized bytes for logically-identical headers.
- **Optional fields are omitted, not framed.** `pqPub`/`pqCt` simply don't
  appear as keys when absent, rather than being explicitly represented as
  empty. Two different absent/present combinations produce differently
  *shaped* JSON, which is fine for uniqueness today but has no structural
  guarantee against future ambiguity as the header grows.
- **No interop guarantee.** If GHOSTFACE ever ships a second implementation
  of this protocol (a native rewrite, a server-side verifier, a different
  client), JSON key-order and number formatting are not something to build
  cross-language interop on.
- **No protocol version in the AD.** The wire format could change without
  the AD reflecting that, so an old and new header shape could theoretically
  produce ambiguous or colliding AD given a large enough future field set.

This is audit finding #1 (see `docs/AUDIT_FINDINGS.md`) — a hygiene and
future-proofing fix, not a patch for an active vulnerability.

## Layout

All integers big-endian. Every field is always present in the encoded
output — the optional PQ fields are **never omitted**, only zero-length.

```
offset  size  content
0       4     magic = "GFDR" (0x47 0x46 0x44 0x52)
4       1     protocol_version = 0x01
5       1     field_count = 0x05
6       1     field_id 0x01 (DH)
7       32    dh — raw X25519 public key bytes (mandatory, fixed width)
39      1     field_id 0x02 (N)
40      4     n — u32BE (message index in this sending chain)
44      1     field_id 0x03 (PN)
45      4     pn — u32BE (previous sending chain length)
49      1     field_id 0x04 (PQPUB)
50      1     presence: 0x00 (absent) or 0x01 (present)
51      2     length, u16BE (0x0000 if absent)
53      len   pqPub — raw ML-KEM-768 public key bytes (0 bytes if absent, 1184 if present)
...     1     field_id 0x05 (PQCT)
...     1     presence: 0x00 (absent) or 0x01 (present)
...     2     length, u16BE (0x0000 if absent)
...     len   pqCt — raw ML-KEM ciphertext bytes (0 bytes if absent, 1088 if present)
```

Total size: 57 bytes with no PQ fields, 2329 bytes with both PQ fields
present (`PQKEM_PUBLIC_BYTES` + `PQKEM_CIPHERTEXT_BYTES`, defined in
`lib/doubleRatchet.ts`).

Design choices:

- **Fixed field order, one function.** `encodeHeaderAD(header)` is the only
  place this layout is produced, called identically from `ratchetEncrypt`
  and `ratchetDecrypt` — there is no second implementation to drift out of
  sync with.
- **Every field carries its own `field_id` byte**, including the
  fixed-width mandatory fields (`dh`, `n`, `pn`). This is redundant against
  buffer corruption in the narrow sense (the field order is fixed, so the ID
  is always predictable) but makes the layout self-checking: a corrupted or
  misordered buffer is caught structurally rather than only surfacing later
  as an opaque AEAD tag mismatch.
- **`dh`/`pqPub`/`pqCt` are raw bytes, not hex strings.** The wire
  representation (`RatchetHeader`) stores these as lowercase hex, but the AD
  encodes the *decoded* bytes — a hex string and its decoded bytes are the
  same key material, but two different byte sequences as far as an AEAD
  cipher is concerned, so encoding the string form would just move the
  ambiguity rather than remove it.
- **Strict hex decoding.** A dedicated `strictHexToBytes()` (distinct from
  the general-purpose, lenient `fromHex()` used elsewhere in this file)
  requires exact expected length and strictly lowercase `[0-9a-f]`.
  Uppercase or mixed-case hex is valid hex representing the *same* bytes —
  accepting it as equivalent input is exactly the kind of encoding
  ambiguity this fix exists to remove, so it's rejected outright rather than
  normalized.
- **`n`/`pn` are fixed-width `u32BE`, never variable-length.** Encoding
  throws on a non-integer, negative, or out-of-`u32`-range value rather than
  silently truncating or wrapping.
- **`pqPub`/`pqCt` use presence + explicit length framing, never
  omission.** A field that is logically absent is encoded as
  `field_id || 0x00 || 0x0000` — structurally present, zero-length —
  rather than not written at all. This removes any ambiguity between "this
  header has no PQ fields" and "the parser skipped past where they would
  have been."
- **Decode-side is the same code as encode-side, by construction.**
  `ratchetDecrypt` calls `encodeHeaderAD` on the wire-received (untrusted)
  header before it's ever used as AD — every field is validated (hex
  shape, integer range) before any byte is written, so a malformed header
  throws immediately rather than producing a plausible-looking-but-wrong AD
  buffer that only fails later at the MAC check. `magic`/`protocol_version`/
  `field_count` are written as fixed constants (never read from caller
  input), and a trailing self-check asserts the output actually starts with
  them — belt-and-suspenders documentation of that invariant at the one
  chokepoint both directions funnel through, since there is no separate
  wire-transmitted copy of those three fields to independently validate
  against in the current protocol.

## Out of scope for this change

- `lib/secureStorage.ts` and `lib/crypto.ts`'s `encryptMessage`/
  `sealedEncryptMessage` use AEAD with **no associated data at all** — a
  separate, distinct finding (audit finding #6, see
  `docs/AUDIT_FINDINGS.md`), not touched here.
- The general-purpose `fromHex()`/`toHex()` helpers used throughout
  `lib/doubleRatchet.ts` remain lenient (silently produce `NaN` on invalid
  hex via `parseInt`). Only the new AD-specific `strictHexToBytes()` is
  strict. Hardening the shared helper is a broader change affecting many
  call sites and was left out of this fix's scope.
