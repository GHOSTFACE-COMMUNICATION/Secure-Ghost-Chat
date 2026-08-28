# Vonage — reply to onboarding email (SMS API + virtual numbers)

**SENT 27 Aug 2026** to aaron.lee@vonage.com from benjamin@ghostface.co.nz
(Gmail message id `1a046911af7a4b96`).

Sent as a NEW thread, not a reply: Aaron's message is not in the
benjamin@ghostface.co.nz mailbox — prior correspondence with him was from
Benji's personal mayyybachhh@icloud.com. A line was added to the top of the
sent email noting the address change so he can place it. Subject used:
"Re: Vonage SMS API and virtual numbers — GHOSTFACE / Ghostface Limited".

**Deliberately says nothing about the app's cryptography.** Export
classification is the open question with MinterEllison (GF-01) and no
characterisation of it should reach a vendor ahead of counsel's written
opinion. If Vonage sends a use-case or compliance questionnaire that asks
about encryption, treat it the way the ASC questionnaire was treated — pause
and check against the classification memo before answering.

**Target markets.** Benji's intent (27 Aug) is worldwide App Store
distribution. The code today only knows four countries — `COUNTRY_NAMES` in
`artifacts/api-server/src/routes/numbers.ts` lists NZ, AU, US, GB — so the
reply states global ambition while naming those four as the first wave, and
asks Vonage where number provisioning is restricted. Do not claim worldwide
number coverage we have not confirmed.

## ⚠️ Why question 1 matters more than the rest

Assigning carrier numbers to individual end users, and rotating them
automatically, is close to what many providers classify as sub-allocation or
resale. It is commonly restricted or requires a specific agreement. Several
jurisdictions also require the **end user's** verified identity and address
to hold a number, which sits awkwardly with an alias-only, no-PII product.

`lib/rotationScheduler.ts` rents and rotates numbers automatically
(`searchNumbers` → `rentNumber`), so if Vonage says this pattern is not
permitted, **GhostNumber needs rethinking before launch, not after**. Get the
answer in writing while it is still a sales conversation and cheap to change.

---

Subject: Re: Vonage SMS API and virtual numbers

Dear Aaron,

Thank you — that's helpful. I've been through the SMS features and virtual
number regulation pages.

Before we begin provisioning, I'd like to confirm a few points specific to
our use case so that we build to the right constraints rather than discover
them later:

1. **Use case.** GHOSTFACE is a privacy-focused mobile messaging app. We
   intend to subscribe virtual numbers and assign them to individual end
   users within the app, including rotating a user's number periodically.
   Can you confirm this is permitted under Vonage's acceptable use policy,
   and whether it is treated differently from standard A2P messaging?

2. **End-user KYC and address requirements.** Several of our target markets
   require proof of address or end-user identity to hold a virtual number.
   Where those apply, does the obligation sit with Vonage's customer (us) or
   with the end user, and what documentation would you need from us?

3. **Number rotation.** Is there a minimum rental term, or any charge or
   restriction on releasing and re-subscribing numbers on a regular cadence?

4. **Inbound capability.** We need inbound SMS on subscribed numbers, and
   inbound voice on a subset. Which of our target countries support both?

5. **Registration lead times.** For the US (10DLC / toll-free verification)
   and any market requiring sender ID pre-registration, what are typical
   approval timelines at the moment?

6. **Commercials.** We are pre-launch with low initial volume. Is there a
   minimum spend or commitment on virtual number subscriptions, and how does
   pricing move at volume?

7. **Coverage and exclusions.** We intend to distribute the app broadly
   rather than in a handful of markets. Could you point me to a current list
   of countries where you can supply virtual numbers, and flag those where
   assigning a number to an individual end user is not permitted at all, or
   requires local presence or a local entity? Knowing the hard exclusions up
   front matters more to us than the long tail of coverage.

Our first wave is New Zealand, Australia, the United Kingdom and the United
States, and we would like to plan the rollout beyond those against your
coverage and the restrictions in point 7.

I'm happy to complete a use-case questionnaire if that's the normal route.

Kind regards,
Benjamin Henderson
Ghostface Limited
benjamin@ghostface.co.nz

---

## Original message being replied to

From: Lee Shunda Aaron | Vonage | Sales Development Representative
(aaron.lee@vonage.com)

> Based on the information provided, you can basically start using Vonage's
> SMS API and subscribe to our virtual numbers. There are some regulations
> that you must abide in order to send SMS to the countries that you
> mentioned as well as subscribing to their virtual numbers. Check on the
> links and select the countries that you need:
> SMS's features and restrictions / Virtual numbers' features and regulations
>
> Once you have read and abide by the regulations from the local
> authorities, you may start sending SMS messages and subscribing the
> virtual numbers for calling.
>
> In case you have any technical queries, click the documentation link or
> raise a support request from the dashboard; the support team will advise
> you.
