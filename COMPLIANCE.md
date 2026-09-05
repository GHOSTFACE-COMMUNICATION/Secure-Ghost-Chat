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

> **The authoritative classification record is the pair:** the **revised memo of
> 2 September 2026 (Version 2, matter 1056841)** together with the
> **Cryptographic Inventory revision 2 (31 August 2026)**. The memo governs the
> classification; the Inventory is the description of cryptographic
> functionality the memo is expressly conditioned on (§3.1(b)). Neither stands
> alone — an opinion whose underlying description has drifted is not an opinion
> you can rely on. Earlier versions of both are superseded and retained only for
> the chain of reasoning.

### Authority

| | |
|---|---|
| Advice | MinterEllisonRuddWatts |
| Authors | Sarah Salmond, Sian Vaughan-Jones |
| Matter | 1056841 |
| Dated | **2 September 2026 (Version 2 — REVISED, operative)** |
| Title | *Ghostface Limited — US and NZ Export-Control Classification Queries (Revised)* |
| Archived | `~/Documents/Ghostface-Legal/1056841-export-control/2026-09-02_Counsel_Memo_REVISED_v2.pdf` |
| SHA-256 | `1a282e8d24b858e6822e996dc69ccfe064a3be96c9f00115ed91898ebb38bce9` |
| Supersedes | 31 August 2026 version — archived as `2026-08-31_Counsel_Memo_v1_SUPERSEDED.pdf` (SHA-256 `d7630466…8107`) |

**The 2 Sep revision folds both outstanding items into the opinion itself.**
Argon2id (§4.12–4.14) and the AEAD associated-data correction (§4.15–4.17) are
now addressed in the memo body rather than in a follow-up email, and neither
changes the classification. It also reviews the ASC declaration history at §7.6
and gives an explicit instruction on the `Info.plist` flag at §7.8. **Cite the
2 September version, not the 31 August one.**

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

⛔ **The WireGuard VPN is NOT in this baseline, and is deliberately not added
here.** This section records what counsel was actually shown; the VPN was not.
It is a shipped, user-facing cryptographic subsystem that appears nowhere in the
memo or in Annex 1 — logged as an open diff in §4 and now described in
Cryptographic Inventory rev. 3 §3, *WireGuard VPN tunnel*. It joins this list only if and when counsel
has considered it.

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
against §2. **This table is the record memo §7.4(e) requires** — "release
records identifying the versions, cryptographic feature sets and build numbers
covered by this opinion".

⚠️ **Coverage gap, logged 2 Sep 2026: this table has three rows and ASC holds 66
accepted builds** (1.0.0 ×18, 1.0.1 ×18, 1.0.2 ×30). That is defensible for
builds never distributed, but **builds 47, 48 and 61 were on the external
public-link TestFlight group `mb` between 31 Jul and 1 Sep 2026 and have no row
here** — see §5 and TRACKER GF-18. §7.4(e) asks for the builds *covered by this
opinion*, and anything that reached an external channel plainly qualifies.
**Add rows for 47/48/61 as part of the correction to counsel**, and going
forward add a row at upload time rather than reconstructing later.

| Version | Build | Date | `ITSAppUsesNonExemptEncryption` (compiled) | Crypto diff vs reviewed materials | Distribution |
|---|---|---|---|---|---|
| 1.0.2 | 63 | 20 Aug 2026 | ❌ `false` | not assessed at the time | TestFlight internal, director's accounts only (memo §7.6(f)) |
| 1.0.2 | 74 | 29 Aug 2026 | ❌ `false` — **verified from the compiled `Info.plist` inside the `.ipa`**, not from config | ✅ **ZERO** — argon2id cleared 31 Aug 2026 and now in the baseline (§2); the AEAD canonical-AD change (`10400e8`, 19 Aug) was also present and unrecorded at the time, cleared 31 Aug | Uploaded to ASC, accepted by processing. **Not submitted for review. Must not be** — its compiled flag is `false`, which the memo does not support (§7.8). Unshippable for the declaration, not for its crypto. |
| 1.0.2 | 75 | 30 Aug 2026 | ✅ `true` — **verified from the compiled `Info.plist` inside the `.ipa`** (EAS artifact `sOwNGmCL…`), not from config | ✅ **ZERO** — argon2id cleared by counsel 31 Aug 2026 and recorded in the baseline (§2); the AEAD canonical-AD change (`10400e8`, 19 Aug) was also present and unrecorded at the time, cleared 31 Aug | Internal TestFlight only, director's accounts — the footing the memo treats as unproblematic at §7.6(f). Upload currently blocked by ASC error 90592 (stale June encryption declarations), a **declaration-record** issue, not a crypto-diff one — see TRACKER GF-15. |
| 1.0.2 | **79** | 5 Sep 2026 | ✅ `true` — **verified from the compiled `Info.plist` inside the `.ipa`** (EAS `e167adb0-d0de-4323-a9e6-cec1b4c5102a`, artifact `4_fWqEaaJb…ipa`), not from config | ⚠️ **NOT ZERO — two open items.** **(a) GF-19:** the WireGuard VPN (`PlugIns/networkpackettunnel.appex`, present in this artifact) appears nowhere in the memo or Annex 1, so its status against §2 is **unestablished rather than zero**. **(b) audit #7 (`137b8b4`) and #11 (`ae81b63`)**, both 31 Aug 2026 — assessed non-material below, **counsel inclusion not confirmed**. | **Built, NOT uploaded, and must not be** while GF-19 and 90592 stand. First conforming binary since build 75 — **75 is no longer the only one**, which matters because 75's EAS artifact expires ~30 Sep 2026. Also carries the profile-gated scene fix (`UISceneDelegateClassName = GHOSTFACE.SceneDelegate`) and `DTXcode 2600` / `DTSDKName iphoneos26.0`, i.e. built with Xcode 26.0. |

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

