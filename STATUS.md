# STATUS — living session state

Read this at the start of every session (Cowork or Claude Code); update it
before ending one. This file is the cross-session memory: if it's stale,
sessions re-derive context wrong.

Last updated: 2026-08-22 (Cowork session — GF-01 US counsel outreach,
Gmail connector live, Google account recovered, Apple org migration
in flight)

## 22 Aug session changes

- **GF-01 outreach widened.** Emails sent 22 Aug from benjamin@ghostface.co.nz
  to two US encryption-export specialists: Olga Torres (olga@torrestradelaw.com,
  Torres Trade Law) and Lori Scheetz (lscheetz@wiley.law, Wiley Rein). Bounded
  ask: one-page opinion on §740.17(b)(1) mass-market self-classification vs
  CCATS re kdfRkPQ, fixed fee requested. MinterEllison (original 19 Aug
  enquiry) still silent — chase draft sits in Gmail drafts on that thread;
  one-time Cowork reminder fires Mon 24 Aug 9am NZT to check replies/nudge.
  (Earlier "chase Mon 25 Aug" was a date error; Monday is the 24th.)
- ⚠️ Copies of counsel emails were forwarded to jjules@xtra.com and
  jjules@xtra.co (two spellings). If the intended address is jjules@xtra.co.nz,
  both may have bounced or reached a stranger — verify.
- **Google account recovered** (was locked). Gmail connector authorized in
  Cowork; send-as alias benjamin@ghostface.co.nz confirmed working.
  Follow-ups from the lockout list still open: Vercel 2nd login method,
  CrazyDomains recovery, domain-expiry check.
- **Apple Developer: migrating Individual → Organisation (Ghostface
  Limited), still processing as of 22 Aug (~1 day).** Once cleared: check
  whether Team ID `98337579X8` changed and update CLAUDE.md's iOS
  identifiers; the org D-U-N-S number then also unblocks a Google Play
  **organisation** developer account (decided: org, matching Apple) —
  signup deliberately deferred until Apple verification clears.
- Cowork scheduled tasks created: daily 7am briefing, Monday 8am weekly
  roadmap, one-shot counsel-chase reminder (Mon 24 Aug).

## ⏳ OPEN LOOPS (as of last session)

- **Alias normalization vulnerability — FOUND AND FIXED (20 Aug).**
  `normalizeAlias()` used to silently strip decorated/Unicode "fancy font"
  characters instead of rejecting them, applied inconsistently between
  client and server. Onboarding never previewed the actual normalized
  alias before registration, so a user could type a stylized alias, watch
  it pass every visible check, and register under a totally different
  short ASCII fragment with no warning — which could collide with (or be
  probed for) an existing real account via the add-contact flow. Fixed:
  `normalizeAlias` now rejects (returns `null`) instead of stripping,
  enforced everywhere with a strict `^[A-Z0-9_]{3,20}$` allowlist (client
  keystroke filter in onboarding.tsx + shared normalizer used consistently
  across api-server's routes and ws/manager.ts). Verified independently:
  `tsc --noEmit` clean on both api-server and ghostface, api-server's
  vitest suite 53/1/0 (passed/skipped/failed), and a prod query
  (`SELECT user_id FROM identity_keys WHERE user_id !~
  '^[A-Z0-9_]{3,20}$'`) returned **zero rows** — no existing aliases
  needed grandfathering. Committed this session.

- **GF-01 counsel email — STILL UNSENT, highest priority.** Draft is
  ready (in chat history); ask Cowork to regenerate it. Send from Benji's
  iCloud address now — do NOT wait on the ghostface.co.nz mailbox. Asks
  two questions: US EAR self-classification vs CCATS, AND NZ strategic-
  goods / MFAT permit vs Wassenaar mass-market exemption. Attach the
  research memo + crypto inventory (in Benji's claude.ai project, not this
  repo). kdfRkPQ (bespoke KDF from standard primitives) is the crux for
  both regimes.
- **Account lockouts:** Google account locked; CrazyDomains (registrar for
  ghostface.co.nz) locked. Vercel is reachable (via Google device). Action:
  add a 2nd login method to Vercel before the Google session drops; start
  CrazyDomains ID recovery; CHECK DOMAIN EXPIRY (couldn't read whois from
  sandbox) — a locked registrar + expiring domain = losing the domain +
  api.ghostface.co.nz with it.
- **Company email setup — DONE (19 Aug):** iCloud Custom Email Domain for
  ghostface.co.nz verified; DNS records live in Vercel panel. Confirm the
  addresses (benjamin@ / support@ / legal@) exist and do one test-send to
  benjamin@ to prove delivery. Use benjamin@ghostface.co.nz on the counsel
  email from here on.
- ⚠ **Vercel access token was pasted into chat this session** (vcp_… ,
  redacted). Assistant refused to use it. Benji to REVOKE it (Vercel →
  Account Settings → Tokens) if not already done. Never paste secrets in
  chat; use a scoped, expiring token in a secrets store if automation is
  needed later.
- **Domain switch — VERIFIED SAME SERVICE (20 Aug), no eas.json change
  needed.** `api.ghostface.co.nz` and `api-server-production-b252.up.railway.app`
  are both domains on the same `api-server` service (Railway project
  `secure-ghost-chat-api`, confirmed via the Domains tab) — `/api/healthz`
  returns identical `{"status":"ok"}` on both. The earlier EAS submission
  401 (`8f390802...`) was root-caused separately: the upload/processing
  succeeded on Apple's side, but EAS's own status-polling loop outlived
  its ~20min App Store Connect JWT during a slow processing run — a
  client-side polling timeout, not a domain or credential problem.
- **Claude Code credits restored** — the prior out-of-credits block has
  cleared; this session ran normally.
- ⚠ **Ignored a suspicious command this session:**
  `curl -fsSL https://fx.sh/setup.sh | bash` — untrusted pipe-to-shell,
  not run. If it reappears, still don't.

## ✅ CLOSED INCIDENT — Postgres password rotation (2026-08-19)

## ✅ CLOSED INCIDENT — Postgres password rotation (2026-08-19)

Trigger: a password fragment leaked into a session's tool output. First
rotation attempt caused a degraded window (replicas fell back to
pgBackRest archive recovery; a transient wrong-node leader-lock reading
caused a pause + staged recovery). Cluster was fully recovered, then a
**second, clean rotation** was executed end-to-end with zero outage:
secrets-store write + read-back verify first, ALTER ROLE, PgBouncer
+13s / api-server +15s, then hand-edit patroni.yml + patronictl reload
on all three nodes (local trust auth means no restart needed — the
primary redeploy was never required). Final state verified: postgres-1
Leader/running TL4, postgres-2/3 streaming lag 0, live write test via
PgBouncer passed, api-server clean.

Durable facts:
- **Canonical credential location: secrets-store key
  `postgres-ha-cluster-password` (v1)** — with audit trail. Railway vars
  hold copies; the store is the source of truth.
- Topology: Patroni members are postgres-1 ("Postgres" service),
  postgres-2, postgres-3; **"Postgres HA" is the HAProxy/router, not a
  DB node**. Scope `postgres-ha`, 3× etcd, PgBouncer in front.
- Rotation runbook that works, zero-outage: secrets store first →
  ALTER ROLE → PgBouncer/api-server vars immediately (pre-staged) →
  per-node patroni.yml hand-edit + patronictl reload (NO redeploys, NO
  pause). Pause mode disables Patroni's own recovery — don't use it for
  rotations.
- Incident tmp scripts (artifacts/api-server/_*-tmp.*) deleted after
  close. The "public Patroni API domain" from an early readout could not
  be found on re-check — treat as misread, nothing to restrict.
- ✅ pg_dumpall backup cleanup done (19 Aug, Claude Code session): found
  and deleted `pre-rotation-dump-20260819.sql` (1.8MB cluster dump incl.
  role password hashes) + its `.stderr` sibling, sitting in Claude Code
  session `e968c7a2`'s scratchpad. Only one file turned up despite this
  note's original claim of two ("one per rotation") — exhaustive search
  of home, /tmp, /var, and every session scratchpad on this Mac found
  nothing else. If a second dump genuinely exists (different machine, or
  a session already cleaned up), it's still out there — flag to Benji.
- Seven `artifacts/api-server/_*-tmp.*` scripts are incident tooling from
  that session — untracked on purpose; delete after the incident closes.

## Crypto audit (docs at artifacts/ghostface/docs/AUDIT_FINDINGS.md)

Resolved, tested, pushed: **#1** (canonical AEAD AD), **#3** (PQ downgrade
rejection, REQUIRE_PQ), **#5** (CSPRNG chokepoint + boot assert),
**#6** (storage/message AD + migration tiers), **#7** (Stealth AD, GHX3,
permanent GHX2 decode), **#8** (Stealth passphrase required; decrypt keeps
default forever, default-key reveals labelled).

