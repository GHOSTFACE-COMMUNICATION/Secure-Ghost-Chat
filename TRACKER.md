# GHOSTFACE — progress tracker

Working board for the whole project: business tasks (GF-xx), crypto audit,
release gates, engineering items. **Agents update this file as part of
completing work** — move rows, don't let it rot. STATUS.md holds narrative
session state; this holds the task board. Human-priority column is Benji's
to set.

Status legend: ✅ done · 🔄 in progress · ⏸ blocked/waiting · ⬜ not started

Last updated: 2026-08-19 (Claude Code session — preview + production build 62 shipped, GF-01 marked resolved per Benji)

## Business / legal (GF tracker)

| ID | Task | Status | Blocked on / next action |
|---|---|---|---|
| GF-01 | Export compliance (CCATS) — engage counsel | ✅ 19 Aug (per Benji) | Benji reported this resolved mid-session; not independently verified by an agent (no counsel doc/confirmation seen). Confirm the paper trail before treating App Store submission as fully cleared. |
| GF-02 | Crypto inventory | 🔄 | Append build-71 ASC questionnaire screenshots, then send with counsel engagement (GF-01). |
| GF-03 | GHOSTFACE word mark (IPONZ) | ✅ 11 Aug 2026 | Filed under Ghostface Limited, classes 9/38/42. |
| — | Hood-logo figurative mark | ⏸ waiting | File once figurative clearance opinion obtained. |
| — | CASPER wallet mark | ⏸ waiting | File separately after FMA advice. |
| GF-07 | iOS production build (build 72) | 🔄 built, not submitted | Production build **62** completed 19 Aug (`b5342936-dcef-4755-9f16-da79d96a58c6`, buildNumber auto-incremented 61→62), run on Benji's explicit override of the still-open CSPRNG/TestFlight gates below — those gates are **not** cleared, only bypassed for this build. Artifact is the raw signed `.ipa` (`https://expo.dev/artifacts/eas/RRlfJZFtmjiTtugvfY4cVJUD7FW4gNkc34PgVyWOBIM.ipa`), store-distribution — **not directly installable**; reaching TestFlight/App Store needs `eas submit`, which stays off-limits without a separate explicit go-ahead. **Never run `eas build`/`eas submit` without explicit go-ahead.** |
| GF-11 | ASC API key regeneration | 🔄 possibly resolved — unconfirmed | Marked "broken" previously, but the 19 Aug production build's credential fetch line read "Using App Store Connect API Key from EAS credentials service" and succeeded without issue. Could mean the key already works for build-time profile fetch but still fails for `eas submit`'s different API scope — don't assume `eas submit` will succeed until actually tried. |

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
| Call bug: hangup during ring leaves callee ringing + call bounces back | 🔄 in preview/prod build 62 | Server fix live on Railway (`864a40f`). Re-test surfaced two client bugs: phantom "missed call" logged on the DIALING device (AppContext logged missed for ANY unmatched hangup) and zombie-join (CallKit answer navigates into a dead call for 30s, whose timeout hangup caused that phantom log). Fixed: missed only logged when a real incoming banner existed; new `lib/endedCalls.ts` TTL set marks every received hangup, checked by both answer paths + call.tsx mount. tsc clean, 89/89. Now shipped in preview build (`b2b9372d`) and production build 62 (`b5342936`) — **needs device repro re-test.** |
| Call page: no way to erase history | ✅ 19 Aug, in build 62 | `clearCallHistory()` in AppContext (persists empty encrypted blob, same write path) + trash icon with confirm on the CALL tab header. |
| Chat wallpaper: custom photo option | ✅ 19 Aug, in build 62 | PHOTO tile in the wallpaper sheet — picked image copied to app-private chat-bg/ dir, rendered full-bleed under a 55% black scrim for text legibility; DEFAULT/colour selection cleans up the old file. Image file is app-sandboxed but not encrypted (documented in Conversation.bgImageUri). |
| Disappearing messages: always on, 5s–7d, default 1h | ✅ 19 Aug, in build 62 | The TTL machinery already existed (envelope-carried ttlMs, read-based expiresAt, sweep). Change was policy: OFF option removed, 5s preset added, default 1h; existing conversations migrated on load; peer-synced timer values clamped to [5s, 7d] (old builds' "OFF" becomes 1h). clampDisappearSec in AppContext is the single enforcement point. |
| Local STATUS/TRACKER commits unpushed | ✅ 19 Aug | Pushed — `feat/push-notifications` now in sync with origin through `864a40f`. |
| pg_dumpall incident backups on disk | ✅ 19 Aug | Located and deleted `pre-rotation-dump-20260819.sql` (1.8MB, full cluster dump incl. role password hashes) + its `.stderr` sibling, found in Claude Code session `e968c7a2`'s scratchpad (`/private/tmp/claude-501/.../scratchpad/`). **Only 1 file found, not 2 as STATUS.md's "one per rotation" implied** — exhaustive search of home, /tmp, /var, and all session scratchpads on this Mac turned up nothing else. If a second dump exists it may be on a different machine/session already cleaned up; flag to Benji if that matters. |
| Legacy AD/plaintext tiers in secureStorage | ⏸ scheduled | Remove a release or two after 72 ships; unknown format then becomes a hard error (audit #6 follow-up). |

## Incidents

| Incident | Status |
|---|---|
| Postgres password rotation (19 Aug) | ✅ closed — zero-outage second rotation; credential canonical in secrets-store (`postgres-ha-cluster-password` v1). Runbook in STATUS.md. |
