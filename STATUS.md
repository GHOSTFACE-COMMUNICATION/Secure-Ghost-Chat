# STATUS — living session state

Read this at the start of every session (Cowork or Claude Code); update it
before ending one. This file is the cross-session memory: if it's stale,
sessions re-derive context wrong.

Last updated: 2026-08-19 (Cowork session — repo cleanup, crypto-audit
verification loop, Postgres incident oversight)

## 🔴 ACTIVE INCIDENT — Postgres password rotation, mid-recovery

The production Postgres HA cluster (Railway, Patroni + etcd + PgBouncer,
template `railwayapp-templates/postgres-ha`) is **paused mid-credential-
rotation**. Rotation was triggered after a password fragment leaked into a
session's tool output.

State at last update (post-Phase-0 ground truth via patronictl from
inside the cluster — earlier "lock on postgres-2" reading was transient
or misattributed):
- Topology: members are postgres-1 ("Postgres" service), postgres-2,
  postgres-3. **"Postgres HA" is the HAProxy/router, not a DB node.**
- `ALTER ROLE postgres` done — live DB has the NEW password.
- **The new password value lives in Railway vars**: Postgres-2's
  POSTGRES_PASSWORD/PGPASSWORD, api-server's DATABASE_URL, PgBouncer's
  vars. Recover from there; never printed anywhere.
- patronictl list: postgres-1 = Leader/running (TL4, lock is home),
  postgres-2 + postgres-3 = Replica "in archive recovery" (TL3) — WAL
  replay from the pgBackRest S3 archive, the fallback when streaming
  auth fails. Degraded but self-feeding; not data loss.
- Cluster paused (maintenance mode on); fresh pg_dumpall backup taken.
- Remaining work = revised plan Phases A–F handed to Claude Code:
  recover+verify password from vars → postgres-2 streaming → postgres-3
  vars+redeploy → postgres-1 vars (safe now, just a restart blip) →
  resume → cleanup (delete artifacts/api-server/_*-tmp scripts, restrict
  postgres-1's PUBLIC Patroni API domain, close this section).
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
