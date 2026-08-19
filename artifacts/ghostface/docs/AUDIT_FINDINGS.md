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

## #3 — SPK classical silent-downgrade in the handshake — **RESOLVED**

**Finding**: when a peer's prekey bundle lacked post-quantum material (no
ML-KEM prekey/signature), X3DH/PQXDH silently proceeded classical-only —
no error, no policy gate, no record that the session was PQ-less. An
attacker able to strip the PQ fields from a bundle in transit, or a
malicious server, could downgrade every new session to classical without
anyone noticing.

**Trace**: `GET /prekeys/:userId/bundle` is unauthenticated by design and
returns whatever's in the DB row with no integrity protection beyond the
client-side Ed25519 signature check. `initSessionAliceWithHeader` gated the
entire PQXDH block on `if (bundle.pqkemPublicKey)`; when the field was
simply absent (not present-but-invalid), the block never ran, `pqEnabled`
stayed `false`, and `SK` was computed classical-only with no signal —
`initSessionBobFromHeader` had the same shape, gated on `x3dhHeader.pqkemCt`.
The signature mechanism itself was already sound (`verifyKemPreKey` is
`ed25519.verify` over the KEM pubkey bytes, signed at registration by the
same `ikSignPriv` that signs the SPK — a substituted key fails verification)
— the gap was absence-handling only, not the signature check. A dedicated
session-level PQ flag didn't exist either: `RatchetState.pq` was internal,
per-side, and the one place it was surfaced (`app/chat/[id].tsx`'s chat-info
panel) read `conv.drSession.alice.pq` directly rather than a documented
session API.

**Fix**: `export const REQUIRE_PQ = true` in `lib/doubleRatchet.ts` (no env
override — this app has no legitimate classical peers). Both
`initSessionAliceWithHeader` (bundle missing `pqkemPublicKey`) and
`initSessionBobFromHeader` (header missing `pqkemCt`) now throw
`PqDowngradeError` immediately on absence, before any of the existing
present-but-invalid checks run — those checks are unchanged. `DRSession`
gained an explicit `pqEstablished: boolean`, set from the real `pqEnabled`
result on both the initiator and responder side; `app/chat/[id].tsx`'s
header subtitle and chat-info panel (protocol/key-agreement/quantum-
resistance rows) now read `pqEstablished` instead of reaching into
`.alice.pq`, and the classical branch — unreachable today with `REQUIRE_PQ`
true, kept as a safety net — renders in `colors.warning` with an explicit
"⚠ CLASSICAL ONLY" label instead of a muted, easy-to-miss one.
`PqDowngradeError` is surfaced distinctly from generic handshake failure:
`addConversation`'s catch (the initiator's synchronous "add contact" path)
returns `{ ok: false, error: "pq_downgrade" }`, mapped in
`app/(tabs)/messages.tsx` to a specific `Alert.alert` explaining the refusal.
The responder-side (incoming-first-message) catch gets a distinct
placeholder message text too, though it's worth being explicit that this
is defense-in-depth rather than the primary signal: `PqDowngradeError`
there throws before `ratchetDecrypt` ever runs, i.e. before sealed-sender
recovers `senderAlias`, and current clients never put `from` on a `"msg"`
send — so for any real current-version peer it still hits the existing
`if (!senderAlias) return` early-out, same as every other early Bob-side
failure today. That's an existing sealed-sender architecture constraint,
not a regression introduced here; the initiator side is what actually
surfaces this rejection to a user in practice.

**Tests** in `lib/doubleRatchet.test.ts`: PQ-present bundle succeeds and
reports `pqEstablished: true` (both sides); `pqkemPublicKey` entirely
absent is rejected with `PqDowngradeError`; stripping only the pubkey while
leaving `pqkemSignature` intact is still rejected (partial strip gives an
attacker nothing); a tampered/substituted PQ pubkey fails signature
verification rather than being silently accepted (stripping-with-signature-
intact is impossible by construction); `initSessionBobFromHeader` rejects a
header with `pqkemCt` absent. The two pre-existing ratchet-mechanics tests
that exercised a classical (`pq: false`) session now simulate that state
correctly — deriving real key material via a genuine PQ handshake and then
stripping the PQ bookkeeping fields off the already-derived state, rather
than constructing a classical session via the now-blocked policy path —
since that still-real scenario is a session persisted before this policy
existed, not one that can be newly created classical today.

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

