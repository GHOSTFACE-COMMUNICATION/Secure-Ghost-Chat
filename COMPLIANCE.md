# GHOSTFACE — export-control compliance record

This file is the standing record for the export-control classification of the
GHOSTFACE application, and the per-build evidence that each release matches the
cryptographic functionality counsel actually reviewed.

**Read `Standing rule` below before any `eas submit`.** It replaces the
submission freeze that GF-01 previously imposed.

---

## 1. Classification statement

**GHOSTFACE is self-classified as ECCN 5D992.c** — mass-market encryption
software under Note 3 to Category 5, Part 2 of the Commerce Control List.

- **US (EAR):** Self-classification under §740.17(b)(1). **No CCATS filing is
  required.** An annual self-classification report under Supplement No. 8 to
  Part 742 **is** required — see §3.
- **New Zealand:** Falls within the Cryptography Note (Note 3) exemption in
  Category 5, Part 2 of the NZ Strategic Goods List. The 5D002 controls on
  cryptographic software do not apply. **No MFAT permit is presently required.**
- **Distribution:** App Store and Google Play distribution may proceed.

### Authority

| | |
|---|---|
| Advice | MinterEllisonRuddWatts |
| Authors | Sarah Salmond, Sian Vaughan-Jones |
| Matter | 1056841 |
| Dated | 31 August 2026 |
| Title | *Ghostface Limited — US and NZ Export-Control Classification Queries* |

Counsel's qualifications, which travel with the conclusion: MinterEllisonRuddWatts
is not admitted to practise US law and the EAR analysis rests on their trade
practice and public BIS guidance (§3.1(a)); they did not independently verify the
technical materials and the opinion assumes the description is **accurate and
complete** (§3.1(b)); and the opinion states the position as at its date, subject
to regulatory change (§3.1(c)).

---

## 2. The reviewed cryptographic baseline

This is the functionality counsel was shown. **A release conforms only if its
cryptography is unchanged against this list.** Anything added, removed or
materially altered is a diff and must be recorded in §4 — see the standing rule.

Source: memo §4.3–§4.4 and §4.10, and the Cryptographic Inventory (Annex 1).

**Algorithms**

- ChaCha20-Poly1305
- X25519
- Ed25519
- ML-KEM-768
- SHA-256, SHA-512
- HKDF-HMAC-SHA256
- PBKDF2-HMAC-SHA256

**Implementation**

- Recognised, published algorithms only, via the open-source `@noble/*`
  libraries and OS cryptographic facilities. **No proprietary primitives.**
- Signal-protocol architecture: Double Ratchet with X3DH, extended to PQXDH,
  with post-quantum enhancements broadly analogous to published PQXDH/PQ3.
- `kdfRkPQ` (`artifacts/ghostface/lib/doubleRatchet.ts`) — a standard
  HKDF-SHA256 key-derivation combining X25519 and ML-KEM-768 shared secrets in
  the hybrid handshake. Counsel assessed this at §4.10–§4.11 and concluded it is
  **not** a novel primitive and does not require separate BIS classification.

---

## 3. BIS annual self-classification report

**Required every year.** Owed to BIS *and* to the NSA Encryption Request
Coordinator, covering items self-classified during the preceding calendar year.

| | |
|---|---|
| Recipients | crypt-supp8@bis.doc.gov **and** enc@nsa.gov |
| Authority | §740.17(b)(1); Supplement No. 8 to Part 742 |
| Covering | calendar year 2026 |
| **Must be received by** | **1 February 2027** |
| Status | ⬜ **not yet submitted** |

Minimum fields per Supplement No. 8 — the report must identify at least:

1. Product name
2. Model number
3. ECCN (`5D992.c`)
4. Encryption authorisation type (mass-market self-classification,
   §740.17(b)(1))
5. Brief description of the encryption functionality

Retain a copy of the report **and evidence of submission** (memo §7.4(d)).

---

## 4. Per-build release record

One row per build that is uploaded or distributed. "Crypto diff" is measured
against §2.