**Status: ✅ RESOLVED — and now IN THE OPINION ITSELF, not just an email.**
The revised memo of **2 September 2026** addresses argon2id at **§4.12–4.14**:
it is "a published and widely used key-derivation function, standardised in
RFC 9106", applied "in a conventional manner", performing "no encryption", and
**"We do not consider the inclusion of Argon2id to affect the classification
conclusions reached in this memorandum"** (§4.14). It is also now listed in the
memo's own algorithm table at §4.3(h). That is stronger than the email below,
which it supersedes; the email is kept for the chain of reasoning.

Originally resolved 31 August 2026 by Sarah Salmond on the memo thread
(cc Sian Vaughan-Jones, Isabelle Pou):

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

### ✅ Assessed diff: audit #7 (`137b8b4`) and #11 (`ae81b63`)

Both committed **31 August 2026**, both ancestors of build 79's commit
(`1465dce`). Present in builds 78 and 79; **no build carrying them has been
uploaded or distributed.**

**Diffstat**, `1db743a..1465dce` over the five cryptographic modules — `1db743a`
(27 Aug) is the last commit touching any of them before these two, so this range
isolates exactly #7 and #11:

| File | Change |
|---|---|
| `lib/crypto.ts` | +48 / −28 |
| `lib/secureStorage.ts` | +30 / −11 |
| `lib/doubleRatchet.ts` | unchanged |
| `lib/stealthCrypto.ts` | unchanged |
| `lib/recoveryPin.ts` | unchanged |

🪤 **A first attempt at this diff returned EMPTY** because an unquoted shell
variable broke the pathspec. It would have gone into this file as "no
cryptographic changes" — a false all-clear. Re-run per file. **Verify a
compliance diff by making it produce something, not by trusting a clean result.**

**#7 — `137b8b4`, "refuse unauthenticated bytes instead of adopting them"
(`lib/secureStorage.ts`).** Deleted a third fallback tier which, when both
authenticated decrypts failed, returned the raw stored bytes **as plaintext**
and re-encrypted them under the master key. That turned an AEAD tag failure —
the one signal meaning "these bytes are not ours" — into "assume legacy data and
adopt it", so anything able to write the AsyncStorage slot could choose the
returned value and have it durably re-encrypted as authentic. Not limited to
message history: `LOCAL_WALLET_PRIV_KEY` is read through the same path. A failed
read now returns `null`; the stored value is left in place for off-device
diagnosis rather than cleared.
**Assessment: not material.** No algorithm, primitive, protocol or parameter
changes. It *removes* a path that bypassed authentication — the change
strengthens the property AEAD was there to provide.

**#11 — `ae81b63`, "safety number from identity keys, alias version deleted"
(`lib/crypto.ts`).** `generateSafetyNumber` now derives from both parties'
identity keys, validated as 64 hex characters and rejected otherwise, instead of
signing public keys; an older alias-only variant is deleted. The construction is
unchanged — SHA-256 over a sorted, domain-separated string — with the domain
label bumped `GHOSTFACE_SAFETY_NUMBER_v2` → `v3`.
**Assessment: not material.** No new primitive; SHA-256 is already in the §2
baseline. It changes *what the safety number is derived from*, not the
cryptography.
⚠️ **User-visible consequence, recorded because it is a security-UX change even
though it is not a classification one: the `v2` → `v3` label bump means every
previously verified safety number changes.** Anyone who has verified a contact
will see a different number and may reasonably read that as tampering.

