# GHOSTFACE — Compliance Status (Health Check)

> The live GF-01 position. For frameworks in scope, the control inventory and
> gap analysis, see `GHOSTFACE_Compliance_Dashboard.md`.

**As at:** 26 August 2026
**Scope:** Export-control classification of the GHOSTFACE encrypted messenger
(US EAR + NZ strategic goods) and the Apple App Store encryption declaration.
**Owner:** Benjamin Henderson · GHOSTFACE LIMITED

> Snapshot document. Source of truth remains `TRACKER.md` (GF-01/GF-02) and
> `STATUS.md`; this consolidates them into one page. Update on the next
> material change (counsel's opinion, a filing, or a submission).

---

## Overall health: 🟡 ON TRACK — BLOCKED PENDING LEGAL OPINION

The single gate between GHOSTFACE and App Store submission is a written
export-control opinion, now with counsel and expected **~Mon 1 Sep 2026**.
Nothing is overdue, nothing has been misrepresented to a regulator or to
Apple, and the app is build-ready. The one hard rule until the opinion lands:
**no `eas submit`, no Apple questionnaire answers, no ASC documentation
attempts.**

| Area | State |
|---|---|
| Legal counsel engaged | ✅ MinterEllisonRuddWatts — confirmed |
| Materials delivered to counsel | ✅ Sent 25 Aug · receipt confirmed 26 Aug |
| Written opinion received | ⏳ Due ~1 Sep 2026 (5 working days) |
| US EAR classification resolved | ❌ Awaiting opinion |
| NZ strategic-goods position resolved | ❌ Awaiting opinion |
| Apple `ITSAppUsesNonExemptEncryption` decided | ❌ Currently `false` — to be re-decided against opinion |
| App Store submission | ⛔ HELD until opinion |

---

## The two open regulatory questions

1. **US EAR** — Does the crypto stack qualify for **mass-market
   self-classification** under §740.17(b)(1) / ECCN 5D992.c, or does it need a
   **CCATS** classification request to BIS? The crux is **`kdfRkPQ`** (the
   ML-KEM / post-quantum key-derivation component).
2. **NZ strategic goods** — Does export engage the NZ strategic-goods regime
   (MFAT permit) or fall under the **Wassenaar mass-market** cryptography
   exemption?

The classification memo (`GHOSTFACE_Classification_Memo.pdf`) explicitly
**declines to self-classify** — it states it is "not a self-classification
decision." That is exactly why counsel was engaged rather than answering
Apple's questionnaire ourselves.

---

## Legal engagement

- **Firm:** MinterEllisonRuddWatts — International Trade & Regulatory.
- **Partner:** Sarah Salmond.
- **Scope:** One written opinion covering **both** questions above (US EAR
  mass-market vs CCATS **and** NZ strategic goods / MFAT). Opinion only — **no
  filings** made by them; **no US co-counsel** anticipated (US question
  answered in-house).
- **Fee:** NZ$4,000–7,000 + GST, **plus +$500 + GST** for the Apple-flag
  section (mapping the conclusion onto `ITSAppUsesNonExemptEncryption` and the
  questionnaire implications). Accepted in the materials email.
- **Engagement basis:** No separate engagement letter required — the
  acceptance email suffices under standard terms (confirmed by Sarah, 25 Aug).

### Timeline
| Date | Event |
|---|---|
| 19 Aug | Initial enquiry sent (memo + crypto inventory). |
| 23 Aug | MinterEllison replied with proposal (had landed in a stranded M365 mailbox; MX since fixed to Google). |
| 25 Aug | Acceptance sent; engagement confirmed; +$500 Apple-flag section accepted. |
| 25 Aug (eve) | **Materials pack emailed to Sarah.** 5-working-day clock starts. |
| 26 Aug | **Receipt confirmed** — "we'll review… provide our advice early next week." |
| ~1 Sep | **Written opinion expected.** |
| Wed 3 Sep | **Chase pinned** — if no opinion, send a reviewed status-check reply on the existing thread. |

### Parallel US outreach (now redundant)
Bounded one-page-opinion requests were sent 22 Aug to **Olga Torres** (Torres
Trade Law) and **Lori Scheetz** (Wiley Rein). MinterEllison now covers the US
question in-house, so these are **stood down** — send a courtesy note if/when
either replies.

---

## Materials delivered to counsel (`compliance/`)

- `gf01-materials-covering-email.md` — covering email (final; five-step
  evidenced sequence incl. the three-upload history).
- `GHOSTFACE_Cryptographic_Inventory.pdf` (+ `.md`) — full crypto inventory.
- `GHOSTFACE_Classification_Memo.pdf` (+ `.md`) — classification analysis.
- `GHOSTFACE_ASC_Declaration_Exhibits.pdf` — 7-page captioned bundle of
  ASC/EAS screenshots evidencing the Apple upload history.

---

## Apple / App Store technical posture

- **Current flag:** `expo.ios.infoPlist.ITSAppUsesNonExemptEncryption: false`
  in `artifacts/ghostface/app.json` — baked into every build to date. This
  asserts the encryption is *exempt* and suppresses Apple's "Missing
  Compliance" prompt. **The memo does not support this value** — it must be
  **re-decided against counsel's written answer.**
- **Post-opinion plist mechanics (mapped 25 Aug):** the change is not simply
  `false`→`true`. `ITSEncryptionExportComplianceCode` accompanies
  `true` **only when Apple required documentation review** (its value is the
  code Apple issues after approving uploaded docs — ERN/CCATS-class cases). The
  mass-market / standard-algorithms path typically needs **no code** — just
  truthful questionnaire/plist answers plus the annual **BIS self-classification
  report** filed on our side. Both keys, if needed, go under
  `expo.ios.infoPlist`.

### Apple upload history (GF-02 evidence — recovered 25 Aug)
Three upload attempts exist, not two:
1. **Jul 3** — v1.0.0 (build 27), from a *different* EAS project ("MAYBACH
   MONEY", account since renamed "B Henderson"). Rejected mid-upload, Apple
   error **90592**: plist export-compliance key `[]` didn't match the
   export-compliance **documentation with a code value** the manual
   questionnaire had created in ASC. **So the honest non-exempt documentation
   predates the `false` flag entirely.**
2. **Jul 16** — v1.0.1 (build 27), reached ASC, Invalid Binary.
3. **21 Aug** — build 63, `false` in plist, **Validated**, internal-testing-
   to-self only.

**Open question for counsel/API:** how did build 63 validate with `false`
while non-exempt documentation was on file — superseded, expired, or
invalidated? `appEncryptionDeclarationState` will say.

---

## Hard gates & decisions in force

- ⛔ **No `eas submit` until the opinion lands.** Submitting build 66 "to see
  if Apple pushes it through" was considered and **rejected**: the `false` flag
  suppresses Apple's check so approval would prove nothing, while the
  submission itself is the *first formal exemption representation to Apple* —
  made days before counsel answers that exact question.
- ✅ **Build 66 sits ready either way** — confirmed flag → submit 66 as-is;
  corrected flag → one-line change + build 67.
- 🚫 While waiting: no uploads, no submissions, no questionnaire answers, no
  ASC documentation attempts.

---

## Next actions

| # | Action | Trigger / date | Owner |
|---|---|---|---|
| 1 | Stand by for any clarifying questions from Sarah | Now–1 Sep | Benji |
| 2 | Chase (reviewed reply on existing thread) if no opinion | Wed 3 Sep | Benji / Claude |
| 3 | On opinion: re-decide `ITSAppUsesNonExemptEncryption` (± `ITSEncryptionExportComplianceCode`) | On receipt | Benji + Claude |
| 4 | Make whichever BIS filing the opinion prescribes | On receipt | Benji |
| 5 | Build 67 if the flag changes, then `eas submit` | After (3)/(4) | Claude |
| 6 | Courtesy stand-down notes to Torres / Wiley if they reply | If they reply | Benji |

---

## Watch items / risks

- **`jjules@` delivery** — the 22 Aug US-outreach copies used `xtra.com` /
  `xtra.co`; NZ Xtra addresses are `@xtra.co.nz`. Both domains used are real
  and separately owned. **Confirm intended recipient actually received it.**
- **Opinion could reclassify** — if counsel says CCATS/non-exempt rather than
  mass-market, expect a plist change (build 67), a BIS filing, and possibly ASC
  documentation before submission.
- **Annual BIS self-classification report** may be a standing obligation even
  on the mass-market path — confirm in the opinion.