| Version | Build | Date | `ITSAppUsesNonExemptEncryption` (compiled) | Crypto diff vs reviewed materials | Distribution |
|---|---|---|---|---|---|
| 1.0.2 | 63 | 20 Aug 2026 | ❌ `false` | not assessed at the time | TestFlight internal, director's accounts only (memo §7.6(f)) |
| 1.0.2 | 74 | 29 Aug 2026 | ❌ `false` — **verified from the compiled `Info.plist` inside the `.ipa`**, not from config | ⛔ **NON-ZERO — see below** | Uploaded to ASC, accepted by processing. **Not submitted for review. Must not be.** |

### Build 74 — why it is not shippable

Two independent defects:

1. **Wrong export-compliance declaration.** The compiled value is `false`. The
   memo requires that the setting reflect that the application *uses*
   encryption, with the exemption relied upon separately (§7.8). This is the
   same wrong value the memo records against build 63 at §7.6(f). Verified by
   reading `Payload/GHOSTFACE.app/Info.plist` from EAS artifact
   `I9_1PvjVDCGMQB0admEnGX64ZG227RpNbaga_9WthTw.ipa`. `app.json` has since been
   corrected to `true`; **a new build is required** — the flag is compiled in.
2. **Cryptographic functionality outside the reviewed materials.** See below.

### ⛔ Open diff: argon2id (recovery PIN)

`artifacts/ghostface/lib/recoveryPin.ts` derives a blinding key with **argon2id**
(`react-native-argon2`), used as `phraseValue = identityKey XOR argon2id(pin,
salt)` so the 24-word recovery phrase alone cannot reconstruct the identity key.

**Argon2 does not appear anywhere in the Cryptographic Inventory counsel
reviewed** (verified by text search of Annex 1: zero occurrences of "argon", while
PBKDF2, ChaCha, ML-KEM, X25519, Ed25519, HKDF, SHA-256 and `kdfRkPQ` all appear).
It is also absent from the memo's §4.3 algorithm list. The feature was written on
`devtest` on 27 Aug 2026, at or after the materials were prepared, and is an
ancestor of build 74.

This is a key-derivation function guarding the identity key, so it is not
cosmetic. Memo §3.1(b) conditions the opinion on the description being complete,
and §7.5 recommends revisiting the classification if cryptographic functionality
materially changes.

**Required before public release:** put argon2id to counsel as an addendum to
matter 1056841, and record the outcome here. Assessment on the face of the memo's
own reasoning is that a standard published KDF should not disturb 5D992.c — but
that is counsel's call to make, not ours.

---

## 5. Standing rule (replaces the GF-01 submit freeze)

GF-01 is **closed**. The blanket freeze on `eas submit` is lifted and replaced by
a conditional gate:

> **A build may be submitted only if its crypto diff against §2 is zero and that
> zero has been recorded as a row in §4.**
>
> **Any material change to cryptographic functionality goes to counsel before it
> ships** — not after. Record the outcome in §4.

Consequences currently in force:

- **The pending AEAD associated-data fix is held behind this rule.** It changes
  cryptographic functionality and must go to counsel first.
- **The argon2id recovery PIN is an open, unresolved diff** (§4). Until counsel
  responds, no build containing it may be publicly released.
- Before any public release, the App Store questionnaire answers and the
  compiled `ITSAppUsesNonExemptEncryption` must both say the app **uses
  encryption**, with the mass-market exemption relied upon (memo §7.8).

### App Store Connect questionnaire

On public release, answer:

- **Does your app use encryption?** → **Yes**
- **Exemption** → mass-market, per the **ECCN 5D992.c self-classification** in
  this document (memo §2.1(a), §7.3).

---

## 6. Records to retain (memo §7.4)

Held outside this repository — a git repo is the wrong place for privileged
correspondence.

| Record | Status |
|---|---|
| This opinion (memo, 31 Aug 2026) | in email; **to be archived** |
| Cryptographic Inventory (Annex 1) | `~/Downloads/GHOSTFACE_Cryptographic_Inventory.pdf` |
| Technical Memorandum (Annex 2) | `~/Downloads/GHOSTFACE_Classification_Memo.pdf` |
| ASC Declaration Exhibits (Annex 3) | `~/Downloads/GHOSTFACE_ASC_Declaration_Exhibits.pdf` |
| BIS/ENC reports + evidence of submission | none yet — see §3 |
| Release records (versions, build numbers, crypto feature sets) | §4 of this file |
| App Store / TestFlight / Play export-compliance declarations | to collect |