⚠️ **Counsel inclusion NOT confirmed.** Both commits are dated 31 Aug 2026;
Cryptographic Inventory rev. 2 is dated 31 Aug 2026 and the revised memo is
2 Sep 2026. **Dates alone do not establish whether counsel was told about
either**, and this record deliberately does not claim they "post-date the
reviewed materials" — the memo revision in fact post-dates the commits. This
file already carries one correction where exactly that inference was made wrong
(the AEAD fix at §5, which had shipped eleven days before it was put to
counsel). Treated here as **recorded, not cleared**, and included in the rev. 3
covering note to counsel at `compliance/inventory-rev3-covering-email.md`.

### ⛔ OPEN DIFF: the WireGuard VPN is absent from the reviewed materials

**Found 4 September 2026 while recording the change below.** The application
ships a **WireGuard VPN**: `app/(tabs)/vpn.tsx` is a top-level tab with server
selection, `app.json:46` carries the
`com.apple.developer.networking.networkextension` entitlement, and build 77's
Xcode log compiles `WireGuardKit`, `WireGuardKitC`, `WireGuardKitGo` and
`WireGuardGoBridge` into the app target. The VPN cut attempted for 1.0.2 was
reverted (`4a4053c`); it ships.

**It appears nowhere in the reviewed materials.** Text search of the
Classification Memo and the Cryptographic Inventory (Annex 1) returns **zero**
occurrences of "WireGuard", "VPN", "Noise", "BLAKE2" or "tunnel". The only
Curve25519 reference in Annex 1 is X25519 ECDH via `@noble/curves` — the
messaging handshake, not the tunnel's.

**Three statements in Annex 1 (as it stood at rev. 2) were inconsistent with the
shipped app:**

1. §Purpose — "factual inventory of **all cryptography used in the product**".
2. §1 — the cryptography is implemented "**entirely**" via `@noble/*` and
   `react-native-argon2` plus OS facilities. The tunnel is vendored C, Swift and
   Go: `WireGuardKitC/x25519.c` and `golang.zx2c4.com/wireguard` +
   `golang.org/x/crypto` 0.6.0.
3. §1 — encryption exists "**solely** to protect users' personal communications
   in transit and at rest" and performs "no encryption function beyond that
   data-security purpose". The tunnel's default `allowedIPs` is
   `0.0.0.0/0,::/0`, carrying all of the device's traffic.

✅ **Annex 1 has been corrected — Cryptographic Inventory rev. 3, 4 Sep 2026**:
the VPN is described at §3, *WireGuard VPN tunnel*, its primitives are in the §2 table, §1 and §4 are
corrected, and §6 records the revision. **Counsel has not yet seen rev. 3.**

**Why this is recorded rather than resolved here.** Memo §3.1(b) conditions the
opinion on the accuracy and completeness of the technical information provided.
The nearest precedent is argon2id: a single KDF from a named library still
required an Inventory update so it would "remain a complete and accurate
description of the Application's cryptographic functionality" (§4.12–4.14). This
is a second cryptographic subsystem and a product capability the description did
not mention. **That comparison is this record's characterisation, not counsel's.
The classification question is counsel's and is not answered here.**

**Effect on the §5 standing rule — for Benji to decide, not asserted here.**
The rule permits submission where the crypto diff against §2 is zero and that
zero is recorded. Against §2 as it stands, the VPN's status is **unestablished
rather than zero** — §2 does not describe it either way, which is the gap this
entry exists to record. Whether that should hold build 78 is a judgement call
for Benji; **this record does not itself impose a new gate.** What it does
establish is that a zero-diff claim *covering the VPN* cannot be evidenced from
the materials as they stand.

**Action:** goes to counsel together with the §4.17 distribution correction
already owed — one message, two completeness items.

### ✅ Assessed diff: WireGuardKitC.h — `#include <sys/types.h>`

A single `#include <sys/types.h>` added to
`native/wireguard-apple/Sources/WireGuardKitC/WireGuardKitC.h` (5 lines, comment
included), commit `ad2d02b`, 4 September 2026. **It sits inside the component
described immediately above, which is itself an open diff.**

