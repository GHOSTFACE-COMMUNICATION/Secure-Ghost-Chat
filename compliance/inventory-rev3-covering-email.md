# Cryptographic Inventory rev. 3 — covering note to counsel

**DRAFT — NOT SENT.** To Sarah Salmond (MinterEllison), on the GF-01 memo
thread, from benjamin@ghostface.co.nz. Same recipients as the rev. 2 covering
note (`gf01-inventory-rev2-covering-email.md`), i.e. cc Sian Vaughan-Jones and
Isabelle Pou unless Benji says otherwise.

⚠️ **Attach the regenerated PDF, not the markdown.** `GHOSTFACE_Cryptographic_Inventory.pdf`
was rebuilt at rev. 3 on 5 Sep 2026 (pandoc 3.11 → WeasyPrint 69.0, A4, 6 pages);
the recipe is committed at `compliance/inventory-pdf.css`. Rev. 2's PDF and the
markdown had silently diverged before, which is what that recipe exists to stop.

⚠️ **This note asks one question and does not answer it.** The materiality
assessments in COMPLIANCE.md §4 are Ghostface's own reading, recorded under the
standing rule. Counsel's view is what the classification rests on.

**Three things go across, and they are not equally serious:**

1. **The WireGuard VPN — an omission, not a change.** It was present when
   revisions 1 and 2 were prepared and was not described. This is the reason for
   the note.
2. **Audit #7** — storage no longer falls back to plaintext on a failed
   authenticated read.
3. **Audit #11** — the safety number is derived from identity keys.

⛔ **Do not describe #7 or #11 as "post-dating the materials you reviewed."**
Both were committed 31 Aug 2026; rev. 2 is dated 31 Aug and the memo revision is
2 Sep, which post-dates them. Whether they were ever drawn to counsel's attention
is unknown. The wording below says exactly that and no more — the same care the
AEAD timing correction at §5 had to be issued for.

---

Subject: GHOSTFACE — Cryptographic Inventory rev. 3, and one omission we need to
correct

Dear Sarah,

I am writing with a revised Cryptographic Inventory (rev. 3, attached). One item
in it is a correction we should have made earlier, and I would rather put it in
front of you plainly than have it surface later.

**The omission.** GHOSTFACE includes a VPN client built on WireGuard, and it is
not described in the Inventory you reviewed, nor in the memorandum. It is not a
new feature: it was present in the application when revisions 1 and 2 were
prepared, and it ships in the current builds as a separate iOS Network Extension
(`networkpackettunnel.appex`). The Inventory described the messaging stack
accurately and simply did not cover it. That is our error.

What it consists of, in short — rev. 3 §3 sets it out in full:

- The upstream WireGuard implementation, vendored unmodified into the repository
  from the public `wireguard-apple` sources. We have written no cryptography for
  it.
- Standard published WireGuard: the Noise_IKpsk2 handshake pattern with
  Curve25519 key agreement, ChaCha20-Poly1305 for transport authenticated
  encryption, BLAKE2s for hashing and MAC, and HKDF for key derivation. The
  optional pre-shared-key slot is not used.
- It carries the device's network traffic through an encrypted tunnel, so its
  purpose is broader than the messaging encryption the memorandum describes as
  protecting "users' personal communications". Rev. 3 §1 and §4 are corrected to
  say so.
- iOS only; there is no Android equivalent.

The only local modification to that vendored component is a one-line
`#include <sys/types.h>` in a C header, required for it to compile at all under
a newer toolchain. It changes type visibility at compile time and nothing else.

**Two further changes, both from our own security audit, both committed on
31 August 2026.** I cannot tell from our records whether either was drawn to your
attention before the memorandum was revised on 2 September, so I am putting them
to you now rather than assuming:

- **Audit #7 — storage no longer accepts unauthenticated bytes.** Previously,
  when authenticated decryption of locally stored data failed, the application
  fell back to treating the stored bytes as pre-encryption legacy plaintext and
  re-encrypted them under the master key. A failed read now returns nothing and
  the caller starts clean. No algorithm, protocol or parameter changes; the
  change removes a path that bypassed authentication.
- **Audit #11 — the safety number is derived from identity keys.** The value two
  users compare to verify a conversation is now derived from both parties'
  identity keys rather than their signing public keys. The construction is
  unchanged (SHA-256 over a sorted, domain-separated string); only the input
  changes. One user-visible consequence: the domain-separation label moves from
  v2 to v3, so safety numbers previously displayed will differ.

**What I would like from you.** Our own assessment is that neither #7 nor #11 is
a material change to cryptographic functionality — no new primitive, no algorithm
change, and in #7's case a removal of a path that weakened an existing
protection. We record that assessment as ours, not yours. So:

1. Does the addition of the WireGuard VPN to the description affect the
   classification conclusions in the memorandum, and in particular the
   **5D992.c** treatment?
2. Do either of the audit changes require the classification analysis to be
   revisited, or are they routine implementation corrections of the kind
   addressed at §4.15–4.17?
3. Should the Cryptographic Inventory be the vehicle for recording all three, as
   it was for Argon2id, or would you prefer them addressed in the memorandum
   itself?

We are holding submission of the current build pending your answer on the first
question. I am conscious this is the second completeness correction on this
matter, and that your conclusions are expressly conditioned on the accuracy and
completeness of what we provide — which is exactly why I would rather raise it
now than let a build go out against a description we know to be incomplete.

Kind regards,

Benjamin Henderson
Ghostface Limited
benjamin@ghostface.co.nz
