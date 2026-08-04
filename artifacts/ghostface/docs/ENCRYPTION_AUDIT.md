# GHOSTFACE Encryption Stack Audit — August 2026

Scope: `lib/crypto.ts`, `lib/doubleRatchet.ts`, the X3DH/PQXDH bootstrap and
Double Ratchet receive paths in `context/AppContext.tsx`, and the server prekey
endpoints (`artifacts/api-server/src/routes/prekeys.ts`).

## Current posture (what is already solid)

- **Real X3DH (3-DH/4-DH) + Double Ratchet** per the Signal spec; public-only
  prekey bundles; private keys never cross the wire (proven by
  `scripts/check-x3dh-handshake.mjs`).
- **Hybrid post-quantum**: ML-KEM-768 folded into both the handshake (PQXDH)
  and every DH ratchet step (PQ3-style continuous rekey), always combined with
  X25519 — never weaker than classical. KEM prekeys are Ed25519-signed and
  verified strictly.
- **Sealed sender with identity binding**: recovered alias is verified against
  the alias's registered identity key (`ikA`) on the bootstrap path;
  established sessions are bound by which ratchet decrypts.
- **Header binding**: the ratchet header is AEAD associated data — tampering
  with `dh`/`n`/`pn`/PQ fields breaks decryption.
- **Length hiding**: bucketed padding (256 B … 64 KiB) before encryption.
- **OPK lifecycle**: 4-DH preferred, graceful 3-DH fallback, low-watermark
  (`< 3`) client replenishment on init and after sends.
- **Self-healing**: missing IK or ML-KEM private key triggers a full rekey so
  the server never advertises a PQ prekey the device can't decapsulate.
- **Safety numbers** derived from both parties' Ed25519 identity keys (v2).

## Quick wins implemented in this audit (lib/doubleRatchet.ts)

1. **Skipped-key cache global cap** (`MAX_SKIPPED_KEYS_TOTAL = 2000`).
   `MAX_SKIP` bounded a single chain but the `MKSKIPPED` map was unbounded
   across chains — long-lived sessions with lossy delivery retained old message
   keys forever (forward-secrecy erosion at rest + unbounded storage). Oldest
   entries are now evicted first.
2. **Skipped keys deleted only after successful decryption.** Previously the
   cached key was deleted *before* the AEAD decrypt; one corrupted or tampered
   copy of a delayed message permanently destroyed the key, making the
   legitimate copy undecryptable (single-packet message-loss DoS).
3. **Canonical associated-data serialisation** (`headerAd`). AD was
   `JSON.stringify(header)`, which depends on JSON key order — a transport that
   re-encodes JSON would break decryption of honest messages. AD is now built
   with an explicit fixed field order, byte-identical to the historical sender
   order (no compatibility break).
4. **Signature-downgrade fail-closed.** A bundle carrying exactly one of
   `spkSignature` / `ikSignPublicKey` is now rejected as tampered instead of
   silently falling into the "legacy unsigned" warn path.

## Prioritized remaining improvements

### P1 — high value

- **Retire the unsigned-bundle path entirely.** The client has always uploaded
  `spkSignature`/`ikSignPublicKey`, but the server still accepts registrations
  without them and the initiator only warns when both are absent — a server (or
  MITM) can strip *both* fields and downgrade SPK authentication. Fix: server
  rejects unsigned registrations; after confirming no legacy rows remain
  (`identity_keys` with null signature), make `initSessionAliceWithHeader`
  throw when signature material is absent.
- **OPK-by-ID instead of by-value.** `X3DHHeader.opkId` carries the OPK
  *public key* and Bob trusts it from the wire. Bob should look up his stored
  private key by server-assigned ID and fail if unknown; also lets the server
  guarantee single-use consumption atomically.

### P2 — medium value

- **Periodic SPK rotation.** IK/SPK rotate only on self-heal today. Signal
  guidance: rotate the SPK on a cadence (e.g. weekly/monthly), keeping the old
  SPK private key briefly for in-flight first messages. Bounds the window in
  which a compromised SPK private key can complete handshakes.
- **PIN KDF: migrate PBKDF2 → memory-hard KDF.** 600k-iteration
  PBKDF2-SHA256 meets OWASP but is GPU-friendly; scrypt (available in
  `@noble/hashes`) is a drop-in with a salt-versioned migration on next PIN
  entry.
- **Session re-handshake ("session healing") trigger.** There is no way to
  force a fresh X3DH once a session de-syncs other than validation failure on
  load. Add an explicit re-handshake path when N consecutive decrypts fail.

### P3 — lower value / accepted tradeoffs

- **Safety number entropy**: 6×5 digits ≈ 50 bits vs Signal's 60 (6×5 per
  side, 12 groups). Could extend to 12 groups; UI tradeoff.
- **Key zeroization**: JS strings/GC make true zeroization impossible;
  hex-encoded keys linger in memory. Mitigated by device-level encryption at
  rest; not fixable without native modules.
- **Legacy unpadded-ciphertext fallback** in `unpadPlaintext` is a heuristic;
  once all pre-padding messages age out, drop the fallback and require the
  length frame.
- **`generateSafetyNumber` (alias-based)** is legacy and non-cryptographic;
  remove once no call sites remain.

## Verification

- `check:handshake` — two-party X3DH/PQXDH + multi-round ratchet, private-key
  leak scan (must pass after any change here).
- `typecheck`, `ghostface-lint` workflows.
