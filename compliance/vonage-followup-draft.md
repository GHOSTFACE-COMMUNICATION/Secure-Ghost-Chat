# Vonage — follow-up to Aaron Lee's answers (SMS API + virtual numbers)

**SENT 28 Aug 2026** to aaron.lee@vonage.com from benjamin@ghostface.co.nz
(Gmail message id `1a04801c0d47f909`, on thread `1a046911af7a4b96`).

Sent as a reply on the existing thread with Aaron Lee. Aaron answered the
27 Aug enquiry (`vonage-reply-draft.md`) point by point; this presses the
four answers that were incomplete and the two that changed our assumptions.
⏳ **No reply received as at 5 Sep 2026.**

**Deliberately says nothing about the app's cryptography.** Same constraint as
the first email: GF-01 is still with MinterEllison and no characterisation of
the encryption should reach a vendor before counsel's written opinion. If
Vonage responds with a use-case or compliance questionnaire touching
encryption, pause and check it against the classification memo first.

## What Aaron's reply actually settled

- **Q1 — qualified yes, but possibly to a different question.** He justifies
  the use case via *masked calling*, where the platform holds the number and
  proxies two parties. GhostNumber assigns each end user their own persistent
  number. The words *sub-allocation* and *resale* — the framing this repo
  flagged as the real risk — appear nowhere in his answer. Re-asked as point 1.
- **Q2 — KYC confirmed as ours.** We are data controller and must collect and
  retain end-user identity/address records, producible on request. This is a
  **structural conflict with the alias-only, no-PII product**, not a paperwork
  task. It may mean GhostNumber only ships in his third tier (any worldwide
  address). Country-tier mapping requested as point 5.
- **Q3 — 90-day ageing.** Released numbers do not return to the pool for 90
  days, so `lib/rotationScheduler.ts` can never recycle our own inventory:
  every rotation permanently consumes new inventory, and the released number is
  still billed for the current month. Roughly double MRC during overlap. The
  prize-pool row's "recurring cash cost per user" is worse than modelled.
- **Q7 — unanswered.** We said hard exclusions mattered more than coverage; we
  got "100+ countries, see three docs" and no exclusions. Re-asked as point 2.
- **Q4 — New Zealand is absent** from his SMS+Voice combined list, though Q8
  says numbers exist for all four first-wave markets. Home market. Point 3.
- **Q5 — 10DLC may not scale.** "Each end-customer brand registered
  separately" does not work when end customers are individual consumers. The
  3-month minimum campaign duration also collides with rotation. Point 4.
  Note non-compliance fees begin **1 Oct 2026**.
- **AUP — OTP receipt is blocked at platform level.** Not a question for
  Vonage, but a product problem: users given a private number will try to
  register WhatsApp/Google/banks with it and those inbound messages are
  filtered. Needs handling in the UI before launch. Point 6 asks only that the
  filtering not catch ordinary conversational traffic.

---

Subject: Re: Vonage SMS API and virtual numbers — GHOSTFACE / Ghostface Limited

Dear Aaron,

Thank you — that's a genuinely useful set of answers, and the AUP detail on
verification traffic in particular is the kind of thing we would much rather
design around now than discover in production.

Six points where I would like to go one level deeper before we commit to build.

1. **Sub-allocation / resale.** Your answer to my question 1 describes masked
   calling, where the platform holds the number and proxies two parties
   without revealing either. What we intend is different: each end user is
   assigned their own persistent number, which is theirs until it rotates.
   Some providers classify that as sub-allocation or resale and either
   restrict it or require a specific agreement. Could you confirm explicitly
   whether Vonage permits **sub-allocating subscribed numbers to individual
   end users** in a consumer app, using those terms? As this determines
   whether the feature ships at all, I would like it confirmed by someone who
   can speak for Vonage contractually rather than as general guidance — happy
   to be routed to compliance or legal.

2. **Hard exclusions (my question 7).** This one is still open, and it shapes
   our rollout more than anything else. Rather than the full coverage list,
   what I need are the exceptions: countries where **assigning a number to an
   individual end user is not permitted at all**, and countries where doing so
   requires local presence or a local entity. Even an approximate list would
   let us plan; the long tail of coverage matters much less to us.

3. **New Zealand.** NZ is our home market and in the first wave, but it does
   not appear in the SMS+Voice combined list in your answer to question 4.
   Could you confirm whether NZ virtual numbers support **both inbound SMS and
   inbound voice on the same number**, or whether that market would need
   separate numbers per capability?

4. **US 10DLC at consumer scale.** You noted we would register as a reseller
   with each end-customer brand registered separately. Our end customers are
   individual consumers, potentially tens of thousands of them, so registering
   each as a brand does not look workable. Could you confirm how this is
   intended to work for a consumer app — or whether there is a different path
   for platforms that assign numbers to individuals? Related: the three-month
   minimum campaign duration sits awkwardly with periodic number rotation, and
   I would like to understand how those two interact.

5. **KYC mapping.** Understood that we hold and retain the records as data
   controller. Two things would help us scope it: which specific documents you
   would expect us to be able to produce on request, and a mapping of which
   countries fall into each of the three address tiers you described — same
   country, same region, any worldwide address. The third tier is the only one
   that fits an alias-based product cleanly, so knowing which markets sit there
   would shape where we enable the feature first.

6. **Rotation, ageing and snowshoeing.** Noted on the 90-day ageing period —
   that means we consume new inventory on every rotation rather than recycling
   our own, which we can plan for. My concern is the fraud policy: routine,
   automated per-user rotation across a pool of numbers could resemble
   snowshoeing on the metrics, even though the intent is user privacy rather
   than reputation dilution. Could you confirm that periodic per-user number
   rotation in a messaging app is not treated as snowshoeing, and whether there
   is a cadence or volume threshold we should stay under? On the same theme,
   could you confirm the verification-message filtering applies only to
   identity/OTP traffic and will not catch ordinary conversational messages
   between users?

One smaller point: the pricing link covers voice. Could you also send the
current rate card for virtual number subscriptions (monthly recurring by
country) and for inbound SMS?

Thank you again — this is exactly the level of detail we needed.

Kind regards,

Benjamin Henderson
Ghostface Limited
benjamin@ghostface.co.nz
