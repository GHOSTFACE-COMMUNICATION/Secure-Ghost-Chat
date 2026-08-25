# GF-01 — covering email to Sarah Salmond (materials pack)

Draft finalised 25 Aug 2026 against the exhibit bundle (June questionnaire
+ failed doc uploads; four binary uploads; honest answers first).
Send from benjamin@ghostface.co.nz on the existing thread.

**Attachments to include (all in `compliance/` in this repo):**
1. `GHOSTFACE_Cryptographic_Inventory.pdf`
2. `GHOSTFACE_Classification_Memo.pdf`
3. `GHOSTFACE_ASC_Declaration_Exhibits.pdf` — 6 captioned screenshots
   covering the ASC encryption-documentation page (Jun 18/19 upload
   failures), the Jul 3 EAS submission + 90592 log, and the three ASC
   build records (b28 Invalid, b27 Invalid, b63 Validated)

---

Subject: RE: Engagement enquiry — export-control classification (materials)

Dear Sarah,

Please find attached the technical materials for your review: the
cryptographic inventory and the research memorandum analysing the stack
against the mass-market criteria. I understand the five-working-day estimate
runs from your receipt of these.

Please also include the Apple export-compliance section at the additional
$500 plus GST — having the classification conclusion and the App Store
declaration addressed in one opinion is exactly what we want.

Regarding the prior declarations and questionnaire responses you asked
about, our records show the following sequence, each step evidenced in the
attached exhibit bundle:

1. In June 2026 (18th and 19th) I completed the export-compliance
   questionnaire in App Store Connect, answering that the app does use
   encryption, and attempted to upload supporting documentation. App
   Store Connect shows both document uploads with status "Upload
   Failed" (Exhibit 1).

2. On 3 July, an automated submission of v1.0.0 (build 27) was rejected
   by Apple mid-processing with error 90592: the binary's Info.plist
   carried no export-compliance key at all, which did not match the
   export-compliance documentation Apple held from the June
   questionnaire (Exhibits 2-3).

3. Also on 3 July, a second binary, v1.0.0 (build 28), reached App
   Store Connect and was marked Invalid Binary - never installable
   (Exhibit 4).

4. On 16 July, v1.0.1 (build 27) likewise reached App Store Connect and
   was marked Invalid Binary (Exhibit 5).

5. On 21 August (UTC), a build (v1.0.2, build 63) carrying
   ITSAppUsesNonExemptEncryption set to "false" was uploaded and validated,
   with "App Uses Non-Exempt Encryption: No" recorded — this time derived
   from the compiled setting, with no questionnaire completed. For
   completeness: that upload occurred approximately 20 hours after my
   initial enquiry to your firm, and it has only ever been available
   through TestFlight internal testing to two tester accounts, both of
   which are my own Apple IDs. No external tester or third party has ever
   received any build.

So the earliest considered declaration on our record is the July
questionnaire stating that the app uses encryption; the later "false"
(exempt) setting is a build-configuration value rather than a considered
reversal of it, and it remains the current committed value. Later builds
exist (through build 66) but none has been uploaded, and we are holding all
further uploads and any submission until your advice.

The exhibit bundle also shows the App Encryption Documentation section
as it stands today. Happy to provide anything further your review turns
up.

Kind regards,
Benjamin Henderson
Director, Ghostface Limited
