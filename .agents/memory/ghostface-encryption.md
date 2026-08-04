---
name: GHOSTFACE real E2E encryption
description: Invariants for the real (non-simulated) X3DH + Double Ratchet messaging path; what must never regress.
---

# Real end-to-end encryption invariants

GHOSTFACE messaging is real E2E only — there is NO demo/deterministic/simulated key path. If you ever find yourself fabricating a session or deriving a key from a conversation id/alias, stop: that was deliberately removed.

**Rules:**
- A `PreKeyBundle` is PUBLIC-KEYS-ONLY. Private keys (IK/SPK/OPK) never leave the device and never travel over the wire. The X3DH header (`ikA`/`ekA`/`opkId`) is public material only.
- Only real X3DH bootstrap exists: `initSessionAliceWithHeader` (initiator) and `initSessionBobFromHeader` (responder). Convention: `drSession.alice` always holds the CURRENT device's ratchet state, whether initiator or responder.
- `drSession` and `isRealContact: true` are set together whenever a real handshake completes. A conversation with one but not the other is stale local-only state.
- Send path must HARD-FAIL (graceful, user-visible) when not a real secure channel — gate on `!isRealContact || !conv.drSession`. Never append a "sent"/encrypted local message that is not actually transmitted. No sim else-branch, no session retry/fabrication.
- `addConversation` returns `{ ok, error? }` (errors: server_unreachable / not_found / no_bundle / no_own_keys / x3dh_failed). Callers (messages.tsx, GhostInvite.tsx) branch on `.ok`.

**Why:** the whole product promise is that private keys never leave the device and there is no backdoor/simulated path; any reintroduced fallback silently breaks that guarantee.

**How to apply:** when touching `lib/doubleRatchet.ts`, `lib/crypto.ts`, or `context/AppContext.tsx` send/add-conversation flows, preserve these invariants.

# Post-quantum hybrid layer (ML-KEM-768) — invariants
GHOSTFACE uses HYBRID PQ: ML-KEM-768 mixed with X25519 in BOTH the X3DH handshake (PQXDH) and the continuous Double Ratchet rekey (PQ3). Hybrid means security is ALWAYS ≥ classical — never drop the X25519 leg.
- **Symmetry is the load-bearing invariant**: in `performDHRatchet` the encapsulator's sending-KDF must equal the decapsulator's receiving-KDF. Order: receive side decapsulates with the CURRENT `PQs.priv` BEFORE rotating; then rotate `PQs`, encapsulate to peer `PQr`, fold into sending KDF. Break this ordering → silent de-sync (messages stop decrypting after the first ratchet step).
- **Agreement is proven by DECRYPTION, not by comparing RK.** Alice ratchets immediately on init so her `RK` diverges from Bob's by design even on a correct handshake. Tests/assertions must check that a message decrypts (and a tampered `pqkemCt` fails to decrypt), NOT `aliceRK === bobRK`.
- **Graceful classical fallback**: all PQ fields (`PQs/PQr/pq/pendingPqCt`, header `pqPub/pqCt/pqkemCt`, bundle `pqkemPublicKey/pqkemSignature`) are OPTIONAL. No PQ material → `pq=false`, classical path. Legacy serialized states (no PQ fields) must still validate.
- **`isValidRatchetState` guard**: if `pq===true` the state MUST carry a valid `PQs` keypair (pub+priv), else reject — a `pq:true` state with missing `PQs` would de-sync on the next ratchet. Fresh-rebuild beats message loss.
- **Self-heal must check the ML-KEM key too**: AppContext mount/background rekey gates check BOTH `MY_IK_PRIV_KEY` AND `MY_PQKEM_PRIV_KEY`; if either is missing, rekey. Otherwise the server keeps advertising a PQ prekey while the Bob receive path (needs `bobKemPriv` to decapsulate) fails → message loss.
- KEM prekey signature is verified STRICTLY (Ed25519 over the KEM pub via ikSign); reject on bad/missing sig when `pqkemPublicKey` present.
- DB: `identity_keys` gained nullable `pqkem_public_key`/`pqkem_signature`. PQ KEM ct rides inside existing payload/x3dhHeader JSON — no messages-table change.

**Why:** hybrid was added so a future quantum adversary can't break sessions, without ever weakening the classical guarantee. The subtle failure mode is silent de-sync from asymmetric KEM folding or a half-provisioned PQ key.

# Ratchet hardening invariants (Aug 2026 audit)
- AEAD associated data uses a CANONICAL fixed-field-order header serializer (`headerAd`), not `JSON.stringify(header)` — keep both encrypt/decrypt on it; the field order (dh,n,pn,pqPub,pqCt) is wire-compatible and must not change.
- Skipped-key cache: delete only AFTER successful decrypt (else one tampered packet destroys the key), and total map is capped (oldest-evicted) beyond the per-chain MAX_SKIP.
- A bundle with exactly ONE of spkSignature/ikSignPublicKey is rejected as a downgrade attempt; both-absent still warns (legacy). Full audit: `artifacts/ghostface/docs/ENCRYPTION_AUDIT.md`.

# Test infra note (no JS test runner)
The repo has NO vitest/jest/tsx/esbuild, and `artifacts/ghostface/tsconfig.json` EXCLUDES `**/*.test.ts` (so a `.test.ts` is neither typechecked nor run). The convention for runnable checks is `scripts/check-*.{js,mjs}` exposed as a `check:*` package script. The two-party handshake test lives at `artifacts/ghostface/scripts/check-x3dh-handshake.mjs` (`pnpm --filter @workspace/ghostface run check:handshake`); it transpiles `lib/doubleRatchet.ts` at runtime via the `typescript` API and asserts no private-key sharing.
