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
- Argon2id (RFC 9106) — recovery-PIN key blinding, added to the baseline per
  counsel's email of **31 August 2026**

**Implementation**

- Recognised, published algorithms only, via the open-source `@noble/*`
  libraries and OS cryptographic facilities. **No proprietary primitives.**
- Signal-protocol architecture: Double Ratchet with X3DH, extended to PQXDH,
  with post-quantum enhancements broadly analogous to published PQXDH/PQ3.
- `kdfRkPQ` (`artifacts/ghostface/lib/doubleRatchet.ts`) — a standard
  HKDF-SHA256 key-derivation combining X25519 and ML-KEM-768 shared secrets in
  the hybrid handshake. Counsel assessed this at §4.10–§4.11 and concluded it is
  **not** a novel primitive and does not require separate BIS classification.
- `argon2id` (`artifacts/ghostface/lib/recoveryPin.ts`) — RFC 9106 Argon2id via
  `react-native-argon2` (t=3, m=64 MiB, p=1, 32-byte output), used to blind the
  identity key with a user-chosen PIN before the recovery phrase is encoded.
  Counsel considered this on **31 August 2026** and concluded it is "a published
  and widely used key derivation function being applied in a conventional
  manner", not "a novel encryption algorithm or other material departure", and
  that it does **not** affect the classification conclusions. Recorded in
  Cryptographic Inventory rev. 2 §2–§3 as counsel recommended.

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
| 1.0.2 | 74 | 29 Aug 2026 | ❌ `false` — **verified from the compiled `Info.plist` inside the `.ipa`**, not from config | ✅ **ZERO** — argon2id cleared 31 Aug 2026 and now in the baseline (§2); the AEAD canonical-AD change (`10400e8`, 19 Aug) was also present and unrecorded at the time, cleared 31 Aug | Uploaded to ASC, accepted by processing. **Not submitted for review. Must not be** — its compiled flag is `false`, which the memo does not support (§7.8). Unshippable for the declaration, not for its crypto. |
| 1.0.2 | 75 | 30 Aug 2026 | ✅ `true` — **verified from the compiled `Info.plist` inside the `.ipa`** (EAS artifact `sOwNGmCL…`), not from config | ✅ **ZERO** — argon2id cleared by counsel 31 Aug 2026 and recorded in the baseline (§2); the AEAD canonical-AD change (`10400e8`, 19 Aug) was also present and unrecorded at the time, cleared 31 Aug | Internal TestFlight only, director's accounts — the footing the memo treats as unproblematic at §7.6(f). Upload currently blocked by ASC error 90592 (stale June encryption declarations), a **declaration-record** issue, not a crypto-diff one — see TRACKER GF-15. |

### Build 75 — the export declaration is now correct

First build carrying the corrected flag. Verified the same way build 74 was
disproved: by reading `Payload/GHOSTFACE.app/Info.plist` out of the actual
`.ipa`, not by trusting `app.json`. Also carries `c1657d0` (the 4002 kick-loop
stand-down) and `0278b41` (VoIP listeners before PushKit registration), neither
of which build 74 had.

⚠️ **The crypto diff is still non-zero** — argon2id remains unanswered by
counsel, so this build goes no further than internal TestFlight. That is the
same distribution footing as builds 63 and 74, which the memo addresses at
§7.6(f) as internal-only to the director's own accounts and not made available
to any third party.

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

### ✅ Resolved diff: argon2id (recovery PIN)

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

**Status: ✅ RESOLVED — 31 August 2026.** Sarah Salmond replied on the memo
thread (cc Sian Vaughan-Jones, Isabelle Pou):

> "argon2id appears to be a published and widely used key derivation function
> being applied in a conventional manner. As described, it does not appear to
> constitute a novel encryption algorithm or other material departure from the
> cryptographic functionality we considered in our analysis. Accordingly, we do
> not consider the inclusion of argon2id to affect the classification
> conclusions reached in the memorandum."

Counsel recommended updating the Cryptographic Inventory to record its use "so
that the inventory remains a complete and accurate description of the
Application's cryptographic functionality". **Done — Inventory rev. 2, 31 Aug
2026** (§2 primitives table, §3 recovery-PIN subsection, §6 change record).
Argon2id is now part of the reviewed baseline in §2, so it is no longer a diff.

