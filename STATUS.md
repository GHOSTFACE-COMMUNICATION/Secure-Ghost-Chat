# STATUS — living session state

Read this at the start of every session (Cowork or Claude Code); update it
before ending one. This file is the cross-session memory: if it's stale,
sessions re-derive context wrong.

Last updated: 2026-09-04 (Claude Code — 🔴 **TWO NEW BLOCKERS, both above 90592, found by running the app on a simulator: (A) the app HARD-CRASHES at launch on iOS 27 — no `UIApplicationSceneManifest` and no scene lifecycle, so UIKit traps; verified iOS-27-only, it runs fine on 26.5. So a build 78 uploaded today would crash on launch for every iOS 27 tester — DO NOT upload until the scene fix lands. (B) the vendored WireGuard did not compile at all; fixed with one `#include <sys/types.h>` in `WireGuardKitC.h`, and that is the best candidate yet for build 77's failure. Needs a COMPLIANCE §4 row. Read the top section.** Also: 90592 re-checked a third time after the latest Support call — unchanged, and a version/build bump cannot clear it. Previously, same day: ⛔ **CORRECTION: build 77 already ran, it ERRORED, and its tree was `main` PLUS the unmerged split — so the split is NOT excluded from the failure, and the "build 77 unaffected" claim previously in this header was backwards. No artifact was produced, so 90592 was never reached; 77 is consumed and the next production build is 78. The two June declarations were re-read live today and are still stuck — do NOT run `eas submit`, it would be attempt 11 and would fail the same way. Read the top section first.** ⚠️ Also: the Replit-era duplicate now has a SECOND copy, inside an Xcode scratch project. Previously, same day: **`AppContext.tsx` phase-1 split done on branch `refactor/split-appcontext`, unmerged** (~~`main` untouched, build 77 unaffected~~ — retracted above). ⚠️ Also found: a Replit-era duplicate at `~/Downloads/Ghostface-Mobile` with bidirectionally-drifted app code — see the same section. Previously: 2026-09-03 (Claude Code — **90592 FIRED AGAIN after Apple Support said unblocked; their fix did not land and the declarations are untouched. `prepare_asc_api_key` is now closed after two clean runs.** Previously: **build 76 FAILED: `ghostzeronz-coder/wireguard-apple` is also 404, so build 75's tree is permanently unbuildable; `main` already vendors it. Apple Support say 90592 is unblocked — unverified, the declarations are unchanged. Next: build 77 from `main`.** Previously: **the GitHub remote was DEAD and the repo
was recreated**; read the 3 Sep section directly below first — the 2 Sep
"transfer to an organisation" never happened, 11 commits including CI were
unbacked-up, and PRs #1-#11 are permanently gone. Previous entry:
2026-09-01 (Claude Code — **COUNSEL'S REVISED MEMO ARRIVED and is
now the operative opinion**; read the section directly below it. Both open crypto
items are closed *inside the opinion body*, the classification is unchanged, and
counsel has given an explicit instruction confirming `ITSAppUsesNonExemptEncryption`
must be `true`. ⛔ **One thing goes back to Sarah: the memo's §4.17 states no third
party has ever received a build, and ASC shows an external public-link TestFlight
group open 31 Jul – 1 Sep.** Also this session: **ASC submission audit: the 90592 story
was under-recorded and two figures in this file were wrong.** Read the audit
section immediately below first — build 75 has EIGHT failed submissions, not
three, the failure mode CHANGED mid-morning on 31 Aug, ASC holds 66 accepted
builds rather than ten, and an EXTERNAL TestFlight public link has been live
since 31 Jul. ⚠️ **90592 is no longer the only thing between build 75 and
TestFlight** — the previous entry's claim to that effect is superseded. Then the
coturn section. Previously: **coturn hardened end to end and GF-01 closed**.
The compliance machinery now actually exists. **Build 75 is the first conforming build**: EAS
`22413bd1`, 1.0.2 / build 75, artifact `sOwNGmCL…ipa`, with compiled
`ITSAppUsesNonExemptEncryption` = **`true`** — verified by reading the
`Info.plist` out of the `.ipa`, the same way builds 63 and 74 were disproved. It
also carries `c1657d0` (4002 kick-loop stand-down) and `0278b41` (VoIP listeners
before PushKit), so it is the build that tests whether the kick loop was behind
the stale-ring drops.

---

## 4 Sep 2026 — 🔴 TWO NEW BLOCKERS found by building locally for the simulator

Ran the app on a simulator for the first time in this record, via
`ios:sim:build`. It produced **two findings that both outrank 90592**, and one
of them means **build 78 must not be uploaded as-is**.

### 🔴 BLOCKER A — the app HARD-CRASHES at launch on iOS 27

`com.ghostface.app` **traps 2.4s after launch on iOS 27.0**, before any JS runs.
Crash `~/Library/Logs/DiagnosticReports/GHOSTFACE-2026-09-04-102218.ips`:

- **`EXC_BREAKPOINT` / `SIGTRAP`**, faulting thread 0, top frame
  **`__UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke`**
  (UIKitCore), reached from `-[UIApplication workspace:didCreateScene:…]`.

**Cause — confirmed against Apple's own docs, not guessed.**
*Transitioning to the UIKit scene-based life cycle → "Determine if your app
needs to migrate"* says migration is required if **either** the
`UIApplicationSceneManifest` key is missing **or** the app delegate doesn't
implement `application(_:configurationForConnecting:options:)`. **GHOSTFACE
fails both:** `UIApplicationSceneManifest` is absent from the built
`Info.plist`, from `ios/GHOSTFACE/Info.plist` **and** from `app.json`, and
`ios/GHOSTFACE/AppDelegate.swift` has no scene methods at all. **iOS 27 turned
that runtime issue into a fatal trap.**

✅ **It is iOS-27-specific — verified by bisecting simulators.** The same binary
**launches and stays up on iOS 26.5** (pid survived >60s, JS bundle loaded, lock
screen rendered). So this is new OS enforcement, not a regression in our code,
and it is **why builds 74/75 were fine in TestFlight** on older iOS.

⛔ **Consequence for the upload plan: a build 78 shipped today would crash on
launch for every iOS 27 tester.** That is worse than shipping nothing. **The
scene-lifecycle fix has to land before any resubmission.**

#### 🔬 The manifest-only fix was TESTED and it is NOT sufficient

Added `UIApplicationSceneManifest` (single-scene,
`UIApplicationSupportsMultipleScenes: false`, one
`UIWindowSceneSessionRoleApplication` configuration named "Default
Configuration") straight into the built app's `Info.plist` and reinstalled —
**verified present in the installed container before testing.** Result:

- ✅ **The trap is gone.** The app no longer crashes; the process survives
  indefinitely (checked across two launches, one warm and one cold).
- 🔴 **But the app renders NOTHING.** On a cold launch the framebuffer below the
  status bar is **pure black — mean brightness 0.00, exactly 1 distinct colour**,
  and the accessibility hierarchy contains **no `Window` node at all**: the dump
  is just `Application, pid: …, label: 'GHOSTFACE'` with zero children. No red
  box, no error overlay — React Native never mounts anything.

**Cause.** `ios/GHOSTFACE/AppDelegate.swift` builds its own window with
**`window = UIWindow(frame: UIScreen.main.bounds)`** (line 26) in
`didFinishLaunchingWithOptions`. In a scene-adopting app that window is never
associated with the `UIWindowScene`, so it is never presented. **Declaring
scenes without moving window creation into the scene is a swap of one bug for a
worse one: a crash becomes a silent blank app.**

⛔ **So the real fix is the delegate side, not the plist.** Window creation has to
move to `scene(_:willConnectTo:options:)` on a `UIWindowSceneDelegate`. ⚠️ **And
that file is generated** — `ios/` is gitignored and Expo CNG rewrites
`AppDelegate.swift`, so this **cannot** be fixed by editing it directly. It
needs either an Expo/React Native version that adopts scenes upstream, or a
config plugin that patches the delegate. **Neither is scoped yet, and `expo`
54.0.35 / RN 0.81.5 show no `UIWindowSceneDelegate` or
`configurationForConnecting` anywhere in their AppDelegate sources.** This is
bigger than a config tweak — treat it as real work, and note the
`xcode-integration:uikit-app-modernization` skill targets exactly this
(`UIScreen.main` and scene lifecycle).

✅ **Nothing was committed from this experiment** — the manifest went only into
the throwaway built `.app`; `app.json` is untouched.

### ✅ BLOCKER B — the vendored WireGuard did not compile, and it is now fixed

`native/wireguard-apple/Sources/WireGuardKitC/WireGuardKitC.h` **failed to
build** under explicit Clang modules:

> error: declaration of `u_int32_t` must be imported from module
> `_DarwinFoundation1.unsigned_types.u_int32_t` before it is required
> … `could not build Objective-C module 'WireGuardKitC'`

The header redeclares `struct ctl_info` / `struct sockaddr_ctl` from
`<sys/kern_control.h>` using the BSD `u_int32_t` / `u_char` / `u_int16_t`
typedefs, and **upstream relies on those arriving implicitly**. Fixed by adding
**`#include <sys/types.h>`** — 5 lines, comment included. **BUILD SUCCEEDED**
after it, WireGuardKit / WireGuardKitC / WireGuardKitGo / WireGuardGoBridge all
compiling from the vendored copy.

⚠️ **COMPLIANCE.md §5 note — this is a nonzero diff against vendored crypto
source and needs a §4 row before a build ships.** It is **not** a material
change to cryptographic functionality: no algorithm, protocol or behaviour
changes, only type visibility at compile time. Same character as the AEAD
correction counsel cleared in memo §4.15–4.17 as "a routine implementation
correction". **Recording it is required; counsel almost certainly is not, but
that call is Benji's.**

🔍 **This is the best candidate yet for why build 77 errored** — it is a
compile-time failure in the exact code build 77 was meant to be testing, and
77's 4m30s is consistent with dying in compilation rather than at package
resolution (build 76's 2m29s). ⚠️ **Still not confirmed:** build 77's Xcode
logs were **not** read, and whether EAS's Xcode enforces explicit modules the
way local Xcode-beta 27 does is **unverified**. Do not write this up as the
cause without reading the log.

### The working simulator loop, for next time

```
cd artifacts/ghostface
xcodebuild -workspace ios/GHOSTFACE.xcworkspace -scheme GHOSTFACE \
  -sdk iphonesimulator -configuration Debug ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  IPHONEOS_DEPLOYMENT_TARGET=16.0 CLANG_ENABLE_EXPLICIT_MODULES=NO \
  SWIFT_ENABLE_EXPLICIT_MODULES=NO CODE_SIGNING_ALLOWED=NO build
xcrun simctl install <udid> <DerivedData>/Debug-iphonesimulator/GHOSTFACE.app
pnpm exec expo start --port 8081        # dev client needs Metro
xcrun simctl openurl <udid> "ghostface://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

🪤 **`IPHONEOS_DEPLOYMENT_TARGET=16.0` on the command line is required**, and the
committed `ios:sim:build` script omits it. Without it five *resource-bundle* pod
targets fail the iOS 27 SDK's 15.0 floor — `SDWebImage` (9.0),
`RNSVG-RNSVGFilters` (12.4), `RevenueCat` and `PurchasesHybridCommon` (13.0),
`RNCAsyncStorage_resources` (13.4). The app's own target is 16.0, so raising the
floor lowers nothing. ⚠️ `ios/` is **gitignored** (Expo CNG regenerates it), so
this cannot be fixed by editing `ios/Podfile` — it needs a `post_install` hook
in the Expo config plugin, or the flag on the command line.

⚠️ **Expected noise in an unsigned local build:** `expo-secure-store` throws
*"A required entitlement isn't present"* for keychain reads
(`getValueWithKeyAsync`), surfacing as `[AppContext] Failed to load persisted
state`. That is `CODE_SIGNING_ALLOWED=NO` with no embedded entitlements — **not
an app defect.** The lock screen still renders.

### 90592, checked a third time today — still unchanged

Both June declarations re-read live again after the latest Apple Support call:
`e4bdc6a7…` and `2cb25cc0…`, still `CREATED`, `codeValue: null`, France `true`,
no document. ⛔ **A version or build-number bump CANNOT clear this** — the
declarations are attached to the **app**, not to a version or a build, which
this file has recorded since 1 Sep and the API confirms again. Support has now
given the "raise the build number" instruction twice; build 76 already tested it
and it was a red herring. **The ASC UI / Developer Support route is still the
only one.**

---

## 4 Sep 2026 — CORRECTION: build 77 already ran, it ERRORED, and it carried the unmerged split

⛔ **Two claims made earlier today in this file are wrong and are retracted
here:** the header's "**`main` untouched, build 77 unaffected**", and
"**NEXT: build 77 from `main`**" in the 3 Sep build-76 section. Build 77 **has
already been run**, it **errored**, and its tree was **not `main`** — it was
`main` plus the unmerged phase-1 split.

**Read live off the EAS API, 4 Sep** (`eas build:list -p ios --limit 6`):

| | Build 77 |
|---|---|
| EAS id | `a49a79ed-7314-4940-bcba-c414231fdcbc` |
| Build number / version | **77** / 1.0.2 |
| Profile / distribution | `production` / `store` |
| Commit | **`3f1ef9ce1b75330acf56d65e750f2d3c5e4fdd43`** |
| Status | 🔴 **errored** |
| Ran | 4 Sep 04:35:09 → 04:39:39 local (**4m30s**) |
| Artifact | **none** — `Application Archive URL: null` |

🔴 **The build tree was `main` + the split commit.** `3f1ef9ce` is the tip of
`refactor/split-appcontext`, and `git branch -a --contains` puts it on **that
branch only** — not on `main`, whose tip is
`eee449b68da2307fa125c1e399ee761c425e0f52`. But the containment runs the other
way too: **`git log 3f1ef9ce..main` is EMPTY and `main..3f1ef9ce` is exactly
ONE commit.** So the build carried everything on `main` *plus* the split.

⛔ **Consequence — the split is NOT excluded from build 77's failure.** The
retracted header line had it backwards: the split commit **is the build's own
tip**. Everything `main` was supposed to be testing did ship in it — the
vendored WireGuard (`c246fc8`, `94b3f0e`) and `b6a3113` (peer identity pinning)
are all ancestors of `3f1ef9ce`, and `artifacts/ghostface/native/wireguard-apple/`
is present in that tree — but so is a refactor that was deliberately supposed
to stay out of the build. **Whoever reads build 77's logs must treat the split
as a live suspect, not as absent.**

⚠️ **The failure reason is NOT established.** `eas build:view` carries no error
text for this build, and the Xcode logs were **not read** this session. The only
signal is duration: **4m30s**, against build 76's **2m29s** (which died at
`-resolvePackageDependencies`) and build 75's **8m14s** success. Running longer
than 76 is *consistent with* clearing package resolution, i.e. with the
vendoring having worked — **but that is an inference from a clock, not a
diagnosis. Read the logs before believing it.**
Logs: `https://expo.dev/accounts/ghost_face/projects/mayybachh/builds/a49a79ed-7314-4940-bcba-c414231fdcbc`

**What is still unrun, precisely:**

- **Vendored WireGuard in a production build — ATTEMPTED, INCONCLUSIVE.** Not
  "never attempted" as the 3 Sep section says; attempted in 77, result unread.
- **90592 — UNTOUCHED by build 77.** No artifact means no submission was
  possible and Apple was never reached. The 3 Sep expectation that 77 would
  "test the vendored WireGuard and 90592 at once" **did not happen.**

⏳ **77 is consumed. The next production build is 78.**

### 90592 re-verified live, 4 Sep — both declarations still stuck

Re-read off the ASC API (key `WD424K32M4`,
`/v1/appEncryptionDeclarations?filter[app]=6781518828`, HTTP 200) —
**unchanged from 1 and 3 Sep**:

| Declaration | Created | State | Code | Exempt | France | Doc |
|---|---|---|---|---|---|---|
| `e4bdc6a7-7013-4a0c-b91c-21fb7766af56` | 19 Jun 2026 | `CREATED` | `null` | `false` | `true` | `null` |
| `2cb25cc0-c76e-429f-9d10-260946eda9af` | 18 Jun 2026 | `CREATED` | `null` | `false` | `true` | `null` |

**Apple Support's fix still has not landed**, now a day after the 3 Sep
re-confirmation and four days after the call. Nothing on the record has moved
since 18/19 June. GF-15's escalation is still the whole path, and it is still
**ASC UI or Developer Support only**.

⛔ **Do NOT run `eas submit` while these stand.** A submit today would be
**attempt 11** against build 75 and would fail with 90592 in about a minute,
exactly as the previous ten did. **There is nothing newer to submit** — builds
76 and 77 both errored and produced no artifact.

✅ **Build 75 is still the only shippable artifact.** Re-read 4 Sep:
`22413bd1-7944-4338-aeb1-77efb86233fb`, status `finished`, commit `1e3cec1`,
fingerprint `a8c7e75a1d2dc2d72bb81689e310c412279960b5`, and
`Application Archive URL` **non-null**
(`sOwNGmCLEey2RB62CcBOZEKIUdOGntf8hnQy_Tq0sHs.ipa`). ⚠️ **A non-null URL is a
weaker check than 1 Sep's HTTP 206** — a range request was **not** re-run.
Expiry unchanged: **30 Sep**.

⚠️ **`1e3cec1` IS an ancestor of `main`, 48 commits behind its tip.** So build
75 is not off-trunk, it is simply *old* — and it predates the WireGuard
vendoring, which is exactly why its tree cannot be rebuilt.

### A SECOND copy of the Replit-era duplicate

⚠️ The duplicate recorded below at `~/Downloads/Ghostface-Mobile` **still
exists, and a second copy of it now sits inside an Xcode scratch project**:
`~/Library/Developer/Xcode/UntitledProjects/Untitled Project/Ghostface-Mobile`.
**Both are at the same tip, `4aa531d42bdc68d3f5be63b38e1f78fb86d066ef`**, both
carry only `ssh.riker.replit.dev` and `gitsafe-backup` remotes, and **neither
has a GitHub origin**. Same rule as below: no shared ancestor with `main`,
**never `git merge`** — port by hand or discard, and that is Benji's call. The
Xcode project holding it is unrelated scratch work; its `MyApp` target is the
stock SwiftUI "Hello, world!" template and builds and runs fine.

🪤 **Tooling note:** `eas build:view` **rejects `--non-interactive`**
("Nonexistent flag") although `eas build:list` accepts it.

---

## 4 Sep 2026 — AppContext.tsx split (phase 1), and a drifted Replit-era copy in ~/Downloads

⛔ **Correction, see the section above: the claim in this section that the split
was kept out of the pending build is WRONG — build 77 was built from
`3f1ef9ce`, this branch's tip, so the split WAS in it.**

✅ **`context/AppContext.tsx` went 5,370 → 4,808 lines** on branch
`refactor/split-appcontext` (not merged to `main` — ~~deliberately, while build
77 is pending~~ **but build 77 was nonetheless built FROM this branch; see the
correction above**). Three new modules, all verbatim extractions with `AppContext` still
re-exporting every previously-exported name, so none of the ~29 importing
files changed: `lib/envelope.ts` (sealed-sender envelope v4 machinery —
pure, no RN imports, now directly unit-testable), `context/types.ts` (domain
types), `context/defaults.ts` (disappear policy, `VPN_SERVERS`, signal sets,
default factories). **Crypto text untouched** — key-generation/registration
helpers stayed in AppContext so the COMPLIANCE.md §5 "crypto diff zero"
gate holds; `lib/doubleRatchet.ts` was not split for the same reason. The
`AppProvider` body (~3,800 lines) is phase 2 — splitting it into domain
contexts changes re-render behaviour and wants its own review. Verified:
typecheck exit 0, **142/142 tests**, lint delta zero (the three pre-existing
`no-empty` errors moved to lines 1092/1752/1764 — TRACKER's lint row notes it).

⚠️ **A Replit-era duplicate exists at `~/Downloads/Ghostface-Mobile`** (all
git remotes point at `ssh.riker.replit.dev`; `.replit` config present — same
family as the deleted `Secure-Ghost-Chat` copy). **The drift is
bidirectional**: it carries 3–4 Sep commits ("health check tests and push
notification logic", "multiline signing keys guide") and files this repo
lacks (`components/QRCode.tsx`, `GhostRevealMark.web.tsx`), while this repo
is newer elsewhere (e.g. `tokens.ts`). Nothing was taken from it and nothing
deleted. **If it holds wanted work it must be MANUALLY ported** — Replit
lines share no git ancestor with `main` (see repo CLAUDE.md); never `git
merge`. Whether to port or discard is Benji's call.

---

## 3 Sep 2026 — 90592 FIRED AGAIN after Apple Support said "unblocked"

🔴 **Support's fix has not landed.** Submission
`03acac86-e75b-430c-b474-801bc21a867e` (build 75, `22413bd1`) ran 3 Sep
22:57:27→22:58:15 — **48 seconds** — and failed with **90592 again**.

⚠️ **Provenance:** the 90592 identification is **Benji's read of the submission
log**, reported verbatim as "same error". It was **not** read off the API by this
session — EAS exposes no `submit:logs`, `submit:view` carries no error text, and
the log URL needs a session token. Recorded as reported, not as independently
verified.

**This closes the question the call opened.** Support said by phone that builds
were unblocked and that the build number had to increase. Neither held:

- **The declarations never changed.** Re-read live before and after the call —
  `e4bdc6a7` and `2cb25cc0`, both still `CREATED`, `codeValue: null`,
  `availableOnFrenchStore: true`, `documentUrl: null`.
- **The build-number instruction was a red herring.** ASC's highest 1.0.2 build
  is **74** and build 75 was never in ASC, so 75 was already higher *and* unused.
  Build 76 was attempted anyway and died for an unrelated reason (the missing
  `wireguard-apple` repo, see the section below).

✅ **One blocker can now be closed: `prepare_asc_api_key`.** Credentials
resolved cleanly on this run and on the 1 Sep re-run — *"Using Api Key ID:
2JQFNUQ274"*, `Key Source: EAS servers`. **Two consecutive non-reproductions.**

⛔ **The cause is unchanged and unchanged-able by us:** the two June declarations
sit on the app record, the API refuses `DELETE` (403; allowed operations are
`CREATE, GET_COLLECTION, GET_INSTANCE`, no `UPDATE`), and the ASC UI shows them
as **"Upload Failed"** with no removal control. **Back to Apple Support, naming
the two UUIDs and citing this failed submission as evidence the first fix did
not take.** ⏳ 26 days of artifact life left.

---

## 3 Sep 2026 — build 76 failed: a SECOND missing repo broke the iOS build

🔴 **`ghostzeronz-coder/wireguard-apple` returns 404.** Build 75's tree resolved
WireGuard as a Swift Package from that fork URL during prebuild, so **no tree at
or before `1e3cec1` can ever be built again.** Same account and same shape as the
`Secure-Ghost-Chat` loss; **whether one event caused both is not established.**

**How it surfaced.** Apple Support told Benji by phone that builds are unblocked
and that the build number must increase, so build 76 was run from `1e3cec1` —
byte-identical to build 75, so the only difference would be the number. It
**errored in 2m29s** (`704b67d7-ebea-4422-9eb3-435165639710`, buildNumber 76)
where build 75 took 8m14s from that same tree on 30 Aug. From the Xcode logs:

> Fetching from https://github.com/ghostzeronz-coder/wireguard-apple
> Failed to clone repository … fatal: could not read Username for
> 'https://github.com': terminal prompts disabled
> xcodebuild: error: Could not resolve package dependencies — exit status 74

✅ **`main` already carries the fix, and it was mis-assessed here first.**
`c246fc8` vendored the source to `artifacts/ghostface/native/wireguard-apple/`
and `94b3f0e` pointed `scripts/link-wireguard-kit.mjs` at it. Those two commits
were argued in this session as *risk* when picking a build tree; they are the
repair. The isolation argument for building off `1e3cec1` was wrong.

⏳ **Consequence:** build 75's `.ipa` (expires 30 Sep) is the only shippable copy
of that code and cannot be regenerated.

### On 90592 itself — unverified

Support say unblocked. **The API disagrees, or at least does not show it:** both
declarations re-read live on 3 Sep are still `CREATED`, `codeValue: null`,
`availableOnFrenchStore: true`, `documentUrl: null`. And the "higher build
number" instruction is not supported by the record — ASC's highest 1.0.2 build
is **74** and **build 75 is not in ASC at all**, so 75 was already higher and
unused. Whether 90592 still fires is now the only open test.

⛔ **SUPERSEDED 4 Sep — see the correction section at the top of this file.**
~~**NEXT: build 77 from `main`** (76 consumed). It will test the vendored
WireGuard and 90592 at once — unavoidable now.~~ **What actually happened:**
build 77 was run from `3f1ef9ce`, the tip of the unmerged
`refactor/split-appcontext` (= `main` + the phase-1 split), and it **errored**
with no artifact. So it tested neither cleanly: the WireGuard result is unread,
90592 was never reached, and the split is an extra uncontrolled variable.
**77 is consumed; the next production build is 78.** Still ships `b6a3113`
(peer identity keys pinned), a wire-compat change against builds 74/75:
release note needed.

---

## 3 Sep 2026 — the GitHub remote: the 2 Sep transfer never happened

⛔ **`4b2a919` recorded the repo as "moved to an organisation on 2 Sep 2026". It
had not moved.** `ghostzeronz-coder/Secure-Ghost-Chat` returned a hard 404 with
**no `Location` redirect** — GitHub preserves redirects across both renames and
transfers, so nothing was forwarding. Read as an org **admin**,
`/orgs/GHOSTFACE-COMMUNICATION` reported `public_repos: 0`,
`total_private_repos: 0`, `owned_private_repos: 0`. Those are the org's own
counts, not a listing an OAuth restriction could have filtered — so this was
deletion, not a permissions artefact. The org (created 24 Aug 2026) was empty.

**The canonical repo had no reachable remote, with 11 unpushed commits
existing only on this disk** — including `1c588d9` (the CI verify workflow) and
the WireGuard vendoring fixes `c246fc8` / `94b3f0e`. **Bounded by the
`refs/remotes/origin/main` reflog:** last successful push to the old repo was
`d0916a7` at **1 Sep 22:02:22 -0700**; the new remote received `main` at
**2 Sep 19:40:10 -0700**. So the deletion happened inside that 21h38m window and
the exposure was **at most 21h38m**. The exact deletion time is not recoverable
from here — GitHub exposes no API for it.

### Recreated and pushed, 3 Sep 2026

`GHOSTFACE-COMMUNICATION/Secure-Ghost-Chat`, **private**, on Benji's explicit
instruction. Before pushing, the ref graph was checked: `origin/feat/push-notifications`
was an ancestor of `main`, `devtest` held 1 unique commit, and
`git log --all --not main devtest <all tags>` was **empty** — so `main` +
`devtest` + the 12 tags preserve every commit in the repository. All three
pushed; `main...origin/main` now shows no divergence.

✅ **CI verified live, not just present:** the push fired one `verify` run on
`94b3f0e` — **completed, success**. Repo Actions permissions are
`enabled: true`. This matters because a file existing is exactly the check that
missed `check:handshake` sitting dead for 13 days.

🔴 **PRs #1–#11 are gone permanently — records only, no code lost.** Every
commit survives on `main` and the `archive/*` tags, and the four Railway-agent
PRs (#8/#9/#10/#11) were **merged 29 Aug**, so nothing is stranded. What is
gone is the review history: PR descriptions, review comments and issue threads.
⚠️ TRACKER's 29 Aug header line still calls those four "unmerged"; the row
itself (correctly) records all four merged and deployed.

### Restore attempted 3 Sep 2026 and FAILED — do not retry

⛔ **PRs #1–#11 are unrecoverable. This was tried properly; the answer is no.**

GitHub allows self-serve restore within 90 days (Settings → Repositories →
Deleted repositories) and deletion was 2 Sep, so the window was wide open.
**The real repo was not in that list.** What the list held was the pile of
abandoned same-name shells CLAUDE.md warns about. Six were restored while
looking: `GF`, `Secure-Ghost-Chat2`, `Secure-Ghost-Chat1`,
`Secure-Ghost-Chat1111`, `Secure-Ghost-Chat-1`, `Secure-Ghost-Chat-`.
**Every one is empty** — five have zero branches, none contains `d0916a7`, and
their `pushed_at` values (4 Jun – 8 Aug) survived the restore, which is the
proof none ever received the 1 Sep push. A seventh, a 7 Jun stub whose entire
content was a 20-byte `README.md`, was restored into the
`Secure-Ghost-Chat` name itself, then renamed and deleted to free it.

⚠️ **Renaming does not free a name.** Each rename leaves a redirect that
answers HTTP 200 and belongs to the repo, so the name is only released when the
repo is deleted. `ghostzeronz-coder/Secure-Ghost-Chat` is now a clean 404 with
no redirect.

⚠️ **A second machine was checked and does not hold the repo either.**

**Most probable explanation, not established:** the repo was transferred to an
organisation on 2 Sep and that organisation was then deleted. A repo dies with
its org, leaves no redirect, and never enters the personal deleted list — which
matches every symptom, including the absent redirect on the very first check.

🧹 **Cleanup owed:** those six restored shells are still on the account and
**`GF` and `Secure-Ghost-Chat-1` are PUBLIC**. Delete them.

**No code was ever at risk** — every commit is on the org remote, CI green.
What is gone is PR descriptions, review comments and issue threads.

⚠️ **`feat/push-notifications` was deliberately not recreated** — it is fully
contained in `main`, and `main` has been the trunk since the 29 Aug collapse.

⚠️ **The `gh` token holds `delete_repo` scope.** How the old repo came to be
deleted is not established; this is noted, not concluded.

---

## 2 Sep 2026 — COUNSEL'S REVISED MEMO (Version 2) — the operative opinion

📄 **Archived** to `~/Documents/Ghostface-Legal/1056841-export-control/2026-09-02_Counsel_Memo_REVISED_v2.pdf`
(SHA-256 `1a282e8d24b858e6822e996dc69ccfe064a3be96c9f00115ed91898ebb38bce9`).
MinterEllisonRuddWatts, matter 1056841, Salmond / Vaughan-Jones, 2 September 2026.
**Cite this version, not the 31 August one**, which it supersedes.

### Classification unchanged, and both open items are now closed in the opinion body

**ECCN 5D992.c**, self-classify under §740.17(b)(1), **no CCATS**, **no MFAT
permit**, **distribution may resume** (§2.1, §6.1, §7.2).

- ✅ **argon2id — §4.12–4.14.** "Published and widely used… standardised in
  RFC 9106", applied conventionally, "performs no encryption". **"We do not
  consider the inclusion of Argon2id to affect the classification conclusions."**
  Now also listed in the memo's own algorithm table at §4.3(h). Stronger than
  the 31 Aug email, which it replaces.
- ✅ **AEAD associated-data correction — §4.15–4.17.** "A routine implementation
  correction rather than a material change… we do not consider this to require
  the classification analysis to be revisited." **§4.17 records the timing
  correctly by itself** — committed 19 Aug, present in the 29–30 Aug builds,
  "already in effect before the matter was raised with us" — so the timing
  disclosure this file has been carrying as an open obligation is **discharged**.
- ✅ **kdfRkPQ — §4.10–4.11.** Standard HKDF-SHA256 over X25519 and ML-KEM-768
  secrets; "does not, in and of itself, require separate classification by BIS."

### It settles the flag argument, with counsel's own words

**§7.8:** Ghostface "should ensure that the App Store export-compliance
questionnaire responses and the `ITSAppUsesNonExemptEncryption` build setting
**accurately reflect that the Application uses encryption**, while noting that an
applicable export-control exemption is relied upon."

**That is now an explicit instruction, not an inference.** Build 75's `true` is
correct and `lib/exportCompliance.test.ts` has a directly citable authority.

### Counsel independently reached our 90592 diagnosis

**§7.7(a):** the July upload failures "appear to have arisen from an apparent
mismatch between the Application's build configuration and the export compliance
documentation previously recorded in Apple's systems, **rather than from any
substantive assessment by Apple** regarding the product's export classification."

**§7.6(a)** records the two June declarations as **"both 'Upload Failed', June 18
and 19, 2026"** — matching the ASC UI screenshot and the API read exactly.
**§2.1(c)(ii)** instructs Ghostface to "review and update any App Store
export-compliance declarations to reflect this opinion's conclusions" — **usable
in the Apple Developer Support request** as a counsel-directed reason to clear
them.

### ⛔ One correction owed to counsel, and it is material

**§4.17 states as fact:** "Distribution of those builds has been limited to
internal TestFlight testing on the director's own Apple IDs, and **no third party
has received any build**." §7.6(f) and §7.7(b) repeat it for build 63.

**ASC does not support that in full.** Beta group **`mb` is
`isInternalGroup: false` with a public join link enabled from 31 Jul 2026 until
it was disabled on 1 Sep 2026**, carrying builds **61, 48, 47**. A public
TestFlight link is by definition available to third parties.

- For **build 63** specifically §7.6(f) looks accurate — it was on the internal
  `GF` group, not on `mb`.
- For **builds 47, 48, 61** an open external channel existed for ~32 days.
- ⚠️ **Whether anyone joined is UNKNOWN.** Zero testers at closure, but a removed
  tester would not appear in that count and app-level `betaTesters` returns 403
  at this key's scope. **"Zero now" is not "nobody ever" — do not upgrade it.**

**Why it matters:** §3.1(b) conditions the whole opinion on Ghostface's
description being "accurate and complete", and §7.4(f) requires retaining
TestFlight declaration records. **Send it as a factual correction, not a
conclusion.** It may change nothing — Note 3 mass-market treatment does not turn
on tester counts, and §4.7(a)/(d) reason from *public availability*, which a
public link only reinforces — but that is Sarah's call, and better raised now.

### Actions this unblocks

- **BIS annual report — concrete at last (§7.3(b)):** to `crypt-supp8@bis.doc.gov`
  **and** `enc@nsa.gov`, under §740.17(b)(1) and Supplement No. 8 to Part 742.
  Must state product name, model number, ECCN, encryption authorisation type and
  a brief description of the encryption functionality. **Received by 1 February**
  each year, covering the preceding calendar year. Still not started.
- **Records to retain — §7.4(a)–(f)**, now an explicit checklist including "(f)
  copies of any App Store, TestFlight or Google Play export-compliance
  declarations or submissions made in reliance on this classification."
- **Qualifications that travel with the conclusion:** §3.1(a) MinterEllisonRuddWatts
  is not admitted in US law — a definitive US opinion needs US counsel, which they
  did not consider necessary here; §3.1(b) they did not verify the technical
  materials, including "the completeness of the inventory"; §3.1(c) the position
  is as at its date and regimes change.

---

## 1 Sep 2026 — ASC submission audit (read before touching the 90592 blocker)

Prompted by a `prepare_asc_api_key` failure log. Everything here was read live
off the App Store Connect API and the EAS GraphQL API, not from config.

### The submission count in this file was wrong: EIGHT, not three

All eight target the same build — EAS `22413bd1`, 1.0.2 / build 75. Times UTC
(NZ local in brackets, UTC+12):

| Created (UTC) | NZ | ID | Failure |
|---|---|---|---|
| 31 Aug 02:32 | 14:32 | `4bf1739c` | **unknown — undocumented** |
| 31 Aug 03:03 | 15:03 | `e7f4c557` | **unknown — undocumented** |
| 31 Aug 10:42 | 22:42 | `b4f9d3ae` | 90592 at Apple validation |
| 31 Aug 10:55 | 22:55 | `b19f9856` | 90592 at Apple validation |
| 31 Aug 10:58 | 22:58 | `4ecd1537` | 90592 at Apple validation |
| 31 Aug 11:42 | 23:42 | `98304150` | credential prep (inferred) |
| 31 Aug 12:18 | 1 Sep 00:18 | `55bdf40d` | credential prep (inferred) |
| 31 Aug 13:24 | 1 Sep 01:24 | `d0144476` | credential prep (inferred) |

🔴 **The failure mode CHANGED between 10:58 and 11:42 UTC on 31 Aug.** The three
recorded attempts reached Apple and were rejected with 90592. The three after
them never reached Apple at all — they die in the `prepare_asc_api_key` step
("Prepare credentials"), which runs *before* the binary is offered:

> eas-cli failed to resolve submission config. Add EXPO_DEBUG: "1" to the job
> env to see the error.

**Something changed in that 44-minute window and it is not identified.** That is
the live lead, and it is not an export problem — chasing 90592 will not fix it.

⚠️ **Scope of the inference, stated honestly.** Only ONE credential-prep log was
seen (pasted from the ASC/EAS dashboard, 1 Sep). It belongs to one of the last
three; which one is unknown. The other two are attributed to the same mode by
position, not by evidence. **The two 31 Aug early-afternoon attempts
(`4bf1739c`, `e7f4c557`) have no recorded failure mode at all.**

⚠️ **`error: null` and `logFiles: []` come back on all eight from the EAS
GraphQL `submissions` field — including the three that demonstrably produced a
verbatim 90592 job log. Those fields are not populated on that surface. Their
emptiness is NOT evidence of anything.**

**Decisive next test: re-run one submission with `EXPO_DEBUG: "1"` in the job
env.** Nothing else here is diagnostic.

### Third failure, 1 Sep: submitting the WRONG BUILD — a June artifact that expired in July

```
Expected extensions: [ipa]
Downloading build 459fe23c-42f0-425b-8f6a-fd3501a32c9f...
Unexpected response from server (404): <Code>NoSuchKey</Code>
```

✅ **Fully explained, nothing to fix in config.** `459fe23c-42f0-425b-8f6a-fd3501a32c9f`
is **1.0.0 build 9**, created 18 Jun 2026 off commit `1e0e9999` — *not* build 75.
Its `expirationDate` was **18 Jul 2026**, so EAS garbage-collected the artifact
six weeks ago. Confirmed directly: a range request against its `.ipa` URL returns
**404**, while build 75's returns **206**. The `NoSuchKey` is literal and correct.

**The build to submit is `22413bd1-7944-4338-aeb1-77efb86233fb`** (1.0.2 / 75).
Target it explicitly rather than picking from a list:
`eas submit -p ios --id 22413bd1-7944-4338-aeb1-77efb86233fb`.

⚠️ **No submission record was created for this attempt** — it died at artifact
download, before registering. The submissions list is still the same eight, all
against build 75, newest 31 Aug 13:24 UTC. **There is still no 1 Sep submission
of any kind.**

### ⏳ DEADLINE — build 75's artifact expires 30 Sep 2026

`22413bd1` has `expirationDate: 2026-09-30T02:13:35Z` — **29 days from today**.
Artifact confirmed live right now (HTTP 206). **After that date the "no rebuild
needed" path is gone**: clearing the two June declarations only lets build 75
resubmit *while its artifact still exists*. Past 30 Sep it is a rebuild as 76,
with the money and the flag-verification cycle that implies. The declarations
fix now has a clock on it.

For reference, the only other FINISHED production builds are 74 (`593e86c9`,
exp 28 Sep) and 66 (`5fab5058`, exp 24 Sep) — and both carry
`usesNonExemptEncryption = false`, so neither is a conforming fallback.
Builds 65 and 67–73 all ERRORED.

### ✅ 1 Sep re-run: credential prep did NOT reproduce — 90592 is the sole blocker

Ran on Benji's instruction, targeting build 75 by id:
`EXPO_DEBUG=1 eas submit -p ios --profile production --id 22413bd1-7944-4338-aeb1-77efb86233fb --non-interactive --verbose --wait`

**Ninth submission: `bb61e6b3-768e-4523-ac5b-c33ae847b181`**, created
2026-09-01T21:14:34Z, ERRORED at 21:15:23 — 49 seconds, matching the earlier
"under a minute" pattern.

✅ **Credentials resolved cleanly.** The CLI printed *"App Store Connect API Key
already set up. Using Api Key ID: 2JQFNUQ274 ([Expo] EAS Submit deyVcPcxYd)"*,
`Key Source: EAS servers`, and scheduled the submission. **The
`prepare_asc_api_key` failure did not reproduce.**

⚠️ **"Did not reproduce" is NOT "fixed" and NOT "explained."** Nothing was
changed that would account for it — the credential store held the same key
before and after. It failed three times in a row on 31 Aug and worked first try
on 1 Sep. Treat it as **transient and unexplained**, and expect it may return.

🔴 **It reached Apple and got 90592 again**, verbatim, decoded from the job log:

> Invalid Export Compliance Code. The export compliance key value [] in the
> app's Info.plist doesn't match the key value of the app's export compliance
> documentation. To find the correct value, go to My Apps on App Store Connect.
> (90592)
> Build upload (ID: `9b36032d-cf81-440a-98be-d5bd0ac37823`) failed.
> Build step "Upload to App Store Connect" failed

**Expected** — the two June declarations were still unchanged at the time of the
run. This is a clean confirmation, not a regression: **with credentials working,
the declarations are now the only thing between build 75 and TestFlight.**

⚠️ **Neither `--verbose` nor `EXPO_DEBUG=1` printed the Apple error.** The CLI
still ends at "Something went wrong when submitting your app". **How to actually
read it:** GraphQL `submissions { byId { jobRun { logFileUrls } } }` — note
`jobRun`, because the submission's own `error` and `logFiles` fields are `null`
and `[]` even on a failure that plainly produced a log. Fetch that URL and
`zlib.brotliDecompressSync` it; the payload is newline-delimited JSON and the
Apple error is the `level >= 40` line in phase `CUSTOM`.

### ⚠️ CORRECTION 1 Sep — EAS build numbers do NOT map to ASC build numbers

**A claim made earlier this session was wrong and is retracted here.** It was
asserted that EAS build `459fe23c` (1.0.0, EAS `appBuildVersion: 9`, 18 Jun)
"was built fine and never got in", inferred from its absence from ASC's 1.0.0
build list. **That inference was invalid.**

Read at build level, `459fe23c` has **six submissions and every one is
`FINISHED`** — 18 Jun 22:14, 19 Jun 03:35 / 07:39 / 09:36 / 11:31, and
21 Jun 11:47. It uploaded successfully six times.

🪤 **The trap: EAS's `appBuildVersion` and ASC's build `version` are different
numbering spaces.** ASC's 1.0.0 record has no build 9 at all — its earliest is
**build 15, uploaded 21 Jun**, the same day `459fe23c`'s last submission
finished. Matching the two systems by build number produces false conclusions.
**Match by upload date and artifact, never by number.**

🪤 **Second trap, same family:** the app-level GraphQL
`app.byId.submissions(filter: {platform: IOS})` returns **nothing before
3 Aug 2026** — it does not reach back through the June/July history. The
**build-level** `builds.byId.submissions` field does. Re-verified build 75 the
build-level way: exactly **10** submissions, matching the 8 recorded plus the
2 run on 1 Sep, so the earlier "eight, not three" correction stands. **The
under-reporting only bites on pre-August history — but it is why the June story
was got wrong.** Absence from a query is not evidence of rejection.

⚠️ **Consequence for `lib/exportCompliance.test.ts`:** its header comment states
as fact that *"every upload carrying `true` was rejected by Apple with error
90592"*. Build `459fe23c`'s six uploads **succeeded** on 18–21 Jun, straddling
the 17 Jun flip to `true` and the 18–19 Jun declarations. **That sentence may be
wrong.** It cannot be settled from here: build `459fe23c`'s commit `1e0e9999` is
**not in this repo at all** (Replit-era, or the EAS project that was deleted and
relinked — there are four "relink EAS project" commits, 16 Jun / 17 Jun /
30 Jul / 2 Aug, and the account holds seven EAS projects), so what flag its
binary carried is unknowable. ⛔ **This does NOT touch the test's assertion** —
the flag must be `true` on the authority of memo §7.8, not on upload history.
Only the explanatory comment is unreliable, and that comment is what the next
person reads before deciding whether to flip the flag. **Leave the assertion;
the comment needs Benji's call, and arguably counsel's.**

### Three binaries are INVALID — a third failure mode, distinct from 90592

| Version | Build | Uploaded | State | nonExempt |
|---|---|---|---|---|
| 1.0.0 | 28 | 3 Jul 2026 | **INVALID** | `false` |
| 1.0.1 | 25 | 13 Jul 2026 | **INVALID** | `false` |
| 1.0.1 | 27 | 16 Jul 2026 | **INVALID** | `false` |

1.0.0/28 is the **3 Jul upload GF-02 records as the third attempt** — its ASC
page reads `Binary State: Invalid Binary`, `App Uses Non-Exempt Encryption: No`,
41.6 MB, original file `499bf204-…ipa`.

**All three are `expired: false` while nearly every other build of that era is
`expired: true`** — their siblings were distributed and aged out; these were
never usable, and invalid binaries do not expire.

**Three gates, not one, and they fail differently:**
1. **Upload validation** — 90592 lives here. No build record is ever created.
   This is where build 75 is stuck.
2. **Processing** — `INVALID` lives here. Upload succeeded, ASC made a record,
   processing rejected it. These three.
3. **VALID** — the other 63.

**Two ASC build pages compared side by side, and note they are BOTH "build 28"** —
a live example of why matching by number fails:

| | 1.0.0 / 28 | 1.0.1 / 28 |
|---|---|---|
| Uploaded | 3 Jul 2026 08:50 | 16 Jul 2026 16:52 |
| Binary State | **Invalid Binary** | **Validated** |
| Size | 41.6 MB | 50.4 MB |
| Artifact | `499bf204-…ipa` | `36b6a4d4-…ipa` |
| Non-exempt encryption | **No** | **No** |
| Entitlements | app-id, `get-task-allow:false`, `beta-reports-active`, team-id | same **plus `aps-environment: production`** |

🔍 **The only visible difference is `aps-environment`.** The INVALID 3 Jul build
lacks it; the Validated 16 Jul build has it. Push notifications were added
9–13 Jul (`d225a613` message/incoming-call push, `57a2bb87` VoIP PushKit
plugin), so the entitlement appears right after. ⚠️ **This is correlation, not a
diagnosed cause** — ASC's actual invalid-reason is not exposed on the API, and a
missing `aps-environment` only invalidates a binary if the app actually
registers for remote notifications. **Do not record this as the reason those
three failed; it is a lead, and a low-priority one, since none of them blocks
anything.**

✅ **What the Validated page does prove:** a build can clear both gates while
declaring non-exempt encryption `No`. That is the untrue answer passing
end-to-end, unchallenged, on 16 Jul — the same answer sitting in all 66 records.

⚠️ **Clearing the declarations gets build 75 past gate 1. It does not guarantee
gate 2.** Build 74 processed `VALID` on 29 Aug carrying the embedded Network
Extension, which is good evidence the appex is not a processing hazard — but
build 75 has passed neither gate yet, and "accepted" is not "valid".

### The EAS credential store is intact — the key is configured

Read from EAS GraphQL. `com.ghostface.app` (and `com.ghostface.app.tunnel`)
both carry ASC API key **`2JQFNUQ274`** — `[Expo] EAS Submit deyVcPcxYd`, issuer
`abba23f8-558e-49d5-bdc6-f80952590f8e`, credential id
`e2bf0b08-19f4-409e-a9ce-40cd00ee94b9`, created 13 Aug, Apple team `98337579X8`.
So the key is *configured*; what fails is resolution or validity. ⚠️ **It cannot
be tested from this machine — the private half lives on EAS servers, never on
this disk** (same as recorded for `JYNUC3BXLU`). Note `com.ghostface.app.tunnel`
has `appleTeam: null` where `com.ghostface.app` has the team set; unexamined,
possibly irrelevant.

### Build count: 66 accepted, not ten — every one says `false`

Counted off the ASC API and grouped by pre-release version:

| App version | Builds in ASC | `usesNonExemptEncryption` |
|---|---|---|
| 1.0.0 | 18 | all `false` |
| 1.0.1 | 18 | all `false` |
| 1.0.2 | 30 | all `false` |
| **Total** | **66** | **all `false`** |

**Build 75 is NOT among them** — validation rejected it, so no binary was ever
accepted. There is nothing of build 75 in ASC to remove or expire.

### The app has NEVER been submitted for App Store review

App Store version **1.0.2 sits in `PREPARE_FOR_SUBMISSION`**, created
17 Jun 2026, with **no `appStoreVersionSubmission` attached**. It is the only
App Store version record.

### ⚠️ But EXTERNAL TestFlight is live, and has been since 31 Jul

| Group | Kind | Created | Public link | Builds | Testers now |
|---|---|---|---|---|---|
| `GF` | internal | 30 Jul 2026 | — | all builds | 2 |
| **`mb`** | **EXTERNAL** | **31 Jul 2026** | **enabled, limit 100** | 61, 48, 47 (+34, 33, 8 expired) | **0** |

`betaAppReviewDetail` is populated (Benjamin Henderson,
`support@ghostface.co.nz`, no demo account required). **Builds reach a
public-link group only through Apple's Beta App Review** — so the app HAS been
through an Apple review, just not App Store review.

⚠️ **"0 testers now" is NOT "nobody ever installed it."** A removed tester would
not appear in that count, and builds 34/33/8 are marked `expired`, meaning they
were live on that group at some point. The app-level `betaTesters` endpoint
returns **403** at `WD424K32M4`'s scope, so historical membership is **not
visible from here**. Do not upgrade this to "no external distribution occurred."

✅ **CLOSED 1 Sep on Benji's explicit instruction — link disabled, builds expired.**
Done through the ASC API in that order (link first, so the download surface shut
before anything else changed):
1. `PATCH /v1/betaGroups/9f6a23a2-9f56-4a78-8892-02623570ae27` →
   `publicLinkEnabled: false`. The link `https://testflight.apple.com/join/f6jGTjV8`
   no longer admits anyone. The group still exists; only the public join is off.
2. `PATCH /v1/builds/<id>` → `expired: true` on the three live builds, targeted
   **by ASC build id, not by number** — `7a7cf021…` (61), `20d1d0f7…` (48),
   `6578c17d…` (47), all 1.0.2. ⚠️ **This mattered: ASC holds two builds numbered
   61 and two numbered 33/34, across different pre-release versions.** Expiring by
   version string would have hit the wrong record.

**Verified by re-reading, not trusting the write responses:** `mb` is now
`publicLinkEnabled=false` with **zero live builds** (61, 48, 47, 34, 33, 8 all
expired). Internal group `GF` still has **27 live builds including 74**, so
internal testing is unaffected. Build 74 untouched (`expired=false`).

⚠️ **Build expiry is global and irreversible.** It is per-build, not per-group, so
61/48/47 also left the internal group's live list; ASC offers no un-expire. Build
74 remains the newest testable build for `GF`.

⚠️ **This does NOT retract anything already distributed** — it closes the surface
going forward. The compliance question below is unchanged by it.

📋 **STILL OPEN — this goes to counsel** on the already-drafted 1056841 reply,
framed as a question and not a conclusion: public-link TestFlight was enabled
**31 Jul – 1 Sep 2026**, current testers zero, historical membership not visible
to us — does that count as distribution for the `COMPLIANCE.md` §5 gate and the
BIS annual report? **Closing the link does not answer this and does not make it
go away.**

### ✅ SETTLED 1 Sep — the API can NEVER remove or edit a declaration

A real `DELETE` was sent to `2cb25cc0-c76e-429f-9d10-260946eda9af` on Benji's
explicit instruction. Apple's answer, verbatim:

> 403 FORBIDDEN_ERROR — "The resource 'appEncryptionDeclarations' does not allow
> 'DELETE'. **Allowed operations are: CREATE, GET_COLLECTION, GET_INSTANCE**"

**This closes the "deletability UNVERIFIED" flag that had been open since
31 Aug** — and it closes more than was asked. The allowed-operations list has no
`UPDATE`/`PATCH` either, so:

- ❌ **No DELETE** — declarations cannot be removed via the API, ever.
- ❌ **No PATCH** — so the previously-floated *"if they can be edited, set
  France = NO via the API"* fallback **is dead too**. It was never possible.
- ✅ **CREATE is allowed** — a *new* declaration can be POSTed. That adds, it
  does not remove, so it does not by itself clear the two stuck records. Treat
  as unexplored, not as a fix.

Nothing was deleted (the 403 is a rejection, not a partial write) — re-read
confirms both declarations still present, both `CREATED`, both `codeValue: null`.

**Consequence: the only two routes left are the ASC UI and Apple Developer
Support.** No script can do this. Apple's own help page documents only *adding*
and *completing* App Encryption Documentation — it documents no delete — so if
the UI offers no delete either, **Developer Support becomes the primary route
and should be opened now**, in parallel with anything else, because of the
30 Sep artifact deadline.

⚠️ Also closed cheaply 1 Sep: the theory that `ITSEncryptionExportComplianceCode`
was present-but-empty in the build (a config bug fixable without ASC).
**It is not in `app.json` at all** — `ios.infoPlist` carries only
`ITSAppUsesNonExemptEncryption: true`. Apple's `[]` means *absent*, as assumed.

### Declarations re-verified 1 Sep — unchanged

Both June declarations are still present and still stuck:
`e4bdc6a7-7013-4a0c-b91c-21fb7766af56` (19 Jun) and
`2cb25cc0-c76e-429f-9d10-260946eda9af` (18 Jun) — both `CREATED`,
`codeValue: null`, `usesEncryption: null`, `exempt: false`,
`availableOnFrenchStore: true`, `documentUrl: null`. **They are attached to the
APP, not to a version** — which is why deleting a build or a version record does
not clear 90592. The fix is unchanged: discard both in the ASC UI, then build 75
resubmits with no rebuild.

### ⛔ Settled again 1 Sep: do not defer the export answer to submission time

Proposed this session: drop the version/build and let Apple ask at review time,
on the reasoning that documentation is not required until submission. **The
documentation half is correct** — Apple confirmed on 30 Aug that no documents
need uploading, because the 5D992.c mass-market exemption applies. **The answer
half is not:** `ITSAppUsesNonExemptEncryption` is read at **build upload**, not
at review submission, which is exactly why 66 uploaded builds already carry an
answer and every one of them says `false`. `lib/exportCompliance.test.ts`
already records this in its second assertion — omitting the key means "Apple
then prompts per-submission and the answer goes unrecorded." Deferring does not
avoid the declaration; it makes it untracked.

### Tooling notes (both were needed this session, neither was written down)

- **ASC API needs no `pyjwt`.** Node's built-in `crypto` signs ES256 directly:
  `crypto.sign(null, buf, { key, dsaEncoding: "ieee-p1363" })` gives the raw
  R||S form a JWT wants. Script kept at the scratchpad path for the session only.
- **`WD424K32M4` scope, measured:** works for `apps`, `builds`,
  `appStoreVersions`, `preReleaseVersions`, `betaGroups`, per-group `builds` and
  per-group `betaTesters` counts, and `appEncryptionDeclarations`. **403s** on
  app-level `betaTesters`. Note `appEncryptionDeclarations` is *not* an app
  relationship — use `/v1/appEncryptionDeclarations?filter[app]=<id>`.
- **EAS GraphQL** (`https://api.expo.dev/graphql`) authenticates with the
  `sessionSecret` from `~/.expo/state.json` as an `expo-session` header, **and
  requires a `User-Agent`** — it returns a bare 403 without one. `App.submissions`
  takes `filter: {platform: IOS}`, not a `platform` argument.

---

## 1 Sep 2026 — coturn hardened, GF-01 closed

✅ **coturn is done.** `turns:` live on **5349** (tcp+udp), Let's Encrypt cert
`CN=turn.ghostface.co.nz` valid to **30 Nov 2026**, issued with hooks that make
renewal self-healing — they open and re-close ufw 80, re-apply `chgrp turnserver`
on the cert tree, and reload coturn on every renewal, so nothing rots in 90 days.
The `static-auth-secret` was rotated and set atomically on the box and in Railway
`TURN_SECRET`; `TURN_URLS` moved off the bare IP to
`turn:turn.ghostface.co.nz:3478,turns:turn.ghostface.co.nz:5349`. Verified
**end-to-end**: credentials fetched from the live `/api/ice-config`, HMAC checked
against the box, then relayed over both transports — 4/4 packets, 0 lost on each.
Box patched (32 updates, 1 security) and rebooted; coturn came back
`active/enabled` with all 8 sockets unaided.

✅ **Exposure assessment — no confirmed leak.** While the box was unfirewalled the
only publicly-bound services were **sshd on 22 and coturn on 3478**; everything
else was loopback-only, and the coturn **CLI was never bound** (nothing on 5766,
`no-cli` set). The secret does not appear in git history or the working tree.
**The rotation was precautionary, not a response to a known compromise.**

✅ **SSH hardened.** `PermitRootLogin no`, `PasswordAuthentication no`,
key-only — confirmed from the server's own `sshd -T` and from the client, where a
password attempt is now refused with `Permission denied (publickey)` where it
previously read `publickey,password`. The blocker was a root-only cloud-init
drop-in that beat both the main config and the hardening file on sshd's
first-match-wins. `coturnops` has **intentionally root-equivalent sudo**: the
boundary is key-only SSH with no root and no passwords, *not* the sudo list, and
the sudoers file says so in its own comments.

⚠️ **Two traps worth not relearning.** (1) Railway `skipDeploys:true` stages
variables but the running container keeps its old environment, and
`restart-service` reuses that stale snapshot — only a real deployment applies new
vars, and every recent deploy was `SKIPPED` because `watchPatterns` filtered
docs-only commits. This produced a live secret mismatch mid-session that had to be
rolled back. (2) `artifacts/api-server/CLAUDE.md` says Railway watches
`feat/push-notifications`; **it actually watches `main`**.

✅ **GF-01 closed.** Counsel's memo (30 Aug) gives **ECCN 5D992.c mass-market
self-classification, no CCATS, no MFAT permit**; the 31 Aug follow-up confirms
argon2id and the AEAD correction change nothing. Inventory **rev. 2** records both.
⏸ **The reply to counsel is DRAFTED, NOT SENT** — needs the rev. 2 PDF attached and
a read of its section 3, the timing correction (the AEAD fix shipped 19 Aug, and
was described to counsel as "pending"). No France/ANSSI question has been raised.
The **BIS/ENC report due 1 Feb 2027** remains open and is not closed by GF-01.

🔵 **Crypto review complete — 14 findings**, fix order #7 → #11 → #12 → #13 → #9 →
#10 → #6 then the dead-code batch. **#7, #11 and #12 are done** (`137b8b4`,
`ae81b63`, and #12 on 1 Sep); **#13 is next.** #12 added identity-key pinning
(TOFU + hard block on change) in new `lib/identityPin.ts`: the receive path's
alias→key binding asked the server for both halves of its own comparison, so a
server substituting bundle *and* `/users/exists` together was never caught, and
`safetyNumber` was overwritten on every rebuild — silently repainting the only
evidence of substitution. Recovery is an explicit user accept, because WIPE
DEVICE + re-onboard is supported and a block with no exit would teach users to
delete-and-recreate, discarding the pin. Suite 135 → 142, typecheck clean, lint
delta zero. **Earns one Cryptographic Inventory line when the inventory is next
revised; no algorithm change, so no counsel gate.** All implementation corrections, none touching algorithms or the
classification. See TRACKER GF-16.

⏳ **Outstanding and only yours:** the **cellular call** — 12 Pro → 14, both off
Wi-Fi — to see a relay allocation land on 5349 over TLS from a real carrier NAT.
No self-test proves that. Note Starlink is CGNAT (TRACKER GF-17), so inbound is
impossible and the relay is doing real work.

---

🔴 **Build 75 CANNOT be submitted — Apple rejects it with error 90592.** Three
attempts on 31 Aug (`b4f9d3ae`, `b19f9856`, `4ecd1537`), each failing at
validation in under a minute with no binary accepted. ⚠️ **CORRECTED 1 Sep —
there are EIGHT submissions of build 75, not three; see the audit section at the
top of this file.** Verbatim, from the EAS
job log (brotli-encoded; decode with `zlib.brotliDecompressSync`, the CLI never
prints it and `--verbose`/`--verbose-fastlane` do not help):

> Invalid Export Compliance Code. The export compliance key value [] in the
> app's Info.plist doesn't match the key value of the app's export compliance
> documentation. To find the correct value, go to My Apps on App Store Connect.
> (90592)

**Root cause — read from the App Store Connect API on 31 Aug.** The app record
holds **two App Encryption Declarations, both stuck in state `CREATED` with
`codeValue: null`**:

| Declaration | Created | State | Code |
|---|---|---|---|
| `e4bdc6a7-7013-4a0c-b91c-21fb7766af56` | 19 Jun 2026 | `CREATED` | `null` |
| `2cb25cc0-c76e-429f-9d10-260946eda9af` | 18 Jun 2026 | `CREATED` | `null` |

`CREATED` = started, never submitted for review, so no code was ever issued.
Both carry the correct 5D992.c mass-market wording in `appDescription` and
neither is attached to a build — they are abandoned June drafts. They match the
flag history exactly (`true` on 17 Jun → declarations 18–19 Jun → reverted
5 Jul).

`ITSAppUsesNonExemptEncryption: true` makes Apple look for a compliance code;
the record's code is `null` and the plist's is `[]`; they "don't match" and the
upload is rejected. **Every build ASC has ever accepted carries
`usesNonExemptEncryption = false`** — the untrue answer has never been
challenged and the true one has never got through. ⚠️ **CORRECTED 1 Sep: that is
66 builds, not ten** (1.0.0 ×18, 1.0.1 ×18, 1.0.2 ×30) — counted off the ASC API,
see the audit section at the top.

⚠️ The `[]` is `ITSEncryptionExportComplianceCode`, **not**
`ITSAppUsesNonExemptEncryption`. Do not "fix" this by reverting the flag — that
is the exact reflex that produced builds 63 and 74, and `lib/exportCompliance.test.ts`
now fails the suite for it.

✅ **The app extension is NOT implicated.** `networkpackettunnel.appex` lacks
`ITSAppUsesNonExemptEncryption` in both builds 74 and 75 (verified by unzipping
each `.ipa` and reading every bundled `Info.plist`), but the 90592 log names
only the compliance code. Adding the key to the appex would cost a build and
fix nothing. Worth folding in whenever a rebuild happens for another reason.

⚠️ **Both drafts say `availableOnFrenchStore: true` — contradicting the 30 Aug questionnaire (France NO) and the NZ/AU/UK/US launch decision — and both have `documentUrl: null`. A France requirement asserted with no document is the most likely reason Apple expects a code at all. **Do not complete a June draft unchanged.** Apple's rule: “Once your documentation is approved, Apple will provide you a key value” — no approval, no code, nothing for the plist to match.

**Next action — needs Benji in the ASC UI:** discard both June declarations
(App Information → App Encryption Documentation). With them gone and the
questionnaire already answered "no documents needed", `true` has nothing to
mismatch and **build 75 resubmits unchanged** — no rebuild. The submissions are
`canRetry: true`, so testing costs a minute. The alternative (finish a
declaration, take Apple's issued code into `ITSEncryptionExportComplianceCode`,
rebuild as 76) puts the app on the documentation path the memo says it is not
on. ⚠️ The ASC API exposes no `DELETE` for declarations — removal is UI-only,
and it is unverified whether they can be deleted rather than only completed.

**ASC API access — the key of record is `WD424K32M4`:** issuer
`abba23f8-558e-49d5-bdc6-f80952590f8e`, private key `~/Keys/AuthKey_WD424K32M4.p8`.
That is the one that authenticates; use it. Five of the ten local `.p8` files
return 401 (revoked or inactive), and `WD424K32M4` is scoped too narrowly for
declaration→build links (403) — a limit to expect, not a bug.

⚠️ **`JYNUC3BXLU` is NOT a lost key and needs no revocation.** It is
`[Expo] EAS Submit 22NLUm_Shw`, generated by EAS itself through the ASC API for
**vault2fa** (`com.ghostface.vault2fa`, ASC app `6800932386`, EAS project
`85ba3e1c-1931-47d5-aa89-f20a8fcbc4f5`) — a separate project, and its private
half lives on EAS servers, never on this disk. Same pattern as `2JQFNUQ274`
(`[Expo] EAS Submit deyVcPcxYd`), the key EAS uses for GHOSTFACE. Note also that
naming a key on the `eas submit` command line does nothing: the command has no
key flag and always uses the EAS credential store — on 29 Aug build 74 was
requested with `JYNUC3BXLU` and submitted with `2JQFNUQ274`.

🔑 **Real key-hygiene item:** ten `.p8` private keys sit unencrypted in `~/Keys`
and `~/Downloads`, half already dead (401). Worth pruning to the one in use.
✅ **ASC App Encryption Documentation filed 30 Aug**, recorded verbatim in
`COMPLIANCE.md` §7 — purpose text, standard-algorithms YES / proprietary NO
(memo §4.4, §4.10–4.11), France NO (matching the NZ/AU/UK/US launch decision).
Apple confirmed no documents need uploading. ⚠️ **Apple offers a hint on the last
screen to declare no-encryption in `Info.plist` — never take it.** That is
precisely the defect in builds 63/74; it contradicts §7.8 and now fails the test
suite via `lib/exportCompliance.test.ts`, which was mutation-checked.
✅ **Annexes archived** to `~/Documents/Ghostface-Legal/1056841-export-control/`
(mirror to the company OneDrive; the memo email still needs exporting as PDF
into the same folder).
✅ **Counsel asked** — reply on the memo thread to Sarah Salmond, cc Sian
Vaughan-Jones and Isabelle Pou, covering the argon2id omission from Annex 1 and
the pending AEAD associated-data encoding fix, both framed on §7.5's revisit
trigger.
⛔ **Public release still gated.** The crypto diff against the reviewed baseline
is non-zero until Sarah answers on argon2id. `COMPLIANCE.md` §5 holds that line;
the AEAD fix sits behind the same rule. Previous entry follows.)

Previously updated: 2026-08-30 (Claude Code — **GF-01 IS CLOSED** and the submit
freeze is replaced by a conditional gate. MinterEllisonRuddWatts (Salmond /
Vaughan-Jones), matter 1056841, 31 Aug 2026: **ECCN 5D992.c mass-market
self-classification, no CCATS, no MFAT permit, distribution may resume.** New
`COMPLIANCE.md` at the repo root is now the standing record — classification
statement, the reviewed crypto baseline, the BIS annual-report obligation, the
per-build release record and the standing rule.
⛔ **BUT NOTHING SHIPS YET, on two counts found while doing the paperwork.**
FIRST, **build 74's compiled `ITSAppUsesNonExemptEncryption` is `false`** —
read from `Payload/GHOSTFACE.app/Info.plist` inside the actual `.ipa`, not from
config. That is the same wrong value the memo records against build 63 (§7.6(f)),
and §7.8 requires the setting to say the app USES encryption with the exemption
relied on separately. `app.json` is corrected to `true`, but the flag is compiled
in, so **a new build is required**. That flag has flip-flopped six times since
6 Aug; nothing anchored it to a rationale until now.
SECOND, ⛔ **argon2id is not in the materials counsel reviewed.** `lib/recoveryPin.ts`
blinds the identity key with argon2id, and **"argon" appears zero times in the
Cryptographic Inventory** (verified by text search; every other algorithm does
appear). It landed on devtest 27 Aug, at or after the materials were prepared,
and is an ancestor of build 74. Memo §3.1(b) conditions the opinion on the
description being complete. **This goes to counsel as an addendum to 1056841
before any public release.**
**The standing rule (COMPLIANCE.md §5) replaces the freeze:** a build ships only
if its crypto diff against the reviewed baseline is zero AND that zero is
recorded. Any material change to cryptographic functionality goes to counsel
first — the pending AEAD associated-data fix is held behind this rule.
📅 **BIS annual self-classification report due 1 Feb 2027** for CY2026, to
crypt-supp8@bis.doc.gov and enc@nsa.gov. Not started.
ASC questionnaire on public release: **uses encryption YES**, mass-market
exemption per the 5D992.c self-classification.
Previous entry follows.)

Previously updated: 2026-08-30 (Claude Code — a long session: four PRs merged, two
production data wipes, a churn root-cause, a local-build discovery, and the
home coin redesigned. FIRST, **the four Railway-agent PRs are merged and
deployed** (`2ec4851` #8+#9, `a33d155`+`9013490` #10, `c8d6875` #11), in three
stages so each layer has its own deploy and a bisect point. They had no CI —
their red checks were a PR-environment artefact (PgBouncer/Postgres defined but
never deployed there), so verification was local: typecheck clean, api-server
92 passed, app 125 passed, lint delta zero, no dependency change.
SECOND, ⛔ **#10 could not be merged as written and would have broken every
install in the field.** It sent `{type:"error", message:"auth unavailable"}`
before closing 4003 and ordered the NEW client's matcher accordingly — but
builds 66 and 74, i.e. everything on a phone, match with a bare
`includes("auth")` and no ordering. That wording sets `authRejected`, takes the
`code === 4001 || authRejected` branch, and makes the device discard its token
and re-register: **precisely the failure #10 exists to prevent**. Fixed by
renaming the wire message to `credential check unavailable`, which removes the
trigger instead of gating the deploy behind an app release. A test asserts
nothing on that path contains `auth`.
THIRD, ⛔ **the VoIP churn root cause is a KICK LOOP, and the fix is
client-side and unshipped.** The server closes a superseded socket with **4002**;
the client has cases for 4003 and 4001 and nothing else, so 4002 falls through
to the generic reconnect — and reconnecting is exactly wrong, because that
reconnect becomes the newest socket and kicks the one that superseded it.
Measured 30 Aug 01:10:08–01:10:21: **alias `GHOST` held eight connIds across both
replicas in thirteen seconds.** `c1657d0` makes the client stand down on 4002,
before any state mutation. ⚠️ **It needs a build to reach devices** — pair it
with `0278b41`, which build 74 already predates. The AppState
background/active handler is the trigger, not the cause.
FOURTH, **the database was wiped twice and the earlier wipes were incomplete.**
Every previous wipe covered 9 alias-keyed tables; there are **14**. 150 rows for
10 identities, then a **99-row orphan sweep** from the 17–20 Aug wipes,
including three `ghost_entitlements` grants owned by nobody. Scripts are now
committed at `scripts/dbwipe/` instead of being retyped. ⚠️ `ghost_numbers`
deliberately NOT deleted: removing the row does not release the number at
Vonage. ⚠️ **A wipe does not stick while the app is running** — the client
re-registers its stored alias on the 4001 path.
FIFTH, ✅ **local iOS SIMULATOR builds work on this Mac — the `fmt`/`consteval`
wall is DEVICE-only.** The blocker was one command nothing runs locally:
`pnpm run eas-build-post-install` (link-wireguard-kit.mjs is an EAS hook, so
`WireGuardKitC`/`WireGuardKitGo` are never linked locally). With it, both Debug
and **Release** build clean — Release produces a 7.4 MB production
`main.jsbundle`. Sequence: `pod install` → that hook → `pnpm ios:sim:build`.
`Podfile.lock` is new and still uncommitted by choice.
SIXTH, **the home coin was redesigned** — glass coin, two struck faces, milled
edge. Three approaches were tried and abandoned (pavé, single sphere decal,
holographic globe); the TRACKER row records why, including the two rules that
cost the most time: a flat `rotateY` is right for a coin and wrong for a
sphere, and `scaleX = cos` alone is a mirror, not a reverse.
⚠️ **NOT DONE AND STILL BLOCKING: `eas submit` remains FROZEN on GF-01.** The
written opinion from Sarah Salmond was expected ~week of 1 Sep and
`ITSAppUsesNonExemptEncryption` must be re-decided against it before any
submission. Nothing tonight changes that. Previous entry follows.)

Previously updated: 2026-08-29 (Claude Code — orientation and reconciliation session; no
product code changed. This file had not been touched since 28 Aug 18:51 while an
overnight session and four Railway agent sessions all landed work, so this entry is
a catch-up. FIRST, **production build 74 exists and Apple accepted it.** Commit
`4c641c6`, tagged `build-74` on origin, `distribution: store`. The signing gate
cleared: the App Store profile was replaced `89A3CY9F86` (stale) → **`D7R447UX95`**
after an interactive `eas credentials` run reported `Synced capabilities: Enabled:
Network Extensions, Personal VPN` on `com.ghostface.app` — so the capability
question the 28 Aug entry left as "reported, not verified" is now answered by a
green production build rather than by a summary line. ⚠️ **Upload only — NOT
submitted for App Review**, as instructed; the binary sits in TestFlight
processing.
SECOND, **build 74 carries every "needs an app release" client half.** Verified
with `git merge-base --is-ancestor`, not assumed: `19db682` and `1268467` (the
auth-posture client half and the deviceAuthMiddleware consolidation) and `11f5c3a`
(the msgAck client half) are all ancestors of `4c641c6`. **This does not unblock
`ENFORCE_ENDPOINT_AUTH`.** Nobody has the binary — upload is not distribution — so
the flag stays OFF and the flip signal is unchanged: flip only once the
"ENFORCE_ENDPOINT_AUTH is off" lines stop appearing in Railway logs, filtering by
message text and not by severity (see the OPEN LOOP below).
THIRD, ⚠️ **build 74 is already stale for VoIP.** `0278b41` — attach VoIP listeners
before requesting PushKit credentials, the commit that made calls work end to end
in both directions on hardware — landed AFTER `4c641c6` and is not in the binary.
⚠️ Stated precisely: what is established is the ancestry, not a test — nobody has
run build 74 and observed calling fail. But the binary predates the fix that made
calls work on hardware, so **it has never been shown to call reliably** and should
not be treated as the release candidate. A new build is needed before any
submission.
FOURTH, the overnight session's call work, for the record. VoIP verified end to end
on hardware, both directions (`5161949`). The `Stale call-ring dropped` warning is
**diagnosed and benign** (`8449e4f`): the drop is a correct `callid-mismatch`
response to a redial, and **the real defect is cold-start wake latency** —
`CALL_WAKE_GRACE_MS` is 25s and the user redialled at 20.9s, so the server still had
four legitimate seconds left. Latency, not state corruption. `cleanup()` keying on
alias rather than connId was a genuine latent bug and is fixed on its own merits
(`9c6e50c`), recorded as closed by inspection rather than observation.
FIFTH, **Railway deploys `main`, and this is verified by commit hash rather than by
a matching timestamp.** Production `api-server` deployment `5d8b6f71` runs
commitHash `9c6e50c…` on branch `main`, status SUCCESS, 29 Aug 10:25:55Z. The
deploy-branch trap (`f13c468`) is closed. `main` is 3 commits ahead of
`origin/feat/push-notifications`, which no longer matters for deploys but does mean
that branch is no longer the place to look for what is live.
SIXTH, ⚠️ **NEW — four unmerged Railway-agent PRs are open, and two of their preview
deploys are CRASHED for an environment reason that is easy to misread as a broken
fix.** Open on `ghostzeronz-coder/Secure-Ghost-Chat`, all created 29 Aug, all
MERGEABLE, none merged: **#8** `fix(ws): deliver call-hangups to a callee who is
already back online`; **#9** `fix(call): take video from the offer SDP, not the
route param`; **#10** `fix(ws): don't report a failed token lookup as a rejected
token`; **#11** `fix(db): retry every transient connection failure, and keep the
pool warm`. #10 and #11 aim squarely at the cold-start latency this session's own
diagnosis named as the real defect, and #10 describes a path where a cold-start ring
makes a client discard a good device token and stop reconnecting for good. **Their
PR-environment deploys crash with `getaddrinfo ENOTFOUND
pgbouncer.railway.internal`**, and the cause is confirmed rather than inferred: in
`Secure-Ghost-Chat-pr-11`, **PgBouncer and Postgres are defined but have
`latestDeployment: null` — they have never been deployed in that environment**;
only Redis and `api-server` actually run there. So the internal DNS name has
nothing behind it, `DATABASE_URL` cannot resolve, and the process dies in
`rotationScheduler` tick / `ensureSeedTokens` / the pool. **CRASHED there
says nothing about the code: those fixes have never been exercised.** Decide whether
PR environments get a database or stop being deployed, but do not judge the fixes on
these deploys.
SEVENTH, two decisions this file asked a session to put to Benji are still
unresolved. (a) **The Postgres always-on flip** (`deploy.sleepApplication` unset,
28 Aug) was made without the usual ask-first pattern and is a recurring Railway
cost — keep it or revert to sleep-on-idle. (b) **The pasted mailbox password is
still `⬜ not started`** two days on, and one of the five candidates is `legal@`,
which carries the MinterEllison correspondence GF-01 turns on. It is the oldest
unaddressed security item on the board.)

Previously updated: 2026-08-28 (Claude Code — message-delivery ack fix, plus two
infra corrections, one of which was NOT pre-approved and should be reviewed.
FIRST, TRACKER's "`delivered` does not mean delivered" fix is **code
complete, verified, and — correcting this entry — COMMITTED as `11f5c3a` and
deployed to production 28 Aug 16:20 UTC (Railway `998f156a`). The "NOT
committed / sitting in the working tree" wording below was written before the
commit and is stale.** The server half is live; the client half still needs an
app release: client now sends `{type:"msgAck", msgId}` after
decrypting *and persisting* a message; server deletes the row on that ack
instead of optimistically flagging `delivered` on send (the three sites that
did this are gone); client dedupes a redelivered `msgId` instead of
re-decrypting it, since Double Ratchet consumes a message key per attempt.
`GET /messages/pending` (looks unused by the current app — no caller found)
still has no ack of its own and now only peeks; a caller on that path relies
on the existing 7-day purge job like any pre-ack legacy client. Verified:
both packages typecheck clean, 78/78 + 112/112 tests pass, eslint shows only
the same pre-existing warnings (`git stash` diff). **Not committed — needs a
review pass before it is**, and reaching a device needs an EAS build/submit
of its own regardless (submission also still behind GF-01). SECOND, **`api-server`'s Postgres was flipped from sleep-on-idle to
always-on this session** (`deploy.sleepApplication: true` → unset), done to
eliminate the cold-start 500s a live-log check found in prod (three windows,
prior ~8h, landing squarely on push-registration calls) — confirmed fixed by
a live re-check (`/api/tokens` 200 in 1.3s, no `server_login_retry` errors).
**This is a real recurring Railway cost change and was made without the
usual ask-first pattern this file's other infra changes follow — flag it to
Benji and decide whether to keep it or revert to sleep-on-idle.** THIRD,
three Railway env vars that briefly existed on `api-server` —
`TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` — were
removed. No functional loss: 24 Aug's entry below already established the
Twilio account is suspended and coturn (`TURN_SECRET`/`TURN_URLS`) is the
real, working TURN path: these three were dead weight, not a live
credential, and their origin was never established.)

Previously updated: 2026-08-28 (Claude Code — a board-hygiene session; no product
code changed except one entitlement. Everything below is committed and pushed
(`7182878`, `b2484ce`, `0d92452` on `feat/push-notifications`). **The single
most important line in this entry: `app.json` now declares TWO capabilities on
the MAIN target — `com.apple.developer.networking.networkextension:
["packet-tunnel-provider"]` and `com.apple.developer.networking.vpn.api:
["allow-vpn"]` (the latter added 28 Aug, see below) — and profile `89A3CY9F86`
carried NEITHER, so every iOS build, dev-client profiles included, failed
signing.** **✅ CLEARED 28 Aug — the interactive `eas credentials` run
completed and reports "All credentials are ready to build" for BOTH targets
(`com.ghostface.app`, `com.ghostface.app.tunnel`) on `@ghost_face/mayybachh`.**
⚠️ **Reported, not verified.** That one line proves each target has a profile
EAS accepts; it does NOT show the capability-sync results. Three things remain
unconfirmed: whether sync enabled Personal VPN on the main App ID, whether it
disabled Personal VPN on the tunnel App ID as predicted, and whether the
regenerated profiles carry new IDs (`89A3CY9F86` / `76QM629KQ5` may both be
stale). The run's sync output was not captured. Confirm from a real build's
embedded profile — `unzip -p <ipa> 'Payload/*.app/embedded.mobileprovision' \|
security cms -D` — before treating the VPN capability as live on device.
FIRST, **the ⚠️ NEW HAZARD in the entry below was false and is retracted
in place.** STATUS.md and TRACKER.md were tracked at `3c58b67` the whole time
(`git ls-tree -r 3c58b67` lists both), `artifacts/` was in that tree, and the
Expo app was never at the repo root; `git status` showed both as ` M`, not
`??`. The commit that "rescued" them was 187 insertions / 4 deletions with a
single `create mode` — a modification, not an add. No cross-session memory was
ever at risk. Cause of the bad claim not established; most likely inspected
from a different branch or worktree. **Lesson: `git ls-tree` before writing a
hazard note about the git tree.**
SECOND, **two TRACKER rows were stale and both are retired.** (a) "WS state is
in-process — hard ceiling at 1 replica" was still ⬜ open while the three
backplane commits that closed it shipped 24 Aug. Verified live: `api-server`
runs `multiRegionConfig: {us-west2: {numReplicas: 2}}` — two replicas, not
one, and not `sfo` as the row claimed. Four of the six named maps now live in
`ws/sharedState.ts`; `connectedClients` and `deliveryIdToAlias` stay
module-scope by design. **No architecture decision is outstanding.** (b) The
WireGuard native-client row read "⏸ needs Benji's call" over the `fmt` /
`consteval` blocker. **That blocker is local-only and EAS routes around it —
proven, not reasoned.** `scripts/link-wireguard-kit.mjs` adds
`native/vpn-tunnel/` to the MAIN `GHOSTFACE` target (lines 273–297) — exactly
the condition that fails 2/2 on this Mac — the file is byte-identical at
`b63b233` and HEAD, it ran as `eas-build-post-install`, and EAS build
`d176c63d` from that commit FINISHED clean in 5.9 min. So patch `fmt` only if
you want *local* device builds; it blocks nothing else. ⚠️ That build was
`development:device`, NOT production.
THIRD, **the Apple Network Extension entitlement request is now the critical
path for the VPN.** Still unsubmitted per TRACKER. `packet-tunnel-provider`
needs Apple's grant for App Store distribution — weeks of latency, and it is
independent of GF-01, of the `fmt` question and of the build path, so it
should be submitted now rather than sequenced behind anything. `lib/wireguard.ts`
confirmed absent; `AppContext.tsx`'s `connectVPN()`/`disconnectVPN()` are still
mocks.
FOURTH, **`support@ghostface.co.nz` exists — the "needs support@ created"
blocker is closed, but not fully proven.** No `ghostface.app` URL remains in
`app.json`'s metadata block; `/`, `/privacy` and `/support` all return 200; MX
is `1 smtp.google.com` with a matching SPF record; the delivery test is dated
**28 Aug 04:19 UTC** (the TRACKER row says 27 Aug — NZT/UTC skew) with no DSN
in the following 14 days. ⚠️ **But that thread holds exactly one message,
labelled `SENT` only** — no `INBOX` copy came back, so benjamin@ is not a
member of whatever `support@` is and nobody has opened the inbox. Eyeball it
once before submitting. ⚠️ Separately, `supportUrl` is a `mailto:`, not a URL;
App Store Connect's Support URL field expects http/https and
`https://ghostface.co.nz/support` already returns 200 — decide which value
goes in the ASC listing.
FIFTH, **the 27 Aug mailbox password paste is now its own TRACKER row and is
STILL UNROTATED.** It had been a trailing sentence on the mailboxes row, easy
to miss. One of `benjamin@` / `support@` / `info@` / `legal@` / `admin@` — and
`legal@` carries the MinterEllison correspondence GF-01 turns on. Same class as
the WireGuard private key on 24 Aug, which was rotated the same day. Identify
which, rotate in the Google Workspace admin console, review sign-in activity.
SIXTH, **two TRACKER rows were silently losing content at render.** The App
Store metadata row had four cells in a three-column table, so everything from
"⚠️ 27 Aug, Benji: ghostface.app is NOT ours — it is on backorder" onward had
never displayed on the board. The Android-crash row had unescaped pipes inside
`adb logcat \| grep -iE '...'`, splitting it into six cells and mangling the one
command needed to debug that crash. Both repaired, no text lost; a sweep
respecting each table's own column count now reports zero malformed rows.
**When adding a row, escape pipes inside code spans and count the cells.**
Also: `artifacts/api-server/_check-tmp.mjs` deleted at Benji's instruction (it
was the read-only script behind the 28 Aug welcome-gift/entitlements
verification, and self-documented as delete-after-use).
Readiness read, asked for and worth keeping: **~55% overall** — engineering is
the healthy part (~75%), but the gating items are not engineering. Pre-ship
gates 1 of 3; GF-01 unresolved; Vonage unanswered. Engineering can keep
climbing without moving the ship date, and the Vonage answer does not adjust
the percentage so much as decide whether GhostNumber survives in its current
form.)

Previously updated: 2026-08-28 (Claude Code — correspondence day, plus one build
result. THREE things. FIRST, **GF-01: Sarah replied, but this is NOT the
opinion.** Her reply answers only the territory follow-up, and all three of
those questions are OUT OF SCOPE. She declines "which destinations must be
excluded as a matter of law" and "which territories require registration or a
local entity" outright — both need jurisdiction-specific advice across
telecommunications, cybersecurity, privacy, sanctions and export controls, and
NZ counsel are not qualified to give it. She does answer the third, and it is
the one that matters: **mass-market treatment does NOT change either answer.**
It governs export-control classification and the availability of exemption
pathways only; it does not determine whether local telecoms, licensing,
registration, cybersecurity or privacy requirements apply. So the
classification opinion is **still pending** (~1 Sep, chase pinned 3 Sep),
`ITSAppUsesNonExemptEncryption` is still undecided, and **`eas submit` stays
blocked**. Consequence: worldwide distribution has **no legal owner**, and
mass-market treatment will not fill that gap. Decision taken and put on the
record with counsel: **launch with App Store availability limited to NZ / AU /
UK / US** — the same four the API already knows via `COUNTRY_NAMES` — and take
local advice before opening any further market.
SECOND, **Vonage answered, and it is not a clean yes.** Aaron justifies
assigning numbers to end users via *masked calling*, where the platform holds
the number and proxies two parties. That is not what GhostNumber does — it
gives each user their own persistent number — and the words *sub-allocation*
and *resale*, the framing TRACKER flagged as the real risk, appear nowhere.
Re-asked in those exact terms and escalated past the SDR to someone who can
bind Vonage. Two answers change the product: **end-user KYC is ours** (we are
data controller and must collect and retain identity/address records,
producible on request), which is a structural conflict with an alias-only,
no-PII product rather than a paperwork task; and **released numbers age 90
days** before re-entering the pool, so `lib/rotationScheduler.ts` can never
recycle its own inventory — every rotation permanently consumes new numbers,
and the released one is still billed that month (~double MRC during overlap).
Also open: NZ is absent from his SMS+Voice combined list, 10DLC wants each
end customer registered as a separate brand (does not scale to consumers, and
its 3-month campaign minimum collides with rotation), and inbound OTP/2FA on
our numbers is blocked at platform level — users WILL try to register
WhatsApp/Google/banks with a GhostNumber and those messages are filtered.
THIRD, **the WireGuardKit EAS fix is proven.** Build
`d176c63d-de45-4b2a-9099-cabdf82b23f9` from commit `b63b233` finished clean —
FINISHED, no error, 5.9 min, v1.0.2 build 66. The `eas-build-post-install`
link step and the `eas-build-pre-install` Go install hook both ran, and `no
such module 'WireGuardKit'` is gone. ⚠️ The profile was `development:device`,
**NOT production** — this proves the hooks run and WireGuardKit links, not
that a store build passes; re-check on the first production build carrying the
tunnel target. Separately, the watcher polling that build had looped for over
5h without ever reporting: its command used `eas build:view <id> --json
--non-interactive`, and `--non-interactive` is not a valid flag for
`build:view`, so every poll errored and the `until` loop never matched a
status. Drop the flag when polling.
⚠️ **~~NEW HAZARD — this file and TRACKER.md are NOT in the current HEAD's
git tree.~~ RETRACTED 28 Aug — the claim was false, on all three counts.**
`STATUS.md` and `TRACKER.md` were tracked at `3c58b67` the whole time
(`git ls-tree -r 3c58b67` lists both), `artifacts/` was in that tree too, and
the Expo app was never at the repo root. `git status` showed both files as
` M`, not `??`. Today's edits are committed on `feat/push-notifications` as a
modification, not an add — 187 insertions / 4 deletions across 3 files, and the
one `create mode` in that commit is `compliance/vonage-followup-draft.md`,
which genuinely was new. No cross-session memory was ever at risk from a `git clean`. Cause of the
bad claim not established — most likely inspected from a different branch or
worktree. Kept rather than deleted so a session that remembers the warning can
see it was withdrawn.)

Previously updated: 2026-08-28 (Claude Code — continuation of the 27 Aug session,
now VERIFIED ON HARDWARE. Two things that were code-only are proven against
production: the **welcome gift grants** (first ever — `MAYYBACHHFKU`, specter,
until 27 Sep; both `welcome_gifts` and `ghost_entitlements` were empty before,
so nobody has ever paid) and **self-destruct properly releases an alias** via
the sanctioned DELETE path — the route that was unavailable for GHOSTFACE.
Also: the language setting offered 12 languages and did nothing (no i18n at
all) and is now English-only; the Pig-Latin nudge is gone; the coin halo was
strobing and now tracks the coin angle; the recovery step's confirm button was
unreachable (`flex` vs `flexGrow` on a ScrollView content container). Dev
builds are on all three handsets. ⚠️ **The dev client is not reaching Metro**,
so every JS change since `f1df8a0` is committed but invisible on device — see
TRACKER. Prior session summary follows.)

Previously updated: 2026-08-27 (Claude Code session — three pieces of work.
FIRST, the auth-posture pass on the three unauthenticated endpoints: both
halves written, server half DEPLOYED with enforcement DISABLED behind
`ENFORCE_ENDPOINT_AUTH`; see the OPEN LOOP directly below — **read it before
flipping that flag**. SECOND, all auth helper duplication removed: one
`lib/auth.ts`, verified live against prod. THIRD, a STATUS/TRACKER
reconciliation: TRACKER.md's Incidents table still carried the VPN peer
agent as "🔴 OPEN, P0, nothing fixed" while this file recorded it RESOLVED
on 24 Aug.
Verified the fix against the repo before deciding which side was stale —
`infra/vpn-agent/agent.py` (`9a68f07`) really does have `/healthz`, the config
lock, atomic `os.replace` writes and handshake/request timeouts, and
`firewall.sh` (`8672bf3`) really does scope tcp/8443 to its own `VPNAGENT`
chain — so this file was right and the TRACKER row was stale. TRACKER row
closed, carrying forward the static-IP coupling warning and the "tunnel not
achieved / keep Mullvad" caveat. Also reconciled several further stale
claims in this file: the GF-01 OPEN LOOPS bullet said the counsel email was
still unsent (it was sent 25 Aug — a session acting on it would have
re-contacted counsel), and a VPN entry still pointed at an "ACTIVE INCIDENT".
The OPEN LOOPS section turned out to be a frozen 20 Aug snapshot rather than
live state (it also still claimed the recovered Google account was locked), so
it now carries a header saying so, and a duplicated Postgres-incident heading
was removed.
⚠️ **Known gap: the 25 Aug work is recorded in TRACKER.md but was never
narrated here** — build 66, the lock-screen fingerprint foil gate, the
build-99 local device pipeline, the build 99 ↔ 63 call field test, and the
deletion of the stale ~/Downloads duplicate. Read TRACKER.md for those.)

Previously updated: 2026-08-24 (Claude Code session — VPN health check found the
VPN P0 RESOLVED: agent unwedged, 8443 firewalled to Railway static egress,
agent rewritten so a stalled client cannot wedge it, and the first successful
peer registration ever, verified end to end. See RESOLVED INCIDENT below.
Earlier the same day: WireGuard native client — PacketTunnelProvider.swift +
native bridge module both written; full-app build blocked by an unrelated
fmt/Clang compiler bug — needs Benji's call on how to proceed)

## 🚧 OPEN LOOP — auth posture: code complete, ENFORCEMENT FLAG OFF

`POST /blobs`, `GET /ice-config` and `POST /invites` shipped unauthenticated
(see their TRACKER rows). Both halves of the fix are now written, but
enforcement is **off** and must stay off until an app release carrying the
client half is in users' hands — Railway deploys in seconds, App Store review
takes days, so the fix is necessarily two-phase.

**The server half is already deployed and was safe** — verified live with the
flag off, production behaviour unchanged. **Flipping the flag is the step that
actually changes anything, and it is the one to think about.** (It is
reversible — a Railway variable, not a deploy.) Before flipping, see the
device-testing row in TRACKER: the three client call sites and the
`POST /invites` route wiring are still typecheck-only.

**Step 1 — DONE, committed `19db682` (client only).** The app now sends
`Authorization: Bearer <device-token>` on all three, plus the alias (query
string for blobs/ice-config, already in the body for invites) — the server
matches a token against the `device_tokens` row for a given alias, and
`token_hash` is not unique, only `user_id` is. New `lib/deviceAuth.ts` holds
the shared token/alias reader; `secureGet`/`secureSet`/`secureDelete` and
`DEVICE_TOKEN_KEY`/`ALIAS_KEY` moved there out of `AppContext.tsx`, where they
were private and unreachable from `lib/blobStore.ts`, `components/GhostInvite`
and the module-scope ICE fetch in `app/call.tsx`. **This is a no-op against
production** — today's server accepts and ignores the header.

**Step 2 — WRITTEN, SHIPS DISABLED.** `src/lib/auth.ts` (`checkAuth`) gates
all three endpoints, and `POST /invites` now takes `ownerAlias` from the
authenticated token instead of the body. **All of it is behind
`ENFORCE_ENDPOINT_AUTH`, which defaults OFF and ships OFF** — production
behaviour is unchanged by the deploy itself. While the flag is off, every
unauthenticated call is logged ("ENFORCE_ENDPOINT_AUTH is off"): when those
stop appearing in Railway logs, every live client is sending the header and it
is safe to flip. **Filter by the message text, not by severity** — verified in
prod 27 Aug: Railway surfaces pino `warn` as `info` (the pre-existing
`logger.warn` at `iceConfig.ts:183` shows the same way), so a severity filter
finds nothing. `ENFORCE_ENDPOINT_AUTH` as a log filter works, and each line
carries `endpoint` and `ip` attributes. Flipping is a Railway variable change, not a
deploy, so it is instantly reversible.

`lib/auth.ts` imports `@workspace/db` **lazily**, on purpose: a static import
would drag a `DATABASE_URL` requirement into every module that gates on auth,
and it broke `blobs.test.ts`, which is deliberately hermetic. Don't make it
static.

**`hashToken` consolidation — DONE 27 Aug.** All 7 copies (crypto, messages,
numbers, prekeys, push, vpn, ws/manager) now import the one in `lib/auth.ts`.
Verified byte-identical before removal, so it is a pure no-op: 35 deletions,
9 insertions, typecheck clean, tests 70/70, eslint clean on all 7.

**Resolver consolidation — DONE 27 Aug, explicit-source approach.**
`lib/auth.ts` is now the only place any of this lives: `hashToken`,
`verifyDeviceToken(alias, token)`, `getAuthedAlias(req, source)` and
`checkAuth(req, res, label, source)`.

`AliasSource` is a **required** parameter with no default — `"query"`,
`"query-or-body"`, or `"body-owner-alias"`. That is the enforcement: a new
route cannot silently inherit a wider source than it means, and adding a call
site without naming one is a compile error (this is exactly how the migration
caught its own test file).

Sources as migrated, each preserving that site's prior behaviour:
`messages.ts` and `numbers.ts` → `"query"`; `crypto.ts` → `"query-or-body"`;
`blobs.ts`/`iceConfig.ts` → `"query"`; `invites.ts` → `"body-owner-alias"`.
The last three are a slight *narrowing* of what the 27 Aug deploy accepted
(it read query, then `body.alias`, then `body.ownerAlias` for all three) —
safe, because the clients send exactly the source now named, and unobservable
anyway while enforcement is off. `ws/manager.ts`'s `validateToken` now calls
`verifyDeviceToken`, keeping its deliberate never-throw wrapper: a DB fault
during the WebSocket handshake must fail auth, not reject out of the handler.

**Audit that made this safe (27 Aug):** every one of the 10 call sites uses
the alias `getAuthedAlias` *returns* and none re-reads `req.query.alias` or
`req.body.alias` itself. So the authenticate-as-one-user-act-on-another
hazard was never reachable — it was a latent property, not a live bug. The
required source parameter is what keeps it that way. If a handler ever starts
reading the raw field, it must read the same source named at its call site.

**`requireDeviceAuth` consolidation — DONE 27 Aug.** `deviceAuthMiddleware()`
in `lib/auth.ts` is now the only copy; each route builds its own from the
factory (`const requireDeviceAuth = deviceAuthMiddleware()`), so every
existing usage site is untouched. `vpn.ts` passes its IP failure gate:
`deviceAuthMiddleware({ failureGate: authFailureGate })`.

Verified before merging: `prekeys.ts` and `push.ts` were **code-identical**
(they differed only in comments), and `vpn.ts` was the same plus the gate.
The gate's exact semantics are preserved and now tested, including the
subtle one: it is consulted *before* the token lookup, and charged on the
401 and 403 paths **but not the 400** — a malformed `:userId` is a client
bug, not an auth attempt, and must not fill a bucket that gates real users
behind carrier NAT.

**Verified live against production, not just asserted.** A baseline was taken
against the pre-consolidation deploy (`e4b6213`) and re-run against the
consolidated one (`1268467`, deploy `73fb290c` SUCCESS). Identical, status
codes and error bodies both:

| check | before | after |
|---|---|---|
| `GET /api/healthz` | 200 | 200 |
| `GET /api/ice-config` unauthenticated | 200 | 200 |
| `GET /api/vpn/ZZNOSUCHUSER/register`, no token | 401 | 401 |
| same, `Bearer x` + `:userId` = `no` | 400 | 400 |
| same, `Bearer wrongtoken` | (not taken) | 403 |

Bodies: `Authorization: Bearer <token> header required`,
`userId must be 3-20 characters: A-Z, 0-9, underscore only`,
`Invalid or mismatched device token for userId` — unchanged. The 403 also
exercises the device-token lookup end to end through the shared middleware,
which the baseline had not covered.

Everything auth-related now lives in `lib/auth.ts`: `hashToken`,
`verifyDeviceToken`, `getAuthedAlias`, `checkAuth`, `deviceAuthMiddleware`.
No route defines its own.

⚠️ **The ordering is the whole point. Step 2 must not deploy before an app
release carrying step 1 is out.** No shipped build sends the header, so
enforcing first breaks builds 63 and 99 — the two devices from the 25 Aug
field test, and 63 is the build that reached App Store Connect.
**`/ice-config` is the dangerous one:** `app/call.tsx` fails OPEN to
STUN-only, so a 401 there does not error — it silently degrades calls for
anyone behind a symmetric NAT. Nothing would alert.

**Recommended window:** fold it into the build-72 AD cutover, which is already
a coordinated hard update where testers must move together (see the pre-ship
gates below). Coordination is already being paid for there.

**Deliberately unchanged:** `GET /blobs/:id` (UUIDv4 ids, ciphertext, key
never reaches the server — auth is defence-in-depth only there) and the invite
lookup/consume routes (the code is itself the bearer credential).

**Verification status, honestly:** the *server* half is covered — api-server
tests went 53 → 70: `auth.test.ts` (9, the shared gate, including both flag
states), `iceConfig.test.ts` (5, new), `blobs.test.ts` +3. Typecheck clean,
`npx eslint` clean on the changed files (repo-wide `pnpm run lint` still fails
on the pre-existing `lib/inviteRepository.ts` warning — not ours).

The *client* half is still typecheck-only. The app suite is 112/112 but does
not exercise `uploadEncryptedBlob`, `fetchIceConfig` or
`registerInviteOnServer`. There is also no route-level test for
`POST /invites`, because `routes/invites.ts` imports `@workspace/db` at module
load and cannot run without a database — its gate is covered in
`auth.test.ts` instead, which is the shared logic but not the route wiring.
**The invites route wiring and all three client call sites are unproven until
someone exercises them on a device.**

## ✅ RESOLVED INCIDENT — VPN peer agent down, box unfirewalled (24 Aug)

**Closed 24 Aug.** All three steps of the recorded fix order are done and the
control plane is verified end to end — for the first time since it was built.

**Resolution:**
1. **Unwedged.** Dropped the stalling host (`129.213.151.234`) *before*
   restarting, not after — the recorded order restarted first, which would
   have let the same still-connected client re-wedge the fresh process within
   seconds. New pid, `Recv-Q` back to 0, the six CLOSE-WAIT sockets gone,
   localhost answering in 5ms.
2. **Firewalled.** `infra/vpn-agent/firewall.sh` restricts tcp/8443 to the
   api-server's three Railway static outbound IPs plus localhost, via its own
   `VPNAGENT` chain — SSH, WireGuard and the INPUT policy untouched, so no
   lockout risk and `ufw` stays off. Static Outbound IPs had to be enabled on
   the Railway service first (they were off; Pro feature). Persisted across
   reboot by `vpn-agent-firewall.service`, ordered after `wg-quick@wg0`.
   Verified from an outside IP: 8443 now times out; SSH, api and coturn
   unaffected.
3. **Rewritten.** `infra/vpn-agent/agent.py` — now in the repo rather than
   only on the box. TLS moved off the accept loop (the root cause), threaded,
   backlog 5 -> 128, timeouts on handshake/request/`wg`, bounded
   Content-Length, and a `GET /healthz`. Reproduced the exact attack (7
   concurrent stalled TLS connections) against production: `/healthz` kept
   answering throughout.

**Two pre-existing bugs found while testing the rewrite locally, both latent
only because no peer had ever registered successfully:**
- `remove_peer_from_conf` corrupted `wg0.conf`. `re.split` consumes the
  newline before each `[Peer]` and `"".join(kept)` never restored it, welding
  sections together (`ListenPort = 51820[Peer]`) into a file `wg-quick` cannot
  parse. It corrupts from the **second** peer onward — it would have hit the
  day the VPN started working, and looked nothing like the agent.
- Making the server threaded turns that read-modify-write into a race. Config
  mutation is now serialised under a lock, and writes are atomic
  (temp + `os.replace`) so a crash cannot truncate the file `wg-quick` reads
  at boot.

**End-to-end verified** (throwaway alias `ZZVPNTEST1`, entirely through the
app's own API, no hand-written DB rows): register -> `200` in 1.15s returning a
full client config with `tunnelIp 10.66.0.2`; GET confirmed persistence; DELETE
removed the peer; identity deleted; alias confirmed gone. Prod left as found.
That `200` also proves the allowlist is correct — the api-server really does
egress from one of those three static IPs, which no label could confirm.

⚠️ **Standing coupling:** Railway reassigns static outbound IPs when a service
changes region, and api-server moved `sfo` -> `us-west2`. Another move breaks
peer registration silently and will look exactly like this incident. Re-run
`firewall.sh` with fresh values from
`railway outbound-network static-ip status --service api-server`.

**Still true: end-to-end tunnel is NOT achieved.** The control plane works; the
*client* does not exist yet (`lib/wireguard.ts` and AppContext wiring not
started, Network Extension entitlement not requested, EAS lacks a Go
toolchain). **Do not cancel or downgrade Mullvad.**

<details>
<summary>Original incident report (24 Aug) — kept for the diagnosis</summary>


Found by a read-only health check on 24 Aug ~08:50 UTC. **Nothing was changed
or fixed** — report-before-code. Full writeup was in the session scratchpad;
the substance is here.

**P0 — `vpn-agent` on `ghostface-vpn-eu1` is hard-wedged, and has never once
served a successful request.** systemd reports `active (running)`, so nothing
alerts, but the process answers nothing.
- pid 3443 is single-threaded (`nlwp 1`) and blocked in `tcp_recvmsg` /
  `sk_wait_data` reading fd 4 — an ESTAB connection from 129.213.151.234
  (Oracle Cloud, unrecognised). Listener sits at `Recv-Q 6 / Send-Q 5`: the
  accept queue is saturated past its backlog, so new SYNs are dropped and the
  port reads as "filtered" from outside. Six more conns from that same IP are
  in CLOSE-WAIT with 1780 unread bytes each. A TLS handshake from *localhost*
  times out, so this is the process, not the network.
- Never succeeded since its 23 Aug 07:19:57 start: `/etc/wireguard/wg0.conf`
  has mtime 23 Aug 06:58:36 — 21 min *before* the agent started — and holds 0
  `[Peer]` blocks; `wg show` lists no peers. Every successful POST /peer would
  have rewritten that file. **Any agent testing after 23 Aug 07:19 silently
  failed.**
- Root cause in `/etc/vpn-agent/agent.py`: `http.server.HTTPServer` is
  single-threaded with default `request_queue_size = 5`; no socket or handler
  timeout is set anywhere; and `ctx.wrap_socket(server.socket, server_side=True)`
  wraps the *listening* socket, putting the TLS handshake inline in the accept
  loop. One client that connects and stalls blocks the server forever. Not
  self-healing — `Restart=` never fires because the process never dies.
- Zero observability by design: `log_message` is overridden to `pass` (to keep
  the bearer token out of logs), so there is no request log and no liveness
  signal. Whatever replaces this needs a `GET /healthz`.
- Blast radius: all `POST`/`DELETE /vpn/:userId/register` fail. `callAgent`'s
  `timeout: 8_000` means prod fails cleanly rather than hanging Node — that
  part is correct. `GET` still works (DB-only). No user impact today: there is
  no working client yet. No DB/interface drift is possible either, because
  `POST` calls the agent *before* writing the DB, so a wedged agent inserts
  nothing. (`select count(*) from vpn_peers` was not run — should be 0.)

**P1 — the box has no firewall at all.** `ufw` is `inactive`; `nft` has no
`inet filter` table, only NAT/masquerade and a `policy accept` forward chain.
Ports 22 and 8443 were confirmed reachable from an unprivileged home IP.
(51820/udp unverified — WireGuard is silent to unauthenticated packets, so no
reply proves nothing.) This is not a host-vs-Hetzner-Cloud-firewall
distinction: the Oracle Cloud IP established a TCP connection to 8443, so
nothing upstream filters it either. That is how it reached and wedged the
agent. The bearer secret and pinned cert still gate *actions* — this is a
pre-auth availability hole, not peer injection.

**Verified healthy:** `wg-quick@wg0` active + enabled, wg0 = 10.66.0.1/24 +
fd66::1/64 on 51820; `ip_forward = 1`; NAT masquerade present (v4 + v6);
`GET /api/healthz` -> 200; VPN routes mounted with correct auth (401 no token,
403 bad token); all 5 `VPN_*` env vars present on Railway api-server prod.

**Fix order when Benji calls it:** (1) restart `vpn-agent` — seconds to
restore, but it will wedge again on the next stalled connection; (2) firewall
8443 to Railway egress only; (3) fix the agent properly —
`ThreadingHTTPServer`, per-connection timeout, wrap the socket per-connection
rather than the listener, add `GET /healthz`.

**Not done:** no live register -> verify -> delete round-trip. It is a prod
write (inserts `vpn_peers`, mutates `wg0`) and cannot pass until the agent is
unwedged — ask for it explicitly.

**Bearing on the Mullvad decision: end-to-end is NOT achieved.** Control plane
up != tunnel works. Do not cancel or downgrade Mullvad.

</details>

## 24 Aug session changes (cont.)

- **Native bridge module written, but exposed a second unrelated compiler
  bug that now blocks the full app build.** `native/vpn-tunnel/` (new dir,
  survives `expo prebuild --clean` same as `targets/`) holds
  `VPNTunnelModule.swift` + `.m` — a classic RN native module (`RCTEventEmitter`
  + `RCT_EXTERN_MODULE`, no new dependency: `expo-modules-core`'s presence
  was checked but this uses the plain React Native bridge module pattern
  instead, matching how `react-native-callkeep` etc. already work in this
  app) exposing `connect(config)`/`disconnect()`/`getStatus()`/`getLastError()`/
  `getRuntimeConfiguration()` plus a `VPNTunnelStatusDidChange` event, driving
  `NETunnelProviderManager` from the main app. `lib/vpnTunnelModule.ts` is
  the typed JS wrapper. `scripts/link-wireguard-kit.mjs` now also links
  `native/vpn-tunnel/` into the `GHOSTFACE` target as a synchronized group
  (Xcode 16's folder-reference mechanism, same one `@bacons/apple-targets`
  already uses for `targets/network-packet-tunnel/`) — verified correct via
  direct `.pbxproj` inspection (group created, added to `mainGroup`, added to
  the target's `fileSystemSynchronizedGroups`). tsc clean.
  - **New blocker, confirmed real via a controlled isolation test (2/2 both
    ways):** adding this module to the `GHOSTFACE` target's build graph
    causes `fmt` (pinned to `11.0.2` by RN 0.81's `RCT-Folly` podspec) to be
    compiled from source instead of coming from React Native's prebuilt
    `ReactNativeDependencies.xcframework` — and that from-source compile
    fails deterministically: `error: call to consteval function ... is not a
    constant expression` in `fmt/format-inl.h`. Root cause understood
    precisely: `fmt`'s own `base.h` decides whether to trust `consteval`
    based on `__apple_build_version__ >= 14000029` (a hardcoded "Apple Clang
    14+ has working consteval" assumption) — true for this machine's
    bleeding-edge Xcode/Clang, but the assumption is wrong for whatever
    specific Clang build ships with it. **Not fixable via a build-setting
    override** — confirmed by testing (`-D FMT_CONSTEVAL=` had zero effect;
    traced why: `fmt`'s header unconditionally `#define`s `FMT_USE_CONSTEVAL`/
    `FMT_CONSTEVAL` itself with no `#ifndef` guard, so any externally-injected
    value gets silently clobbered). A real fix needs either patching `fmt`'s
    header (via a `Podfile` `post_install` hook — `ios/Podfile` is
    regenerated every `expo prebuild`, so this would need a config plugin,
    not a one-off edit) or undefining a libc++ feature-test macro build-wide
    (`-U__cpp_lib_is_constant_evaluated`), which has a blast radius well
    past this one library. **Deliberately not applied without asking** — this
    is the *second* unrelated toolchain bug surfaced by this pre-release
    macOS 27 + stable Xcode 26.6 combination (first was the Explicit Modules
    `.pcm` cache bug, see above), and whether to keep patching around this
    specific OS or wait for a stable release is Benji's call, not mine to
    make unilaterally.
  - Not yet root-caused *why* adding one Objective-C-visible native module
    changes whether `fmt` gets pulled in from source at all — plausible but
    unconfirmed hypothesis: RN's New Architecture interop layer for legacy
    bridge modules pulls in Folly-dependent codegen output that the prebuilt
    binary doesn't cover. Untested whether a TurboModule (proper Codegen'd
    native module, not the legacy `RCT_EXTERN_MODULE` pattern) would avoid
    this.
  - `lib/wireguard.ts` (on-device keypair generation — `@noble/curves`
    already has `x25519`, no new dependency needed) and wiring
    `AppContext.tsx`'s mock `connectVPN()`/`disconnectVPN()` to this module
    are still not started.

## 24 Aug session changes

- **WireGuard native client: full local build now succeeds end-to-end.**
  Continuing the 23 Aug native-client work below. `networkpackettunnel`
  (the app extension) now compiles and links cleanly against the real
  `WireGuardKit`/`WireGuardKitC`/`WireGuardKitGo` core, producing a valid
  `networkpackettunnel.appex`, via one reproducible command:
  `npx expo prebuild -p ios --clean && node scripts/link-wireguard-kit.mjs
  && pnpm run ios:sim:build` (new npm script, `artifacts/ghostface/`).
  - **Root cause of the prior blocker**: Xcode's Explicit Modules build path
    hit a non-deterministic "module file ... not found" fatal error compiling
    `WireGuardKitC`'s C sources — traced to running stable Xcode 26.6 on
    pre-release macOS 27 (Homebrew itself flags this OS as unsupported).
    Neither of Benji's two suggestions ("delete xcode better" / "or
    rocketship") was the actual cause — confirmed via `xcodebuild -version`
    (genuinely stable 26.6, not a beta) and RocketSim only touching the
    Simulator runtime, not Xcode's build-time compiler.
  - **Fix**: `CLANG_ENABLE_EXPLICIT_MODULES=NO SWIFT_ENABLE_EXPLICIT_MODULES=NO`.
    This does NOT propagate through project.pbxproj-level build settings to
    the SPM package graph (confirmed empirically — a project-level-only
    version of the fix still failed) — it must be passed as an `xcodebuild`
    command-line override, which is why it's baked into the new
    `ios:sim:build` npm script rather than the linking script.
  - Also fixed along the way: an all-architectures build (arm64 + x86_64)
    fails on x86_64 alone — `libwg-go.a`'s Go runtime references
    `_fdopendir$INODE64`/`_readdir_r$INODE64`, symbols recent SDKs dropped
    for the Intel simulator slice. `ios:sim:build` forces `ARCHS=arm64
    ONLY_ACTIVE_ARCH=YES` (correct anyway on this Apple Silicon Mac).
  - **Workflow constraint confirmed**: only `expo prebuild --clean` is safe
    before `link-wireguard-kit.mjs` — a non-clean prebuild on top of the
    script's manual `project.pbxproj` mutations crashes
    `@bacons/apple-targets`' own diffing logic
    (`withIosXcodeProjectBeta2BaseMod: Cannot read properties of undefined`).
  - **Not yet done**: `targets/network-packet-tunnel/PacketTunnelProvider.swift`
    is still the unedited scaffold stub — the actual tunnel logic (wiring
    `WireGuardAdapter` to the `api-server` `/vpn/:userId/register` config)
    hasn't been written, nor has the main-app native bridge module for
    `NETunnelProviderManager` start/stop. EAS cloud build support (Go
    toolchain on EAS's build servers) also still outstanding — this build
    fix is proven locally only so far.
  - No git commit yet for any of this (`app.json`, `targets/`,
    `scripts/link-wireguard-kit.mjs`, `package.json` script + new
    devDependencies) — per this repo's report-before-code convention,
    holding until asked.

## 23 Aug session changes

- **GF-01: MinterEllison ENGAGED — materials sent, opinion due early next
  week (25 Aug).** Superseding the "held off" note below: the engagement went
  ahead. Materials (crypto inventory + research memo) were sent through to
  Sarah Salmond, and she has now confirmed receipt — "we'll review the
  materials and come back to you if we have any questions… we expect to
  provide our advice early next week." So the written opinion (both the US EAR
  mass-market/CCATS question and the NZ strategic-goods/cryptography question)
  is expected ~week of 1 Sep. **`eas submit` stays FROZEN until that written
  opinion lands**, and the `ITSAppUsesNonExemptEncryption: false` flag is to be
  re-decided against it before any submission. No action needed now beyond
  standing by for Sarah's questions. **Chase pinned to Wed 3 Sep** (gives her
  Mon/Tue of "early next week" first): if no written opinion by then, draft a
  short status-check reply on the existing MinterEllison thread — review
  before sending, don't chase blind. Torres/Wiley US outreach (22 Aug) can be stood down with a courtesy
  note if they reply, now that MinterEllison covers the US question in-house.
- **GF-01: MinterEllison replied, held off pending US firms.** Partner in
  MinterEllisonRuddWatts' International Trade and Regulatory team responded
  to the 19 Aug enquiry with a proposal: written opinion covering BOTH the
  US EAR mass-market/CCATS question AND the NZ strategic goods/cryptography
  exemption question, $4,000–$7,000 NZD + GST + office services charge,
  5 business days. Explicitly excludes engaging US counsel themselves unless
  their review says otherwise — i.e. their estimate assumes they answer the
  US question in-house too, which overlaps with the two US-specialist
  enquiries (Torres Trade Law, Wiley Rein) already in flight from 22 Aug.
  **Decision: held off, waiting for Torres/Wiley to reply first** — Benji's
  read is the crypto stack already meets mass-market self-classification
  guidelines, so paying MinterEllison now would mainly be paying for
  confirmation of a foregone conclusion. If the US firms come back with
  anything short of a clean opinion, MinterEllison's NZ-side coverage is
  still on the table — no reply sent to them yet, no engagement declined.
  Chase-Monday reminder from the prior update is now moot (they replied).

- **Self-hosted WireGuard VPN — infra and control-plane live, native client
  blocked on Go toolchain wiring.** Real (not mock) VPN, replacing the
  previous cosmetic `connectVPN()`/`disconnectVPN()` state-flip in
  `AppContext.tsx`:
  - Hetzner VPS `ghostface-vpn-eu1` (Nuremberg, cpx22) — WireGuard server on
    `wg0`. ⚠️ **This entry originally claimed the box was "firewalled to
    SSH(22)/WireGuard(51820 udp)/agent(8443 tcp) only" — that is not true
    of the running box; corrected 24 Aug, and the box was firewalled the
    same day — see RESOLVED INCIDENT at the top of this file.**
    A small Python-stdlib peer-management agent runs on it (bearer-secret +
    pinned self-signed TLS), adding/removing WireGuard peers.
  - `api-server`: `POST/GET/DELETE /vpn/:userId/register` (live in prod) —
    device generates its own keypair, sends only the public key; server
    allocates a 10.66.0.0/24 tunnel IP, persists to a new `vpn_peers` table
    (`lib/db/src/schema/vpn.ts`), and calls the box's agent.
  - Apple Developer portal: `com.ghostface.app` and new
    `com.ghostface.app.tunnel` (extension) App IDs both have Network
    Extensions + Personal VPN capabilities enabled. **Still needed**: the
    separate formal Network Extension entitlement request via
    https://developer.apple.com/contact/request/network-extension/ — has
    its own days/weeks approval lag, not yet submitted.
  - Mobile: `targets/network-packet-tunnel/` extension target scaffolded via
    `@bacons/apple-targets` (new devDependency, approved) + `@bacons/xcode`
    (also added). `scripts/link-wireguard-kit.mjs` links WireGuard's
    official `wireguard-apple` SPM package into the target as a
    post-prebuild step (config-plugin mod ordering made this unworkable as
    a plugin — see the script's own comments).
  - **Blocker**: official `WireGuardKit` needs a Go toolchain to compile its
    `wireguard-go-bridge` core via a manually-wired Xcode "External Build
    System" target — not something SPM or `@bacons/apple-targets` automates.
    Go 1.27.0 now installed locally (`brew install go`). EAS's cloud build
    servers do NOT have Go by default — a custom EAS build hook will be
    needed before cloud builds work, separate from local build support.
  - Old fake VPN UI already reworked: radial-menu VPN node turns gold
    (`#F5D26B`) when `vpnConnected`, was previously a no-op.
  - Do not cancel/downgrade any existing third-party VPN (e.g. Mullvad) —
    explicitly told to hold off until GHOSTFACE's VPN is tested end-to-end.

## 22 Aug session changes

- **GF-01 outreach widened.** Emails sent 22 Aug from benjamin@ghostface.co.nz
  to two US encryption-export specialists: Olga Torres (olga@torrestradelaw.com,
  Torres Trade Law) and Lori Scheetz (lscheetz@wiley.law, Wiley Rein). Bounded
  ask: one-page opinion on §740.17(b)(1) mass-market self-classification vs
  CCATS re kdfRkPQ, fixed fee requested. MinterEllison (original 19 Aug
  enquiry) replied 23 Aug — see above.
- Copies of counsel emails were forwarded to jjules@ — Benji's mother, an
  intended recipient, not a leak. ⚠️ However the two spellings used were
  `xtra.com` and `xtra.co`, while NZ Xtra addresses are `@xtra.co.nz`. Both
  domains used are real and separately owned, so confirm she actually
  received it; if not, the mail reached whoever holds jjules@ there.
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

## ⏳ OPEN LOOPS (a 20 Aug snapshot — NOT maintained)

⚠️ **This section is a dated snapshot, not live state.** Several bullets have
been overtaken by later sessions (see the dated "session changes" sections
above and TRACKER.md, both of which win over anything here). Superseded
bullets are struck through as they are found — an unstruck bullet in this
section is still not proof it is current. Verify before acting on one.

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

- ~~**GF-01 counsel email — STILL UNSENT, highest priority.**~~
  ✅ **SUPERSEDED — the email was sent.** This bullet was stale and
  dangerously so: a session acting on it would have re-sent an enquiry that
  is already with counsel. MinterEllisonRuddWatts is engaged, the materials
  (crypto inventory + research memo) went to Sarah Salmond from
  benjamin@ghostface.co.nz, and receipt is confirmed. Both questions are
  covered in-house (US EAR self-classification vs CCATS, and NZ strategic-
  goods / MFAT permit vs Wassenaar mass-market), with kdfRkPQ as the crux.
  Written opinion expected ~week of 1 Sep; **chase pinned to Wed 3 Sep**;
  `eas submit` stays FROZEN until it lands. Current detail is in
  "23 Aug session changes" above and the GF-01 row in TRACKER.md — this
  section is not the source of truth for GF-01.
- **Account lockouts:** ~~Google account locked~~ (**recovered — see 23 Aug
  session changes above**); CrazyDomains (registrar for
  ghostface.co.nz) locked. Vercel is reachable (via Google device). Still
  open as of 23 Aug:
  add a 2nd login method to Vercel before the Google session drops; start
  CrazyDomains ID recovery; CHECK DOMAIN EXPIRY (couldn't read whois from
  sandbox) — a locked registrar + expiring domain = losing the domain +
  api.ghostface.co.nz with it.
- ~~**Company email setup — DONE (19 Aug):** iCloud Custom Email Domain~~
  ✅ **SUPERSEDED 27 Aug — the domain is on Google Workspace, not iCloud.**
  Live DNS: MX `1 smtp.google.com`, SPF `v=spf1 include:_spf.google.com ~all`.
  Workspace took the domain over around 23 Aug. Five addresses now exist and
  all accept mail (delivery-tested 27 Aug, no bounces): benjamin@, support@,
  info@, legal@, admin@. DMARC added 27 Aug (`p=none`, monitor only,
  reports to admin@).
  DKIM published and **enabled** 27 Aug (`google._domainkey`, 2048-bit,
  selector `google`). Verified end to end by an external authentication
  check: SPF pass, DKIM pass (`header.d=ghostface.co.nz`), iprev pass, both
  aligned with the From domain. Next step, not urgent: let `rua` reports
  accumulate at admin@ for a week or two, then tighten `p=none` →
  `p=quarantine`. ⚠️ Still open: a mailbox password was pasted into a session
  transcript on 27 Aug and needs rotating.
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

1. **DB prekey check — RE-PASSED 2026-08-27**: 9/9 identities have complete
   signing + PQ material, all have a `delivery_id`, none is short of OPKs
   (8-10 unconsumed each). The 19 Aug pass was also 9/9 but had gone stale —
   every row in the table today was created 25 Aug or later, so it had been
   verified against a user population that has since turned over entirely.
   Re-run if anyone registers before shipping.
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

⚠️ This section is the ORIGINAL project-memory snapshot and has not been
maintained — treat TRACKER.md as authoritative for any GF-xx row.
GF-01 export compliance: ~~blocked on counsel referral, chase after 3–4
working days~~ — superseded: counsel engaged, materials sent, opinion due
~1 Sep, chase pinned Wed 3 Sep. GF-02: build-71 ASC questionnaire
screenshots → crypto
inventory. GF-07: iOS build pre-flight ready; `eas submit` forbidden
(GF-11 ASC API key broken + export block). Never run EAS builds without
explicit go-ahead — costs real money.