## #6 — No associated data on `secureStorage.ts` / `crypto.ts` sealed envelopes — **RESOLVED**

**Finding**: `lib/secureStorage.ts`'s `encryptForStorage`/`decryptFromStorage`
(AsyncStorage-at-rest encryption) and `lib/crypto.ts`'s `encryptMessage`/
`decryptMessage` and `sealedEncryptMessage`/`sealedDecryptMessage` all call
`managedNonce(chacha20poly1305)` with **no associated-data argument at
all** — zero context/domain binding on those ciphertexts, unlike the
Double Ratchet's header-bound AD. Logged during finding #1's diagnosis
(Step 1c/d of that investigation).

**Trace**: `lib/secureStorage.ts` encrypts two AsyncStorage slots
(`ghostface_conversations` — including serialized Double Ratchet session
state — and `ghostface_call_history`) under one shared master key; without
AD, a ciphertext valid for one slot is also a valid, tag-passing ciphertext
if substituted into the other. `lib/crypto.ts`'s AEAD functions
(`encryptMessage`/`decryptMessage`/`sealedEncryptMessage`/
`sealedDecryptMessage`) turned out to have **zero call sites anywhere in
the app** — verified by grepping every `.ts`/`.tsx` file — so the fix there
is prophylactic hygiene, not a patch for a live path.

**Fix**: `encodeStorageAD()` in `lib/secureStorage.ts` binds the specific
AsyncStorage key name into the AD (magic `"GFSS"`, version, length-prefixed
key id), so a blob only decrypts under the slot it was encrypted for.
`encodeMessageAD()` in `lib/crypto.ts` binds a `msg_type` byte (magic
`"GFCM"`, version, plain-vs-sealed) so a plain ciphertext can't be
misinterpreted as a sealed envelope (or vice versa) under a shared key.
Full layouts and rationale in `docs/PROTOCOL.md`.

**Migration**: real TestFlight data exists (builds 70/71), so this was not
a hard cutover for `secureStorage.ts`. `readEncryptedString` now tries three
tiers in order — current AD-bound format, legacy no-AD format, legacy
pre-encryption-at-rest plaintext — and on a successful legacy-tier decrypt,
immediately re-encrypts and re-writes in the current format (not deferred
to the next natural write), logging a `console.warn` marker per migration.
**Follow-up**: delete `decryptFromStorageLegacyNoAD` *and* the
unconditional plaintext-tier fallback from `readEncryptedString` together —
once the no-AD tier is gone, an unrecognized value should be a hard error,
not silently treated as legacy plaintext. The `console.warn` markers are
device-local logs only, not aggregated telemetry — nothing collects them
off-device — so there's no way to observe "no installs are hitting this
tier anymore." The real removal criterion is time-based: after a release
or two past this fix shipping, once any device that had pre-#6 local data
has almost certainly already read (and thus migrated) it. `crypto.ts`'s
functions had zero existing callers, so no migration was needed there —
hard cutover.

**Tests**: `lib/secureStorage.test.ts` (known-answer AD, keyId-sensitivity,
round-trip, cross-keyId rejection, both legacy-tier migrations including
the immediate-rewrite behavior, missing-key read) and
`lib/crypto.test.ts` (known-answer AD, round-trip plain and sealed,
cross-type rejection in both directions, tamper detection). New in-memory
test stubs for `@react-native-async-storage/async-storage` and
`expo-secure-store` (`scripts/asyncstorage-test-stub.mjs`,
`scripts/securestore-test-stub.mjs`, wired into
`scripts/rn-test-loader.mjs`) — `secureStorage.ts`'s native dependencies
couldn't otherwise be imported under `node --test`.

## #7 — No associated data on `EncryptionTools.tsx`'s Stealth encryption — **RESOLVED**