**Why it was needed.** The header redeclares `struct ctl_info` and
`struct sockaddr_ctl` from `<sys/kern_control.h>` using the BSD `u_int32_t`,
`u_char` and `u_int16_t` typedefs, which upstream relies on arriving implicitly.
Under explicit Clang modules the compiler refuses: *"declaration of `u_int32_t`
must be imported from module `_DarwinFoundation1.unsigned_types.u_int32_t`
before it is required"*, ending in *"failed to emit precompiled module …
WireGuardKitC-….pcm"*.

**This is the confirmed cause of build 77's failure**, established 4 Sep 2026 by
reading build 77's Xcode log: those three typedefs are the only error cluster in
the entire build. EAS's Xcode enforces explicit modules as local Xcode-beta 27
does.

**Assessment: not a material change to cryptographic functionality.** No
algorithm, protocol, key handling, parameter or runtime behaviour changes; the
change alters type visibility at compile time only, and the emitted code is the
same. Same character as the AEAD canonical-AD correction counsel cleared at memo
§4.15–4.17 as "a routine implementation correction rather than a material
change". Recorded in Cryptographic Inventory rev. 3 §5.

**Distribution: none.** Build 77 errored with no artifact. **Build 78
(`cbd76ce8-2832-410d-b33d-dab3072ac131`, 1.0.2 build 78, commit `f6ce57e`) was
built successfully on 5 Sep 2026 and is the first artifact carrying this diff** —
verified from the compiled `Info.plist` inside the `.ipa`. It has **not** been
uploaded to ASC or distributed to anyone, and must not be while GF-19 and 90592
stand.

⚠️ **Not put to counsel.** On the §4.16 precedent this change alone almost
certainly does not need to be — but it cannot be signed off as a zero diff while
the component it modifies is undescribed in the materials counsel holds.

---

## 5. Standing rule (replaces the GF-01 submit freeze)

GF-01 is **closed**. The blanket freeze on `eas submit` is lifted and replaced by
a conditional gate:

> **A build may be submitted only if its crypto diff against §2 is zero and that
> zero has been recorded as a row in §4.**

### ⛔ THE SUBMIT GATE, in order — GF-19 sits ABOVE 90592

Recorded 5 Sep 2026 because the two are routinely conflated, and 90592 gets
treated as the only thing in the way:

1. **GF-19 — the WireGuard VPN is absent from the reviewed materials.** This is
   **first**, and it is ours, not Apple's. §2 does not describe the VPN, so no
   build containing `PlugIns/networkpackettunnel.appex` — which is every build
   including 78 and 79 — can honestly claim a zero diff. Under the rule above,
   that alone bars submission, and it would still bar it on the day Apple clears
   90592. Blocked on: counsel's answer to Inventory rev. 3.
2. **90592 — the stuck June export-compliance declarations.** Apple's side. Ten
   failed submissions; the declarations attach to the *app*, not to a version or
   build, so a version or build-number bump cannot clear them (tested on build
   76). Blocked on: Apple Developer Support.

⚠️ **Clearing 90592 does not unblock submission on its own.** Both gates have to
be open. A build that passes Apple's declaration check while GF-19 stands would
be a submission this file's own standing rule forbids.
>
> **Any material change to cryptographic functionality goes to counsel before it
> ships** — not after. Record the outcome in §4.

Consequences currently in force:

- ✅ **The AEAD associated-data fix is CLEARED — and as of 2 Sep 2026 the
  clearance is IN THE OPINION BODY, not an email.** Revised memo §4.15–4.17:
  the correction "replaces JSON serialisation of message headers with a fixed
  binary encoding", the algorithms, Double Ratchet protocol and intended
  functionality are unchanged, and it is "a routine implementation correction
  rather than a material change… we do not consider this to require the
  classification analysis to be revisited" (§4.16). **§4.17 records the timing
  correction explicitly** — committed 19 Aug 2026, present in the builds
  uploaded 29–30 Aug, "already in effect before the matter was raised with us".
  So the disclosure obligation on timing is discharged. Original email
  clearance (31 Aug 2026), superseded but retained:
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
  timing must be corrected to counsel. ✅ **Discharged — the revised memo of
  2 Sep 2026 records the correct timing itself at §4.17.** **The lesson the
  rule exists for: check `git log` before calling something pending.**
  ⛔ **BUT SEE THE DISTRIBUTION DISCREPANCY IMMEDIATELY BELOW — the "no third
  party has ever received a build" half of this paragraph is NOT verified and
  is now known to be incomplete.**