Open: **#2 and #4 — finding text was never delivered**; it exists only in
Benji's separate audit conversation on Claude.ai. Placeholders in
AUDIT_FINDINGS.md.

Test suite: `npm test` from `artifacts/ghostface/` — 89/89 at last run.
Typecheck: `npx tsc -p tsconfig.json --noEmit`, clean.

## Pre-ship gates for build 72 (all must pass before any EAS build)

1. **DB prekey check — PASSED 2026-08-19**: all 9 registered users have
   complete signing + PQ prekey material (query in the Claude Code
   session; re-run if new registrations happen before shipping).
2. **CSPRNG on-device smoke test — NOT DONE**: physical iOS + Android,
   clean install, verify clean boot (assert runs before router entry);
   plan approved, see session notes.
3. **TestFlight coordination — release note drafted, not published**: AD
   wire cutover means old↔new builds cannot exchange messages at all;
   mixed-window messages unrecoverable. Note text lives in the Cowork
   session; testers must update together.

## Workflow between the two Claudes

Benji runs Claude Code for implementation and pastes its reports into the
Cowork session, which independently verifies (re-runs tests, reads diffs,
checks claims against source) and hands back a one-liner instruction.
Pattern: investigate → report → wait for approval → code → verify → commit
→ push. Keep it.

## Repo housekeeping (done 2026-08-18/19)

- vault2fa moved out to `~/Projects/vault2fa` (own git, own remote).
- mockup-sandbox / ghostface-1 / SETUP-READ-ME-FIRST.md archived to
  `~/Projects/_archive/ghostface-clean-2026-08-18/` (110 UI mockup files
  live in mockup-sandbox — recoverable).
- pnpm-workspace.yaml now lists packages explicitly, no globs.
- CSR untracked from git (`ce8319c`); gitignore covers it now.
- Branch: `feat/push-notifications`, in sync with origin at last check.

## Broader GF tracker context (from project memory)

GF-01 export compliance: blocked on counsel referral, chase after 3–4
working days. GF-02: build-71 ASC questionnaire screenshots → crypto
inventory. GF-07: iOS build pre-flight ready; `eas submit` forbidden
(GF-11 ASC API key broken + export block). Never run EAS builds without
explicit go-ahead — costs real money.
