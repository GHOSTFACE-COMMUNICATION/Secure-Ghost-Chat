# Vonage — escalation #2: the model changed (pool leases / masked routing)

**SENT 5 September 2026** to aaron.lee@vonage.com from benjamin@ghostface.co.nz
(Gmail message id `1a06ff98a622dc34`, on thread `1a046911af7a4b96`).

Sent as a reply to our own 29 Aug message, which was the last on the thread.

⛔ **CORRECTION, 5 Sep — the thread state was recorded wrong everywhere.** The
last message on the thread is **not** the 28 Aug escalation. It is
`1a04cb8704cc2dbb`, **29 Aug**, from Benjamin — a soft close that accepts
Aaron's answers ("we will ensure our platform architecture accounts for these
constraints") and hands the next move to us: *"I'll be in touch once we are
ready to move forward with provisioning for our initial rollout."*

**So Vonage does not owe us a reply — we owe them one.** The 28 Aug escalation
was effectively withdrawn the following day. Any email opening as a chaser
would be chasing a man who was told we would come back to him. TRACKER GF-20
and the `vonage-followup-draft.md` header both said "no reply received", which
was the wrong way round.

**Why this is not just a chaser.** The 28 Aug email pressed Aaron on whether
Vonage permits sub-allocating subscribed numbers to individual end users. We
have since changed the product so that we do not do that at all (TRACKER GF-20).
GHOSTFACE is the **sole subscriber** of every number; numbers are leased per
`(pool number, counterparty)` pair for the life of a conversation and are
**never assigned to an end user**. That is the masked pattern Aaron himself
described in his answer to question 1, so the email leads with the change and
asks him to confirm the objection no longer arises, rather than arguing the
original point.

**Constraints deliberately observed:**

- ⛔ **Says nothing about the app's cryptography.** Same rule as both earlier
  emails.
- ⛔ **Says nothing about the VPN.** GF-19 — the VPN is absent from the
  materials counsel holds, and Inventory rev. 3 has not yet gone to them. A
  vendor must not learn of it before counsel does.
- **Plivo is not mentioned.** A rate-card comparison is underway but whether to
  tell Vonage that is a commercial decision for Benji, not a drafting one.

**What still gates the branch after this email:** question 7 (hard exclusions)
and NZ inbound SMS + voice on a single number. The pivot does not answer either
— a pool number still has to exist and be permitted in each market.

---

Subject: Re: Vonage SMS API and virtual numbers — GHOSTFACE / Ghostface Limited

Dear Aaron,

When I last wrote on 29 August I said I would come back to you once we were
ready to move forward. We are — and in the course of getting there we changed
the design in a way that I think resolves most of what you flagged, so I would
like to put the new model in front of you before we provision anything.

**What changed.** We are no longer assigning numbers to individual end users.
Ghostface Limited is the sole subscriber of every number. Numbers sit in a pool
we hold, and each is leased to a single pair — one pool number to one external
counterparty — for the life of a conversation, with the platform proxying
between the two parties so neither sees the other's real number. A user never
holds, keeps, or is issued a number.

That is, I think, precisely the masked pattern you described in your answer to
my first question. Four things follow, and I would like to confirm each with
you:

1. **Sub-allocation / resale.** On this model we are not sub-allocating numbers
   to end users at all — the subscriber and the number holder are both us.
   Could you confirm that this removes the concern, and that no specific
   agreement or exception is needed for it?

2. **KYC.** You confirmed we are the data controller and must hold and produce
   end-user identity and address records. Since no end user now holds a number,
   could you confirm the identity and address records Vonage would expect are
   those of Ghostface Limited as subscriber, rather than of each individual
   user of our app?

3. **Ninety-day ageing.** You noted released numbers do not return to the pool
   for ninety days. Under this model a lease ends and the number returns to
   *our* pool, still subscribed and still ours — nothing is released back to
   Vonage. Could you confirm the ageing period does not apply in that case, and
   that reassigning one of our own numbers to a new counterparty is not treated
   as a release and re-acquisition?

4. **US 10DLC.** With Ghostface as the only brand, rather than each consumer
   being registered separately, is this simply a single brand and campaign
   registration on our side? If so I think the objection about the three-month
   minimum campaign duration also falls away, since we are no longer rotating
   numbers between individual users.

Two things from the last email are unchanged by any of this, and they are now
the only items holding up our build:

5. **Hard exclusions (my question 7).** Still open, and it shapes our rollout
   more than anything else. Not the coverage list — the exceptions: countries
   where this kind of proxied number service is not permitted, and countries
   where it requires local presence or a local entity. Even an approximate list
   would let us plan.

6. **New Zealand.** Our home market, and in the first wave. It did not appear
   in the SMS+Voice combined list in your earlier answer. Could you confirm
   whether NZ virtual numbers support **both inbound SMS and inbound voice on
   the same number**, or whether that market needs separate numbers per
   capability?

Finally, as this now determines a build we are ready to commit to, I would
still like these confirmed by someone who can speak for Vonage contractually
rather than as general guidance — I am happy to be routed to compliance or
legal, or to have a short call if that is faster than email.

Could you also send the current rate card for virtual number subscriptions
(monthly recurring, by country) and for inbound SMS? The link you sent earlier
covered voice pricing only.

Thank you again for the detail in your first reply — it is the reason the
design changed, and changed for the better.

Kind regards,

Benjamin Henderson
Ghostface Limited
benjamin@ghostface.co.nz