- ⛔ **OPEN AND BLOCKING A CLEAN RECORD — the distribution representation to
  counsel is incomplete.** Revised memo **§4.17** states as fact that
  "Distribution of those builds has been limited to internal TestFlight testing
  on the director's own Apple IDs, and **no third party has received any
  build**", and §7.6(f)/§7.7(b) repeat it. This file said the same thing above.
  **App Store Connect does not support that in full.** Read from the ASC API on
  1 Sep 2026: beta group **`mb` is `isInternalGroup: false` with a PUBLIC JOIN
  LINK enabled from 31 July 2026 until it was disabled on 1 Sep 2026**, carrying
  builds **61, 48 and 47**. A public TestFlight link is by definition available
  to third parties.
  **Precisely what is and is not known:**
  - For **build 63** specifically, §7.6(f) appears accurate — 63 was on the
    internal `GF` group, not on `mb`.
  - For **builds 47, 48 and 61** an open external channel existed for ~32 days.
  - **Whether anyone joined is UNKNOWN.** Zero testers at the time of closure,
    but a removed tester would not appear in that count and the app-level
    `betaTesters` endpoint returns 403 at the available API key's scope. **Do
    not upgrade "zero now" into "nobody ever" — that is the error this record
    keeps making.**
  **Why it matters:** memo §3.1(b) conditions the entire opinion on Ghostface's
  description being accurate and complete, and §7.4(f) requires retention of
  TestFlight declaration records. **This goes to Sarah as a correction, framed
  as fact not conclusion.** It may well change nothing — mass-market
  classification under Note 3 does not turn on tester counts, and §4.7(a)/(d)
  reason from public availability, which a public link only reinforces. That is
  counsel's call to make, not ours, and it is better raised now than found
  later. See TRACKER GF-18.
- ✅ **The argon2id recovery PIN is RESOLVED** (counsel, 31 Aug 2026) and is now
  part of the reviewed baseline in §2. See §4.
- Before any public release, the App Store questionnaire answers and the
  compiled `ITSAppUsesNonExemptEncryption` must both say the app **uses
  encryption**, with the mass-market exemption relied upon — **revised memo
  §7.8, 2 Sep 2026**, in counsel's own words: Ghostface "should ensure that the
  App Store export-compliance questionnaire responses and the
  ITSAppUsesNonExemptEncryption build setting accurately reflect that the
  Application uses encryption, while noting that an applicable export-control
  exemption is relied upon". **This is now an explicit instruction from counsel,
  not an inference**, and it is the citable authority for build 75's `true`.
- ✅ **Counsel independently reached the same diagnosis of ITMS-90592.** Revised
  memo §7.7(a): the July upload failures "appear to have arisen from an apparent
  mismatch between the Application's build configuration and the export
  compliance documentation previously recorded in Apple's systems, rather than
  from any substantive assessment by Apple regarding the product's export
  classification". §7.6(a) records the two June declarations as "both 'Upload
  Failed', June 18 and 19, 2026". §2.1(c)(ii) instructs Ghostface to "review and
  update any App Store export-compliance declarations to reflect this opinion's
  conclusions" — **usable in the Apple Developer Support request** as a
  counsel-directed reason to clear them.
- ✅ **Guarded by a test, and as of 2 Sep 2026 that test runs in CI.**
  `artifacts/ghostface/lib/exportCompliance.test.ts` fails the test suite if
  `ITSAppUsesNonExemptEncryption` is not `true`, citing this file, and the suite
  now runs on every push and pull request via `.github/workflows/verify.yml`
  alongside `check:handshake` and `check:silence`.
  ⚠️ **Correction of record: between 30 Aug and 2 Sep this file claimed the flag
  was "guarded in CI" when no CI existed** — the repo had no `.github/workflows`
  directory at all, so the guard fired only when a human typed `pnpm test`. That
  same gap left `check:handshake`, the proof that the E2EE is genuinely
  end-to-end, silently broken for 13 days across five crypto changes. The claim
  is true now; it was not true when it was first written. **Note the flag guard
  rides inside the app test suite rather than being its own CI step, and lint is
  currently non-blocking** — see TRACKER Engineering — open.
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

**Integrity: `MANIFEST.sha256` lives in that folder.** Verify any copy with
`shasum -a 256 -c MANIFEST.sha256` from inside it; a mirror that passes is
byte-identical to the original. Regenerate it whenever a document is added
(`shasum -a 256 *.pdf`). This matters because §7.4 requires these records to be
*retained*, and a retained document nobody can prove is unaltered is weaker
evidence than one that carries its own checksum.

