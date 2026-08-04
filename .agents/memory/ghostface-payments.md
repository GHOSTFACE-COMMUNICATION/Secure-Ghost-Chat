---
name: GHOSTFACE payments
description: Why GHOSTFACE has no Stripe/card path and how the paywall is structured.
---

# GHOSTFACE payments

The paywall is **crypto-only** — USDC on Solana is the single payment path. There is no card/fiat option.

**Why:** Stripe was fully removed at the user's request because Stripe's deployment checklist was blocking publishing. The crypto path already covered the paywall, so card/fiat was dropped rather than maintained.

**How to apply:**
- Do not reintroduce a Stripe SDK, `/api/stripe/*` routes, a `payMethod` toggle, NZD/fiat pricing, or trial-banner UI in `paywall.tsx`.
- Backend payment surface is `/api/crypto/*` only.
- A `stripe:1.0.0` connector entry may still linger in `.replit [agent] integrations` — it is unused by any code and can only be detached by the user via the integrations pane (no agent tool removes it). It does not need code support.

## @solana/pay version pitfall

Verification uses the **classic `@solana/pay@0.2.x`** API (web3.js v1: `Connection`, `PublicKey`, `BigNumber`, `findReference`/`validateTransfer` with a `finality`/`commitment` option and BigNumber `amount`).

**Why:** `@solana/pay@1.x` (e.g. 1.0.17) is a full rewrite on `@solana/kit` (web3.js v2) — it takes an `Rpc` object and kit `Address`/`Amount` types, NOT `Connection`/`PublicKey`/`BigNumber`. Installing latest silently breaks all the classic-style verification code with confusing type errors (e.g. "BigNumber not assignable to number", "finality not in FindReferenceOptions").

**How to apply:** Pin `@solana/pay` to `0.2.5` and `bignumber.js` to `9.x` (so it dedupes to the instance `@solana/pay` bundles — a mismatched major triggers "separate declarations of private property `_isBigNumber`"). Do NOT bump `@solana/pay` to 1.x unless you migrate the whole flow to `@solana/kit`.
