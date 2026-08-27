# GHOSTFACE — Compliance Status Dashboard

Compiled from `compliance/`, `STATUS.md`, and `TRACKER.md` (GF-01/GF-02 rows) as of the latest tracker entries (26 Aug 2026: counsel receipt confirmed). This is a tracking document, not a legal opinion — GHOSTFACE has no formal SOC 2/ISO/HIPAA/PCI program; the live compliance surface is export control plus platform/privacy obligations tied to launch.

## 1. Frameworks in scope

| Framework | Applies because | Status |
|---|---|---|
| US EAR (encryption export control) | Distributed via Apple's US infrastructure and built on Expo's US build servers, regardless of NZ domicile | 🔄 Opinion in progress |
| NZ strategic-goods control (Wassenaar Cryptography Note / MFAT) | Ghostface Limited is the NZ exporter of record | 🔄 Opinion in progress |
| Apple App Store platform rules | Export-compliance questionnaire + `ITSAppUsesNonExemptEncryption` declaration required for every submission; privacy policy URL required for review | ⏸ Blocked pending #1/#2 |
| NZ Privacy Act 2020 (IPPs) | App collects/stores personal comms data from NZ users | ⬜ Policy drafted, gaps open |
| GDPR (UK/EU) | Contingent — only applies if EU/UK users are served | ⬜ Not yet assessed |

## 2. Control inventory / evidence on file

| Document | Purpose | Location |
|---|---|---|
| `GHOSTFACE_Cryptographic_Inventory.md/.pdf` | Factual inventory of every algorithm, library, and protocol composition (ChaCha20-Poly1305, X25519, Ed25519, ML-KEM-768, HKDF, PBKDF2 — all standard, via `@noble/*`) | `compliance/` |
| `GHOSTFACE_Classification_Memo.md/.pdf` | Frames the mass-market self-classification question for counsel, flags `kdfRkPQ` (HKDF composition of X25519 + ML-KEM-768 secrets) as the one element to scrutinise | `compliance/` |
| `GHOSTFACE_ASC_Declaration_Exhibits.pdf` | 6-exhibit screenshot bundle: 2 failed June ASC doc uploads, Jul 3 build-27 rejection (error 90592), Jul 16 build-27 Invalid Binary, Aug 21 build-63 Validated | `compliance/` |
| `gf01-materials-covering-email.md` | Final covering email to counsel (Sarah Salmond, MinterEllisonRuddWatts), states the five-step declaration history accurately | `compliance/` |
| Privacy + support pages | Live on the landing site; drafted from actual app behavior (alias-only registration, opaque `delivery_id` routing, public-keys-only storage, hashed push tokens, non-custodial wallet) | `~/Projects/ghostface-landing` (separate repo) |

**Not yet captured as evidence:** the July ASC questionnaire record itself (the underlying `appEncryptionDeclarations` API data, distinct from the screenshots) — noted as retrievable but optional once the exhibit bundle covers the same ground.

## 3. Audit / opinion calendar

