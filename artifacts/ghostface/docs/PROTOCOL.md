# AEAD associated data — canonical encodings

This document specifies the AD layouts used across GHOSTFACE's AEAD call
sites, and why each exists. Three independent schemes, one per module —
they don't need to interoperate with each other, only be internally
self-consistent and unambiguous.

## Double Ratchet (`lib/doubleRatchet.ts`)

The on-the-wire-equivalent binary layout used as AEAD associated data for
every Double Ratchet message. Implemented as `encodeHeaderAD()`.

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

## Storage-at-rest (`lib/secureStorage.ts`)

`encryptForStorage`/`decryptFromStorage` encrypt the AsyncStorage-persisted
app-state blobs (conversations — including serialized Double Ratchet
session state — and call history) under one master key held in
SecureStore. Implemented as `encodeStorageAD()`.

### Why

Both AsyncStorage slots (`ghostface_conversations`, `ghostface_call_history`,
more possibly later) share the same master key. Without AD, a ciphertext
that decrypts validly under one slot also decrypts validly if substituted
into another — same key, same cipher, nothing structural to tell them
apart. That's a real risk on a jailbroken/rooted device, from a
corrupted/malicious backup restore, or from an app bug that writes to the
wrong AsyncStorage key: the swap succeeds silently (valid Poly1305 tag)
instead of failing at decrypt time. This is audit finding #6.

### Layout

```
offset  size  content
0       4     magic = "GFSS" (0x47 0x46 0x53 0x53)
4       1     protocol_version = 0x01
5       1     key_id_len (bytes)
6       len   key_id — UTF-8 bytes of the AsyncStorage key string
```

Binds the specific AsyncStorage key name into the tag, so a blob only
decrypts under the slot it was actually encrypted for.

### What this does not cover

- **Replay.** An attacker with raw AsyncStorage write access can still
  overwrite a slot's current ciphertext with an *older* valid ciphertext for
  that same slot (e.g. from a stale local backup) — AD stops cross-slot type
  confusion, not replay within a slot. Would need a monotonic counter or
  hash chain to close; out of scope here.
- **Master-key exfiltration.** If the SecureStore-held master key itself is
  extracted (e.g. via jailbreak), AD binding doesn't help — it's not a
  substitute for key secrecy.

### Migration — real TestFlight data exists (builds 70/71)

Existing installs have local data encrypted the old (no-AD) way. Hard
cutover would make `decryptFromStorage` throw on that data, which — absent
a fallback — would fall through to `readEncryptedString`'s pre-existing
"treat raw as legacy plaintext" branch and try to `JSON.parse` a hex
string, silently wiping conversations/call history on load. Instead,
`readEncryptedString` tries three tiers in order: current AD-bound format →
legacy no-AD format (same key, same cipher, no AD — decrypts fine) →
legacy pre-encryption-at-rest plaintext (predates this file entirely, kept
from before finding #6). A successful decrypt on either legacy tier
**immediately** re-encrypts and re-writes the value in the current format
(not deferred to the next natural write), and logs a `console.warn` marker
naming the key and tier hit.

**Follow-up, tracked in `docs/AUDIT_FINDINGS.md`**: delete
`decryptFromStorageLegacyNoAD` *and* the unconditional plaintext-tier
fallback from `readEncryptedString` together — once the no-AD tier is gone,
an unrecognized value should be a hard error, not silently treated as
legacy plaintext. The `console.warn` markers are device-local only (nothing
aggregates them off-device), so removal isn't gated on observed telemetry —
it's time-based: after a release or two past this fix shipping, once any
device that had pre-#6 local data has almost certainly already read (and
thus migrated) it.

## Message encryption (`lib/crypto.ts`)

`encryptMessage`/`decryptMessage` and `sealedEncryptMessage`/
`sealedDecryptMessage` — currently **unused** anywhere in the app (verified
by grepping every `.ts`/`.tsx` file; `AppContext.tsx` only imports
`generateSafetyNumber` from this module, `EncryptionTools.tsx` only imports
`deriveKeyFromPin`/`generateSalt`). Implemented as `encodeMessageAD()`.
Fixed here as hygiene ahead of whoever wires these up next, not as a patch
for a live exploit path — there is none today since nothing calls them.

### Layout

```
offset  size  content
0       4     magic = "GFCM" (0x47 0x46 0x43 0x4d)
4       1     protocol_version = 0x01
5       1     msg_type (0x01 = plain, 0x02 = sealed)
```

`EncryptedMessage` and `SealedMessage` share a ciphertext shape and could
plausibly be encrypted under the same key by a future caller. Binding
`msg_type` means a plain ciphertext fed to `sealedDecryptMessage` (or vice
versa) fails cleanly at the AEAD tag check, instead of `JSON.parse`-ing
garbage or — worse — something plausible-looking.

Hard cutover, no migration path needed: zero callers today means zero data
encrypted in the old (no-AD) format to migrate.

## Out of scope

- `components/EncryptionTools.tsx`'s own `ghostEncrypt`/`ghostDecrypt` (the
  Stealth tool) use the same `managedNonce(chacha20poly1305)` pattern with
  no AD, and this one **is** live. Not part of finding #6 — logged
  separately as audit finding #7 in `docs/AUDIT_FINDINGS.md`, no design
  proposed yet.
- The general-purpose `fromHex()`/`toHex()` helpers used throughout
  `lib/doubleRatchet.ts` and `lib/secureStorage.ts` remain lenient (silently
  produce `NaN` on invalid hex via `parseInt`). Only the AD-specific strict
  decoders (`strictHexToBytes()` in `doubleRatchet.ts`) reject malformed
  hex. Hardening the shared helpers is a broader change affecting many call
  sites and was left out of scope for both AD fixes.
