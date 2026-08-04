---
name: Sealed-sender requires alias↔identity binding
description: Why sealed-sender messaging must bind the recovered sender alias to its registered identity key
---

# Sealed sender must bind the recovered alias to a cryptographic identity

When the sender's alias is moved off the wire/storage and instead carried *inside*
the encrypted payload (sealed sender), the recipient MUST verify the recovered
alias against the sender's registered identity key before trusting it.

**Why:** The previous design had the server attest the sender (`from: authedAlias`
after device-token auth). Sealed sender removes that attestation, so the alias
becomes self-asserted. On the X3DH bootstrap path, any authenticated peer can run
X3DH against the recipient's bundle with their *own* identity key but embed a
*different* alias (e.g. claim "ALICE") in the payload — and without a binding check
the recipient creates/overwrites a conversation labeled with the spoofed alias.
This is an impersonation / conversation-takeover hole that did not exist before.

**How to apply:** On the new-session (X3DH-header) receive path, after decrypting
and recovering the claimed alias, fetch that alias's registered identity public key
and require it to equal `x3dhHeader.ikA` (the trust source is the same alias→key
registry used when initiating). Fail-closed: drop on mismatch or unreachable
lookup. The established-session (trial-decrypt) path needs no extra binding —
identity is already fixed by *which* ratchet session successfully decrypted (that
session was verified at bootstrap). Tradeoff: a legitimate rekey can transiently
false-reject an in-flight first message; acceptable, smooth later if needed.

Related: lazy per-user routing-token backfill must be an atomic guarded UPDATE
(`WHERE ... AND token IS NULL RETURNING`, then re-select) so concurrent first
callers can't mint/clobber different tokens and strand messages.