| Date | Event |
|---|---|
| 21 Aug | Build 63 uploaded to ASC, Validated, `ITSAppUsesNonExemptEncryption: false`. Internal-testing-only, 2 tester accounts (both Benji's own Apple IDs) — no third party ever received it |
| 23 Aug | MinterEllisonRuddWatts (Sarah Salmond) proposes a combined US EAR + NZ opinion, NZ$4,000–7,000 + GST, ~5 working days from receipt of materials |
| 24–25 Aug | Engagement accepted; +$500 add-on accepted to also map the opinion onto Apple's `ITSAppUsesNonExemptEncryption` declaration |
| 25 Aug (evening) | Full materials pack sent: crypto inventory, classification memo, ASC exhibit bundle |
| 26 Aug | **Receipt confirmed** by counsel — the 5-working-day clock is running from this date |
| **~1 Sep** | **Opinion due** |
| **3 Sep** | **Chase-up trigger** — if no written opinion by then, send a status-check reply on the existing thread (draft first, don't send blind) |

## 4. Gap analysis

**Export declaration inconsistency (highest priority, blocks App Store submission):**
`app.json` currently sets `ITSAppUsesNonExemptEncryption: false` (baked into every build through 66), asserting the encryption is exempt. But the classification memo explicitly does *not* support that value — it states it is "not a self-classification decision," and mass-market treatment (5D992.c) is a classification, not an exemption. The June/July ASC questionnaire record (documenting non-exempt use, with `codeValue`) predates the `false` flag entirely. **This flag must be re-decided against counsel's written opinion before any `eas submit`** — a decision already made and tracked (GF-01), not new, but the highest-value close-out once the opinion lands.

**Post-opinion plist mechanics (mapped, not yet actioned):** if the opinion requires documentation review, `ITSEncryptionExportComplianceCode` must accompany `ITSAppUsesNonExemptEncryption: true` — that code is issued by Apple after approving uploaded documentation. If the mass-market path applies, no code is needed — just truthful questionnaire answers plus the annual BIS self-classification report filed separately. Which path applies is exactly what the opinion will settle.

**Privacy policy content gaps** (flagged deliberately as HTML comments in the live page rather than guessed): log/IP retention policy, NZ Privacy Act 2020 IPP 6/7 wording (access/correction rights), GDPR Articles 15–22 wording (contingent on EU/UK users), named data processors, minimum age, subscription-cancellation path, abuse-reporting enforcement process. All flagged for review alongside the GF-01 counsel engagement rather than published as boilerplate.

**Adjacent security-posture items with privacy/compliance bearing** (from the engineering tracker, relevant if this data ever needs describing to counsel or in the privacy policy): three unauthenticated write endpoints (`POST /blobs`, `POST /invites`, `GET /ice-config` credential vending) currently rely on global rate caps rather than device auth — a decide-before-launch item, not a compliance blocker today, but worth flagging if the privacy policy or opinion ends up describing access controls.

## 5. Pre-ship gates tied to compliance

| Gate | Status | Note |
|---|---|---|
| Export-compliance opinion received | ⏳ due ~1 Sep | Blocks any `eas submit` |
| `ITSAppUsesNonExemptEncryption` re-decided against opinion | ⬜ waiting on above | + `ITSEncryptionExportComplianceCode` if required |
| Annual BIS self-classification report (if mass-market path confirmed) | ⬜ waiting on above | Separate filing, company-side |
| Privacy policy gaps filled | ⬜ waiting on counsel review | Currently live but incomplete on IPP/GDPR wording |
| CSPRNG on-device smoke test | ⬜ not done | Independent gate, physical iOS + Android |
| TestFlight coordination note | 🔄 drafted, not published | AD wire-format cutover means old↔new builds can't exchange messages |

## 6. Next actions, in order

1. Stand by for counsel's questions or the written opinion (no action needed before ~1 Sep).
2. If silent by 3 Sep, send the prepared status-check reply (review before sending).
3. On receipt of the opinion: re-decide the `ITSAppUsesNonExemptEncryption` flag (+ compliance code if required), make whichever BIS filing it prescribes, cut a new build if the flag changes, then submit.
4. Send courtesy stand-down notes to Torres Trade Law / Wiley Rein if they've since replied (now redundant given the MinterEllison engagement).
5. Once the opinion also settles the "what does the app actually do with data" framing, close the privacy-policy HTML-comment gaps against it (IPP 6/7, GDPR contingency, retention, processors, age, cancellation, abuse reporting).
6. Independently of GF-01: run the CSPRNG on-device smoke test and publish the TestFlight coordination note — neither depends on counsel.

---
*This dashboard tracks status only; it does not restate legal analysis already captured in the classification memo and covering email. Update it alongside TRACKER.md's GF-01/GF-02 rows as events happen.*
