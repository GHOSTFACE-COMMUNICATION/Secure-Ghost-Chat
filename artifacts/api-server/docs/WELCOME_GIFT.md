# Welcome gift — server-side grant

Design, 28 Aug 2026. Not implemented.

## The problem, stated plainly

Onboarding tells every new user they have **won a free month** and then grants
nothing. There is no welcome-gift code on the server at all: the only writer of
`ghost_entitlements` is `routes/crypto.ts`, on the Solana/USDC payment path.

The comment in `app/onboarding.tsx` claiming "the actual entitlement grant +
one-per-account cap is enforced server-side once setup completes" is not true
and should not have been written as though it were.

Two further inaccuracies in the current client:

- **The odds are 100%.** `WELCOME_PRIZES[Math.floor(Math.random() * 3)]` has no
  losing outcome, while the copy says "a chance to win".
- **The client picks the prize.** If the client ever tells the server what it
  won, anyone can claim the most valuable prize by editing a request. The
  server must decide.

## Decide this first: gift or draw?

These are different products with different obligations, and the answer
changes everything below.

**A — guaranteed welcome gift.** Simplest and honest. Copy becomes "your
welcome gift". No odds to disclose, no promotional-competition rules, no
sweepstakes framing. **Recommended.**

**B — a genuine prize draw.** Brings in Apple's sweepstakes requirements (the
developer must be the sponsor, official rules published, legally permitted in
every territory the app ships to — and the stated intent is *all* of them) and,
in New Zealand, promotional-competition rules under the Gambling Act. This is
a question for MinterEllison, not for us; it is cheap to add to the live GF-01
thread and expensive to get wrong after launch.

**Do not ship "chance to win" language under option A**, and do not ship option
B without advice.

## What may be granted

`ghost_entitlements` models exactly one thing: `{ userId (PK), plan,
activeUntil }`, where `plan` is `specter` or `phantom` (see
`lib/solanaPayments.ts`). Term is `TERM_DAYS`, default 30.

- **SPECTER / PHANTOM** are software. Marginal cost is ~0, so they are safe to
  give away.
- **GHOST NUMBER must NOT be in the pool.** It is a recurring cash cost — a
  rented Vonage number plus SMS, every month, per user — and it is not even an
  entitlement `plan`; it has no representation in this table. It is also not
  yet known to be *permitted*: whether numbers may be assigned to individual
  end users at all is question 1 of the outstanding Vonage email
  (`compliance/vonage-reply-draft.md`). Granting it would be an unfunded
  liability on a model the supplier has not approved.

So the gift is a month of a software tier, and the prize table in the client
should lose its third entry.

## Endpoint

`POST /api/welcome-gift`

- **Authenticated.** Uses `checkAuth(req, res, "POST /welcome-gift", "query")`
  from `lib/auth.ts` — the same gate as blobs/ice-config/invites. Note this
  means it inherits `ENFORCE_ENDPOINT_AUTH`: while that flag is off the gate
  does not reject, so **this endpoint must check `auth.alias` is non-null and
  refuse otherwise**, rather than relying on the flag. An unauthenticated
  caller must never be able to grant an entitlement.
- **Server decides the plan.** The client sends nothing but its identity and
  displays whatever comes back.
- **Idempotent, one per account for ever.** Repeat calls return the same
  result and grant nothing further.
- Returns `{ plan, activeUntil, alreadyClaimed }`.

## Idempotency — the part that needs a decision

`ghost_entitlements.userId` is the primary key and is *also* written by the
payment path, so its existence cannot mean "gift already claimed": a paying
user has a row without ever having been given anything.

That needs a separate record. Options:

1. **New table `welcome_gifts (user_id PK, plan, granted_at)`.** Correct model,
   trivially idempotent via `onConflictDoNothing`, and auditable — you can
   answer "how many gifts have we given" without inference. **Recommended.**
2. A nullable `welcome_gift_granted_at` column on `identity_keys`. Fewer
   objects, but overloads an identity table with billing state.

⚠️ **Either is a schema change, and this repo has no migration files** — the
live schema is whatever the TS declares, and
`pnpm --filter @workspace/db push` diffs the **entire** schema against
production. The api-server CLAUDE.md is explicit that its blast radius is every
table. Do not run it casually to add this; prefer applying the one table by
hand against the Patroni leader via `DATABASE_PUBLIC_URL`, then let the TS
declaration document what exists — the same approach used for the pending
indexes on 24 Aug.

## Must not downgrade a paying user

Reuse the `ensureEntitlement` semantics already in `routes/crypto.ts`: never
overwrite an entitlement whose `activeUntil` is further out than the one being
written. Someone who pays for PHANTOM and then triggers the gift must not be
dropped to a shorter SPECTER term. The gift should extend, or no-op, but never
reduce.

## Where it is called from

At the end of onboarding, after the identity exists — the same point the invite
code is redeemed (`handleRecoveryContinue`). Like the invite, **a failure must
not block sign-up**: report it and continue. Nobody should be stuck on the last
screen of registration because a promotional grant timed out.

## Tests to write with it

- Grants once; a second call returns `alreadyClaimed` and writes nothing.
- Refuses an unauthenticated caller **even with `ENFORCE_ENDPOINT_AUTH` unset**.
- Does not downgrade a longer-lived existing entitlement.
- Concurrent calls grant exactly one (the PK conflict is the guard).