**Finding**: `components/EncryptionTools.tsx`'s own `ghostEncrypt`/
`ghostDecrypt` (the Stealth tool's encrypt-then-hide implementation) use
the same `managedNonce(chacha20poly1305)` pattern as `secureStorage.ts`/
`crypto.ts` had, with no AD — and unlike `crypto.ts`'s functions, this one
**is** live (wired into the Tools page). Found while tracing every AEAD
call site during finding #6's diagnosis; explicitly out of scope for that
finding, not touched there.

**Why this needed a different shape of fix than #6**: #6's storage blobs
are written and read by the app itself — a format change can self-heal in
place on next read. Stealth's output is a string the user copies out of the
app and shares elsewhere (a message, a screenshot, a notes app) — the app
never controls where it ends up and can't rewrite it later. So unlike #6's
temporary, self-healing migration tiers, this fix keeps a **permanent**
decode-side branch for the old format, with no removal criterion at all
(there's no telemetry, device-local or otherwise, that could ever show a
pre-fix payload won't be pasted in tomorrow) — dropping it later would be a
deliberate product decision, not something inferred from usage.

**Fix**: `encodeStealthAD()` in the new `lib/stealthCrypto.ts` (magic
`"GFST"`, version — no header fields to bind, this format has none beyond
the salt, which tampering-detection already covers since it's KDF input).
The payload's own version prefix now doubles as the decode dispatch key:
`ghostEncrypt` always produces `"GHX3::"` (new, AD-bound) going forward;
`ghostDecrypt` decodes `"GHX3::"` via the new AD-bound path, `"GHX2::"` via
the untouched legacy no-AD path, and returns `null` cleanly (no throw) for
any other or missing prefix. `ghostEncrypt`/`ghostDecrypt`/`stealthEncode`/
`stealthDecode` were extracted out of `components/EncryptionTools.tsx` into
`lib/stealthCrypto.ts` (pure logic move, no behavior change beyond the AD
fix) so they're unit-testable under `node:test` — the component file pulls
in React Native/Expo UI modules unrelated to this logic. Full layout and
rationale in `docs/PROTOCOL.md`.

**Tests**: `lib/stealthCrypto.test.ts` — known-answer AD, GHX3 prefix on
new output, round-trip (including blank/default passphrase), wrong-
passphrase rejection, tamper detection, clean-null on unrecognized/missing
prefix, legacy GHX2 payloads still decrypt, GHX2 and GHX3 ciphertexts for
identical input differ and each only decodes via its own branch, and a
full encrypt→hide→reveal→decrypt pipeline test.

## #8 — Stealth tool's blank-passphrase fallback is a well-known default key — **RESOLVED**

**Finding**: `ghostEncrypt`/`ghostDecrypt` (`lib/stealthCrypto.ts`, formerly
in `components/EncryptionTools.tsx`) derived the key from
`passphrase || "GHOSTFACE"` — if the user left the optional "SECRET KEY"
field blank, every such message was encrypted under the same fixed
passphrase, `"GHOSTFACE"`, visible to anyone who reads the source (or just
guesses it, given the UI's own placeholder text said "Blank = default
key"). Against an attacker who tries that literal string, confidentiality
for a blank-key message reduced to whatever the zero-width steganography
layer alone provides — none, once the hidden bits are found. Noticed while
implementing finding #7's AD fix; not an AD/associated-data problem so left
out of that fix's scope.

**Fix**: `ghostEncrypt` now requires a non-empty, trimmed passphrase —
throws if given `""` or whitespace-only, as a backstop, and the Stealth
UI's "HIDE MESSAGE" button is disabled with inline validation
("A passphrase is required to encrypt.") until one is entered, so this
should never actually reach the throw in normal use. Decrypt-side key
derivation is **unchanged** — `passphrase || "GHOSTFACE"` still tries the
old default forever, same reasoning as #7's permanent GHX2 branch: messages
already hidden under the old blank-key behavior can't be un-hidden or
rewritten, so revealing them has to keep working. `ghostDecrypt`'s return
shape changed from `string | null` to `{ plaintext, usedDefaultPassphrase } | null`
so the UI can tell the two cases apart; on a successful reveal where
`usedDefaultPassphrase` is true, the Stealth screen now shows **"HIDDEN
WITH THE DEFAULT KEY — anyone with this app can reveal it"** under the
decrypted message — it was genuinely encrypted, just under a key anyone
running this app already knows, so the warning names who can read it
rather than implying no encryption happened.

**Tests**: `lib/stealthCrypto.test.ts` — `ghostEncrypt` throws on empty and
whitespace-only passphrases; a real passphrase (including the literal
string `"GHOSTFACE"` typed deliberately) round-trips with
`usedDefaultPassphrase: false`; a payload encrypted under the default key
(constructed directly in the test, since `ghostEncrypt` itself now refuses
to produce one) decrypts with `usedDefaultPassphrase: true`, for both the
current AD-bound format and the legacy GHX2 format.