⚠️ Counsel's conclusions remain "subject to the assumptions and qualifications
in the advice, including our reliance on the accuracy and completeness of the
technical information provided by Ghostface" — which is why the inventory has to
stay accurate, not merely be updated once.

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

- ✅ **The AEAD associated-data fix is CLEARED** (counsel, 31 Aug 2026) —
  assessed as "a correction to the way existing encryption functionality is
  implemented, rather than a change to the encryption itself… a routine
  implementation correction rather than a material change". Algorithms, protocol
  and intended functionality unchanged. Recorded in Cryptographic Inventory
  rev. 2 §5. The clearance is conditional in counsel's own words — "provided the
  change is limited to the implementation issue identified in your email" — so
  any further behavioural change bundled into that work is a new diff and comes
  back here.
  ⚠️ **Correction of record (31 Aug 2026): this fix had already SHIPPED when it
  was put to counsel.** It is commit `10400e8` ("fix(crypto): canonical binary
  AEAD associated data"), 19 Aug 2026 02:15 PDT — an ancestor of build 74
  (`4c641c6`) and build 75, and present in builds 62, 63, 74 and 75. The 30 Aug
  email to counsel described it as "a **pending** bug fix", and this file
  previously described it as "held behind this rule". Both were wrong: it had
  been in TestFlight builds for eleven days.
  **This is a breach of the rule above** — a change to cryptographic
  functionality shipped before counsel saw it. Cured retrospectively by the
  31 Aug clearance, and materially harmless (distribution has only ever been
  internal TestFlight to the director's own two Apple IDs, the footing the memo
  treats as unproblematic at §7.6(f); no third party has ever received a build).
  But counsel's conclusions are expressly conditioned on "the accuracy and
  completeness of the technical information provided by Ghostface", so the
  timing must be corrected to counsel — fold it into the note accompanying
  Inventory rev. 2. **The lesson the rule exists for: check `git log` before
  calling something pending.**
- ✅ **The argon2id recovery PIN is RESOLVED** (counsel, 31 Aug 2026) and is now
  part of the reviewed baseline in §2. See §4.
- Before any public release, the App Store questionnaire answers and the
  compiled `ITSAppUsesNonExemptEncryption` must both say the app **uses
  encryption**, with the mass-market exemption relied upon (memo §7.8).
- **Guarded in CI:** `artifacts/ghostface/lib/exportCompliance.test.ts` fails the
  test suite if `ITSAppUsesNonExemptEncryption` is not `true`, citing this file.
  The flag's value changed **ten times** between 10 Jun and 30 Aug 2026 (four
  of them since 6 Aug) because it lived in config with no rationale attached;
  it cannot silently flip again. Verified from git history 30 Aug 2026:
  `git log -G'ITSAppUsesNonExemptEncryption' -- artifacts/ghostface/app.json`
  — note `-S` undercounts here, as it only sees the key appear or disappear,
  not `true`↔`false` flips.

### App Store Connect questionnaire

On public release, answer:

- **Does your app use encryption?** → **Yes**
- **Exemption** → mass-market, per the **ECCN 5D992.c self-classification** in
  this document (memo §2.1(a), §7.3).

---

## 6. Records to retain (memo §7.4)

Held outside this repository — a git repo is the wrong place for privileged
correspondence.

**Archive:** `~/Documents/Ghostface-Legal/1056841-export-control/`
Mirror this folder to the Ghostface M365 / OneDrive tenancy — local working copy,
cloud durability under the company's own account.

