# GHOSTFACE — progress tracker

Working board for the whole project: business tasks (GF-xx), crypto audit,
release gates, engineering items. **Agents update this file as part of
completing work** — move rows, don't let it rot. STATUS.md holds narrative
session state; this holds the task board. Human-priority column is Benji's
to set.

Status legend: ✅ done · 🔄 in progress · ⏸ blocked/waiting · ⬜ not started

Last updated: 2026-08-19 (Cowork session)

## Business / legal (GF tracker)

| ID | Task | Status | Blocked on / next action |
|---|---|---|---|
| GF-01 | Export compliance (CCATS) — engage counsel | ⏸ waiting | Referral contact for export-compliance counsel; engagement email drafted, ready to send. Chase-up if 3–4 working days pass. **Blocks App Store submission.** |
| GF-02 | Crypto inventory | 🔄 | Append build-71 ASC questionnaire screenshots, then send with counsel engagement (GF-01). |
| GF-03 | GHOSTFACE word mark (IPONZ) | ✅ 11 Aug 2026 | Filed under Ghostface Limited, classes 9/38/42. |
| — | Hood-logo figurative mark | ⏸ waiting | File once figurative clearance opinion obtained. |
| — | CASPER wallet mark | ⏸ waiting | File separately after FMA advice. |
| GF-07 | iOS production build (build 72) | ⏸ blocked | Pre-flight checklist ready. Blocked by: GF-01 export block, GF-11 ASC key, and the three build-72 gates below. **Never run `eas build`/`eas submit` without explicit go-ahead.** |
| GF-11 | ASC API key regeneration | ⬜ | Key broken; regeneration steps already provided. Needed before any `eas submit`. |

## Crypto audit (detail: artifacts/ghostface/docs/AUDIT_FINDINGS.md)

| # | Finding | Status |
|---|---|---|
| 1 | Canonical AEAD associated data (Double Ratchet) | ✅ pushed |
| 2 | *(text never delivered — exists only in Benji's audit conversation)* | ⏸ waiting on Benji |
| 3 | PQ downgrade rejection (REQUIRE_PQ) | ✅ pushed |
| 4 | *(text never delivered — same as #2)* | ⏸ waiting on Benji |
| 5 | CSPRNG chokepoint + boot assert | ✅ pushed |
| 6 | Storage/message AD + migration tiers | ✅ pushed |
| 7 | Stealth AD (GHX3, permanent GHX2 decode) | ✅ pushed |
| 8 | Stealth passphrase required (no default key on encrypt) | ✅ pushed |

## Build-72 pre-ship gates (ALL must pass before any EAS build)

| Gate | Status | Next action |
|---|---|---|
| DB prekey completeness | ✅ 19 Aug | 9/9 users have PQ + signing material. Re-run query if anyone registers before shipping. |
| CSPRNG on-device smoke test | ⬜ | Physical iOS + Android, clean install, verify clean boot. Plan approved. Benji's devices required. |
| TestFlight coordination | 🔄 | Release note drafted (AD wire break: old↔new builds cannot message; update together). Publish with the build. |

## Engineering — open

| Item | Status | Next action |
|---|---|---|
| Call bug: hangup during ring leaves callee ringing + call bounces back | 🔄 fix written | `api-server/src/ws/manager.ts` + `callSignals.test.ts` done, tsc clean. **Run `npx vitest run` on host** (sandbox can't — mac-built node_modules). Green → commit `fix(api): deliver call-hangup to waking callees, drop stale parked call-rings` → push → deploy to Railway. |
| Local STATUS/TRACKER commits unpushed | 🔄 | `git push` from Benji's terminal (sandbox has no GitHub creds). |
| pg_dumpall incident backups on disk | ⬜ | Two files, contain full data + role hashes. Locate → delete or encrypt. |
| Legacy AD/plaintext tiers in secureStorage | ⏸ scheduled | Remove a release or two after 72 ships; unknown format then becomes a hard error (audit #6 follow-up). |

## Incidents

| Incident | Status |
|---|---|
| Postgres password rotation (19 Aug) | ✅ closed — zero-outage second rotation; credential canonical in secrets-store (`postgres-ha-cluster-password` v1). Runbook in STATUS.md. |