⏳ **Mirror status, 2 Sep 2026: NOT DONE — no OneDrive account is signed in on
this machine.** `OneDrive.app` is installed but `~/Library/CloudStorage/` is
empty, so no sync target exists. Sign in with the **Ghostface M365 account**
(not a personal one) and the folder appears at
`~/Library/CloudStorage/OneDrive-<Tenant>/`; copy the archive there and re-run
the manifest check on the copy. ⚠️ **Prefer the OneDrive desktop sync over any
API/connector route** — the desktop client moves the files from this disk to the
company tenancy directly, whereas a connector would route privileged
correspondence through a third-party proxy. **The archive is currently
single-copy on one laptop**, which is the risk the mirror exists to remove.

| Record | Status |
|---|---|
| **This opinion — memo §7.4(a)** | ✅ **GOVERNING: the revised memo of 2 Sep 2026**, archived as `2026-09-02_Counsel_Memo_REVISED_v2.pdf` (SHA-256 `1a282e8d…bce9`). ✅ **Superseded 31 Aug version now archived too** as `2026-08-31_Counsel_Memo_v1_SUPERSEDED.pdf` (SHA-256 `d7630466…8107`). ⚠️ **Correction of record, 2 Sep 2026: this row previously claimed the 31 Aug opinion was "retained as `GHOSTFACE_Classification_Memo.pdf`". That was WRONG.** `GHOSTFACE_Classification_Memo.pdf` is **Ghostface's own Technical Memorandum for Counsel** (Benjamin Henderson, 19 Aug 2026, headed "Company's technical understanding… **Not legal advice**") — it is memo **Annex 2**, not counsel's advice. Counsel's 31 Aug memo was sitting unarchived in `~/Downloads` until 2 Sep. **Verified by reading page 1 of each file, not by inferring from filenames** — the names are genuinely misleading here. ⬜ **Still outstanding: export the Gmail transmittal messages as PDF** into the archive, so the covering emails sit with both versions of the advice. |
| Cryptographic Inventory (Annex 1) | ✅ archived |
| Technical Memorandum (Annex 2) | ✅ archived — **the file is `GHOSTFACE_Classification_Memo.pdf`**, whose name is misleading: it is Ghostface's own technical memo of 19 Aug 2026 ("Not legal advice and not a self-classification decision"), *not* counsel's classification memo. Named before the counsel memos existed. **Do not mistake it for the opinion.** |
| ASC Declaration Exhibits (Annex 3) | ✅ archived |
| Follow-up to counsel, 30 Aug 2026 | ✅ sent — reply on the memo thread to Sarah Salmond, cc Sian Vaughan-Jones / Isabelle Pou: argon2id omission from Annex 1, and the pending AEAD associated-data encoding fix. Both framed against §7.5's revisit trigger. |
| **Counsel's response, 31 Aug 2026** | ✅ received — Gmail message `1a05644d32bf7630`. Neither item changes the classification analysis or the memorandum's conclusions. Argon2id: conventional published KDF, no effect on classification; inventory to record it. AEAD: routine implementation correction, no revisit required, **provided the change is limited to the issue described**. ✅ **filed** as `2026-08-31_Counsel_Response_argon2id_AEAD.pdf` in the archive, alongside the memo. |
| **REVISED MEMO (Version 2), 2 Sep 2026** | ✅ **received and archived** as `2026-09-02_Counsel_Memo_REVISED_v2.pdf` (SHA-256 `1a282e8d…bce9`). **This is now the operative opinion.** It folds argon2id (§4.12–4.14) and the AEAD correction (§4.15–4.17) into the memo body, adds argon2id to the §4.3 algorithm list, records the AEAD timing correctly at §4.17, reviews the ASC declaration history at §7.6, diagnoses ITMS-90592 as a configuration mismatch at §7.7(a), and gives the explicit `ITSAppUsesNonExemptEncryption` instruction at §7.8. Classification unchanged: **ECCN 5D992.c, self-classify under §740.17(b)(1), no CCATS, no MFAT permit, distribution may resume.** |
| ⛔ **Correction owed to counsel — external TestFlight** | ⬜ **NOT SENT — do this before relying further on §4.17.** The memo states no third party has received any build; ASC shows an external public-link beta group (`mb`) open 31 Jul – 1 Sep 2026 carrying builds 61/48/47. Send as a factual correction, stating plainly that historical tester membership is not visible at our API key's scope so we cannot assert nobody joined. See §5 and TRACKER GF-18. |
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