| Record | Status |
|---|---|
| This opinion (memo, 31 Aug 2026) | ⬜ **still in Gmail — export the message as PDF (Print → Save as PDF) into the archive folder**, so the transmittal is preserved with the advice |
| Cryptographic Inventory (Annex 1) | ✅ archived |
| Technical Memorandum (Annex 2) | ✅ archived |
| ASC Declaration Exhibits (Annex 3) | ✅ archived |
| Follow-up to counsel, 30 Aug 2026 | ✅ sent — reply on the memo thread to Sarah Salmond, cc Sian Vaughan-Jones / Isabelle Pou: argon2id omission from Annex 1, and the pending AEAD associated-data encoding fix. Both framed against §7.5's revisit trigger. |
| **Counsel's response, 31 Aug 2026** | ✅ received — Gmail message `1a05644d32bf7630`. Neither item changes the classification analysis or the memorandum's conclusions. Argon2id: conventional published KDF, no effect on classification; inventory to record it. AEAD: routine implementation correction, no revisit required, **provided the change is limited to the issue described**. ✅ **filed** as `2026-08-31_Counsel_Response_argon2id_AEAD.pdf` in the archive, alongside the memo. |
| Cryptographic Inventory rev. 2, 31 Aug 2026 | ✅ updated in `compliance/` (argon2id §2–§3, AEAD correction §5, change record §6), exported to PDF and archived as `GHOSTFACE_Cryptographic_Inventory_rev2_2026-08-31.pdf`. ⬜ **Send to counsel** — Sarah offered to review it and issue "a short addendum recording our consideration of these points, so that the advice package and supporting documents remain fully aligned". Worth taking: it closes the loop in the file counsel holds, not just ours. |
| BIS/ENC reports + evidence of submission | none yet — see §3 |
| Release records (versions, build numbers, crypto feature sets) | §4 of this file |
| App Store / TestFlight / Play export-compliance declarations | ✅ ASC App Encryption Documentation completed 30 Aug 2026 — answers recorded in §7 |

---

## 7. App Store Connect — encryption declaration as filed

Completed **30 August 2026**, in reliance on the classification in §1. Retained
here because memo §7.4(f) requires keeping the declarations made on the strength
of this advice, and because the *answers* are the record — not merely the fact
that the flow was completed.

**Screen 1 — App Purpose** (298 / 300 characters, as filed):

> GHOSTFACE is a consumer end-to-end encrypted messaging and calling app.
> Encryption (standard published algorithms: ChaCha20-Poly1305, X25519,
> ML-KEM-768, Ed25519, HKDF, PBKDF2, Argon2id) secures user communications only.
> Mass-market product, self-classified ECCN 5D992.c under US EAR §740.17(b)(1).

Note this text names **Argon2id**, which is *not* in Annex 1. That is deliberate:
the declaration to Apple states what the app actually does. Omitting it to match
the annex would have been a false declaration. The inventory is the thing that
needs correcting — see the open diff in §4.

**Screen 2 — algorithms implemented:**

| Option | Answer | Basis |
|---|---|---|
| Proprietary / not accepted as standard by IEEE, IETF, ITU etc. | **NOT selected** | Memo §4.4 — no proprietary primitives. §4.10–4.11 — `kdfRkPQ` is a standard KDF applied conventionally, expressly not novel. |
| Standard algorithms, instead of or in addition to Apple's OS encryption | **SELECTED** | Memo §4.3 — published algorithms via open-source `@noble/*` **and** OS facilities. |

Every algorithm declared is a published standard: ChaCha20-Poly1305 (RFC 8439),
X25519 (RFC 7748), Ed25519 (RFC 8032), ML-KEM-768 (FIPS 203), SHA-256/512
(FIPS 180-4), HKDF (RFC 5869), PBKDF2 (RFC 8018), Argon2id (RFC 9106).

**Screen 3 — distribution in France: NO.** Consistent with the recorded launch
decision (STATUS.md): App Store availability limited to **NZ / AU / UK / US**,
with local advice to be taken before opening any further market. Answering yes
would additionally engage the French encryption declaration regime, on which no
advice has been sought.

**Outcome:** Apple confirmed no documents need uploading — expected, since
mass-market self-classification requires no CCATS (memo §2.1(a)).

### ⚠️ Apple's `Info.plist` hint — do not take it

That final screen offers: *"You can specify that you don't use encryption in the
information property list (Info.plist)… to avoid answering encryption questions
with each app submission."*

**This must not be followed.** It means setting
`ITSAppUsesNonExemptEncryption = false`, which:

- is untrue — the app implements the algorithms listed above, as declared on
  screen 2;
- is the exact defect that made builds 63 and 74 non-conforming, each verified by
  reading the compiled `Info.plist` out of the `.ipa`;
- contradicts memo §7.8, which requires the build setting and the questionnaire
  to both reflect that the app **uses** encryption; and
- now fails the test suite — `artifacts/ghostface/lib/exportCompliance.test.ts`.

The exemption is claimed through the ECCN 5D992.c mass-market
self-classification. It is **not** claimed by declaring that no encryption is
used. Apple's hint conflates the two.
