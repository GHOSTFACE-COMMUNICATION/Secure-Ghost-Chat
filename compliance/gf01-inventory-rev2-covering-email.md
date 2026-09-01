# Covering email — Cryptographic Inventory rev. 2 (+ timing correction)

**Send as:** reply on the existing memo thread
(subject `RE: Ghostface - Export-Control Classification For Encrypted Messaging App /
US EAR + NZ Strategic Goods (Advice Attached)`, Gmail thread `1a054b173cda9995`)
**To:** sarah.salmond@minterellison.co.nz
**Cc:** sian.vaughan-jones@minterellison.co.nz; isabelle.pou@minterellison.co.nz
**Attach:** `GHOSTFACE_Cryptographic_Inventory_rev2_2026-08-31.pdf`

> ⚠️ Review before sending. Section 3 corrects a statement made to counsel on
> 30 August. It is deliberately explicit: the advice is expressly conditioned on
> the accuracy and completeness of the technical information we provide, so a
> quiet amendment in the inventory alone would not be adequate.

---

Hi Sarah,

Thank you for confirming both points so quickly. Please find attached the
updated Cryptographic Inventory (revision 2, 31 August 2026), which records
them as you recommended.

We would like to take up your offer of a short addendum recording your
consideration of these matters, so the advice package and the supporting
documents stay aligned.

**1. What revision 2 records**

- **Argon2id** is now in the primitives table (§2) with its parameters, and has
  its own entry in §3 setting out its purpose, inputs, parameters and output,
  in the same form as the existing `kdfRkPQ` entry. It is used solely to blind
  the identity key with a user-chosen PIN before the recovery phrase is
  generated; it performs no encryption.
- **The associated-data encoding correction** is recorded in a new §5, covering
  implementation corrections. It sets out that the algorithms (ChaCha20-Poly1305),
  the protocol and the intended functionality are unchanged, and that only the
  byte-level representation of the associated data changes.
- **§6 itemises what changed** between revision 1 and revision 2, so the
  differences can be seen without comparing the two documents line by line.

We also corrected two statements in §1 and §4 of revision 1, which described all
cryptography as being implemented via the `@noble/*` libraries. That ceased to be
accurate once Argon2id was recorded, as it is provided by a separate open-source
library (`react-native-argon2`). Both now name the two sources.

**2. No other changes**

Revision 2 introduces no proprietary or novel cryptographic algorithm, and
changes no primitive other than by recording Argon2id, which was already in use
when revision 1 was prepared.

**3. Correction to our 30 August description of the AEAD fix**

We should correct one point in our 30 August email. We described the
associated-data encoding fix as "a pending bug fix". On review of our version
history, it was not pending: the change was committed on 19 August 2026 and was
already present in the two builds uploaded to App Store Connect on 29 and 30
August. It had therefore shipped before we raised it with you, not after.

The description of the change itself was accurate — it is the canonical-encoding
correction described, and nothing further was included with it.

For completeness on distribution: neither build has been submitted for App
Review or released publicly. Distribution to date has been limited to internal
TestFlight testing on the director's own two Apple IDs, and no third party has
received any build. We mention this because your conclusions are expressly
conditioned on the accuracy and completeness of the information we provide, and
we would rather correct the record than leave it as it stands.

We would be grateful if the addendum could reflect the position as corrected.

Kind regards,

Benjamin Henderson
Director, Ghostface Limited
benjamin@ghostface.co.nz
