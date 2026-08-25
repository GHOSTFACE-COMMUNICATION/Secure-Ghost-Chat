# GF-01 — covering email to Sarah Salmond (materials pack)

Draft finalised 25 Aug 2026, incorporating the full declaration history
recovered that day (three uploads, not two; honest questionnaire first).
Send from benjamin@ghostface.co.nz on the existing thread.

**Attachments to include:**
1. `compliance/GHOSTFACE_Cryptographic_Inventory.pdf` (in this repo)
2. `compliance/GHOSTFACE_Classification_Memo.pdf` (in this repo)
3. Screenshot: ASC build page, 16 Jul upload (v1.0.1 b27, Invalid Binary)
4. Screenshot: ASC build page, build 63 (v1.0.2, Validated)
5. The 3 Jul EAS submit log showing Apple error 90592
6. The July ASC App Encryption Documentation record, if retrievable
   (App Information → App Encryption Documentation)

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
about, our App Store Connect history shows three upload attempts, and the
sequence is worth setting out precisely:

1. In early July 2026 I manually completed the export-compliance
   questionnaire in App Store Connect, answering that the app does use
   encryption. That created export-compliance documentation in Apple's
   system with an associated key value.

2. On 3 July, an upload of v1.0.0 was rejected by Apple mid-processing
   (error 90592) because the binary's Info.plist carried no export-
   compliance key at all, which did not match the documentation on file.
   The rejection log is attached.

3. On 16 July, an upload of v1.0.1 reached App Store Connect but was
   marked Invalid Binary and was never installable or distributed.

4. On 21 August (UTC), a build (v1.0.2, build 63) carrying
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

Screenshots of both build records and the rejection log are attached
[+ the July documentation record if located]. Happy to provide anything
further your review turns up.

Kind regards,
Benjamin Henderson
Director, Ghostface Limited
