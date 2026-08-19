# STATUS — living session state

Read this at the start of every session (Cowork or Claude Code); update it
before ending one. This file is the cross-session memory: if it's stale,
sessions re-derive context wrong.

Last updated: 2026-08-19 (Cowork session — repo cleanup, crypto-audit
verification loop, Postgres incident oversight)

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
- ⚠ Two local pg_dumpall backup files were taken during the incident
  (one per rotation). They contain full data AND role password hashes.
  Delete them or move them into encrypted storage — still pending, ask
  Benji where they were saved.
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
