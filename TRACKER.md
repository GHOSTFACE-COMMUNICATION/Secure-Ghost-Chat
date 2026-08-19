# GHOSTFACE — progress tracker

Working board for the whole project: business tasks (GF-xx), crypto audit,
release gates, engineering items. **Agents update this file as part of
completing work** — move rows, don't let it rot. STATUS.md holds narrative
session state; this holds the task board. Human-priority column is Benji's
to set.

Status legend: ✅ done · 🔄 in progress · ⏸ blocked/waiting · ⬜ not started

Last updated: 2026-08-19 (Claude Code session — call-hangup fix verified, committed, pushed)

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
| Call bug: hangup during ring leaves callee ringing + call bounces back | 🔄 client fixes in | Server fix live on Railway (`864a40f`). Re-test surfaced two client bugs: phantom "missed call" logged on the DIALING device (AppContext logged missed for ANY unmatched hangup) and zombie-join (CallKit answer navigates into a dead call for 30s, whose timeout hangup caused that phantom log). Fixed: missed only logged when a real incoming banner existed; new `lib/endedCalls.ts` TTL set marks every received hangup, checked by both answer paths + call.tsx mount. tsc clean, 89/89. **Needs: new TestFlight/dev build to test (client-side code), then repro re-test.** |
| Call page: no way to erase history | ✅ 19 Aug | `clearCallHistory()` in AppContext (persists empty encrypted blob, same write path) + trash icon with confirm on the CALL tab header. |
| Chat wallpaper: custom photo option | ✅ 19 Aug | PHOTO tile in the wallpaper sheet — picked image copied to app-private chat-bg/ dir, rendered full-bleed under a 55% black scrim for text legibility; DEFAULT/colour selection cleans up the old file. Image file is app-sandboxed but not encrypted (documented in Conversation.bgImageUri). Client-side — needs new build. |
| Disappearing messages: always on, 5s–7d, default 1h | ✅ 19 Aug | The TTL machinery already existed (envelope-carried ttlMs, read-based expiresAt, sweep). Change was policy: OFF option removed, 5s preset added, default 1h; existing conversations migrated on load; peer-synced timer values clamped to [5s, 7d] (old builds' "OFF" becomes 1h). clampDisappearSec in AppContext is the single enforcement point. Client-side — needs new build. |
| Local STATUS/TRACKER commits unpushed | ✅ 19 Aug | Pushed — `feat/push-notifications` now in sync with origin through `864a40f`. |
| pg_dumpall incident backups on disk | ✅ 19 Aug | Located and deleted `pre-rotation-dump-20260819.sql` (1.8MB, full cluster dump incl. role password hashes) + its `.stderr` sibling, found in Claude Code session `e968c7a2`'s scratchpad (`/private/tmp/claude-501/.../scratchpad/`). **Only 1 file found, not 2 as STATUS.md's "one per rotation" implied** — exhaustive search of home, /tmp, /var, and all session scratchpads on this Mac turned up nothing else. If a second dump exists it may be on a different machine/session already cleaned up; flag to Benji if that matters. |
| Legacy AD/plaintext tiers in secureStorage | ⏸ scheduled | Remove a release or two after 72 ships; unknown format then becomes a hard error (audit #6 follow-up). |

## Incidents

| Incident | Status |
|---|---|
| Postgres password rotation (19 Aug) | ✅ closed — zero-outage second rotation; credential canonical in secrets-store (`postgres-ha-cluster-password` v1). Runbook in STATUS.md. |
