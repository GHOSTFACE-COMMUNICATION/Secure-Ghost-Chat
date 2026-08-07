# GHOSTFACE Phase 2: Native Calling Infrastructure (PushKit + CallKit)

**Status: planning only.** `CALLING_PUSH_ENABLED = false` (`lib/callPush.ts`). No packages installed, no `app.json` changes applied, no native builds run. Nothing in this document has been executed.

## Background

The calling media path already works: `react-native-webrtc`, offer/answer/ICE negotiation over the app's existing WebSocket, ICE servers from `/api/ice-config` (see `app/call.tsx`). What's missing is the wake-up layer — a callee with the app backgrounded or killed currently gets nothing; the whole flow only works while both ends have the app open and the WebSocket connected.

## 1. Library evaluation — why not react-native-callkeep / react-native-voip-push-notification

Both were the original Phase 2 candidates. Both were rejected before any install, per research documented here.

**`react-native-callkeep`** (latest 4.3.16, published Nov 2024 — stale):
- A community config plugin exists (`@config-plugins/react-native-callkeep`) and version `12.0.0` (Sep 2025) correctly targets `expo: ^54`, matching this project.
- But: open, unresolved New Architecture bug — issues [#798](https://github.com/react-native-webrtc/react-native-callkeep/issues/798) / [#857](https://github.com/react-native-webrtc/react-native-callkeep/issues/857), *"Module exports two methods to JavaScript with the same name"*, breaking TurboModule interop specifically for **`displayIncomingCall`** — the exact call this feature depends on. [#822](https://github.com/react-native-webrtc/react-native-callkeep/issues/822) ("planning to support New Architecture?") has sat unanswered since Dec 2024. [#869](https://github.com/react-native-webrtc/react-native-callkeep/issues/869) reports a build-breaking bridging-header failure against RN 0.81.5/Expo SDK 54 specifically, also unresolved.
- This project has `newArchEnabled: true` — exactly where callkeep's gaps are.

**`react-native-voip-push-notification`** (latest 3.3.3, Apr 2025):
- No maintained Expo config plugin exists at all ([expo/config-plugins#115](https://github.com/expo/config-plugins/issues/115), open since 2022, never implemented).
- Multiple open Expo-integration issues, including [#118](https://github.com/react-native-webrtc/react-native-voip-push-notification/issues/118): the notification listener doesn't fire when the app wakes from a killed state — directly undermines the entire point of this feature.

**Chosen alternative: `expo-callkit-telecom`** ([mfairley](https://github.com/mfairley/expo-callkit-telecom)):
- Actively maintained: latest 0.4.1, published 2026-07-30.
- Built on `ExpoModulesCore` (Expo's own module system, New-Architecture-native by design) rather than a legacy bridge module — structurally a better starting position than callkeep.
- Full PushKit implementation confirmed by reading the actual Swift source: `ios/Managers/VoIPPushManager.swift` implements `PKPushRegistryDelegate` (`didUpdate pushCredentials`, `didInvalidatePushTokenFor`, `didReceiveIncomingPushWith payload`), auto-registered on launch via `AppDelegateSubscriber.swift` (`ExpoAppDelegateSubscriber` hook — no manual `AppDelegate` edits). The payload-handling doc comment explicitly states it must report to CallKit before returning, per Apple's requirement.
- Exports match GHOSTFACE's WebRTC usage 1:1 on the media side — not directly relevant to CallKit/PushKit, but relevant to the migration below.
- Two platform-specific blockers, each with its own plan (sections 2 and 3).
- Real risk carried forward, not resolved: LiveKit's own README states its WebRTC fork *"shouldn't be used independently"* of the LiveKit SDK — GHOSTFACE would use it standalone. One external adopter (issue #21 on the callkit-telecom repo) did this successfully, but it's one data point, not a support guarantee.

## 2. iOS: WebRTC migration plan

**Blocker:** `expo-callkit-telecom`'s iOS podspec hard-depends on `WebRTC-SDK` + `livekit-react-native-webrtc`. GHOSTFACE currently uses plain `react-native-webrtc`, which resolves to `JitsiWebRTC`. The two pods vend identical WebRTC symbols and cannot coexist in one build — confirmed both by the podspec (`s.dependency 'WebRTC-SDK'`, `s.dependency 'livekit-react-native-webrtc'`) and by `ios/Podfile.lock` in this project, which currently resolves `JitsiWebRTC (124.0.2)`.

### Current state (confirmed empirically)
- `package.json`: `react-native-webrtc: ^124.0.7`
- `ios/Podfile.lock` (gitignored, regenerated — not source of truth, but confirms resolution): `JitsiWebRTC (124.0.2)`
- **Exactly one file** touches `react-native-webrtc`: `app/call.tsx`. Dynamically `require()`'d, destructures `RTCPeerConnection`, `RTCSessionDescription`, `RTCIceCandidate`, `mediaDevices`. No `RTCView` usage anywhere (remote video isn't actually rendered yet — a stored-but-unused stream, per an existing TODO comment).
- No Expo config plugin currently used for `react-native-webrtc` — autolinks, camera/mic permission strings already satisfied by existing `app.json` entries.
- `registerGlobals()` is never called anywhere in this codebase.

### Target
`@livekit/react-native-webrtc@144.1.2` (published 2026-07-23). Confirmed via its actual `lib/typescript/index.d.ts` that it exports the identical names GHOSTFACE uses (`RTCPeerConnection`, `RTCSessionDescription`, `RTCIceCandidate`, `mediaDevices`, plus `MediaStream`, `MediaStreamTrack`, `RTCView`). A real fork, not a rewrite — drop-in JS surface for what's used today.

### Steps
1. `package.json`: swap `react-native-webrtc` → `@livekit/react-native-webrtc@^144.1.2`. No other dependency in the tree references `react-native-webrtc`, so no `overrides`/`resolutions` needed.
2. `app/call.tsx`: change the one `require("react-native-webrtc")` to `require("@livekit/react-native-webrtc")`. Same destructured names, same method calls — this should be the entire code change.
3. `expo prebuild --platform ios --clean` (local codegen, not a build) → confirm `Podfile.lock` resolves to `WebRTC-SDK 144.x` with zero `JitsiWebRTC` anywhere in the graph.
4. Confirm no new config plugin is required — the fork's docs mention an out-of-tree `config-plugins/react-native-webrtc` package as an option, not a stated requirement; verify against the prebuilt output from step 3 rather than assuming.
5. Only after this migration passes verification does `expo-callkit-telecom` get added on iOS — hard prerequisite, not parallel work.

### Risk register
- LiveKit's explicit "shouldn't be used independently" warning — the single biggest risk in this plan.
- WebRTC engine jump M124 → M144: possible behavioral drift in ICE/DTLS/codec negotiation. This codebase already has one documented cross-library audio-session gotcha (`Audio.setAudioModeAsync` conflict, noted in `call.tsx`) from a past interaction — a new WebRTC engine version is exactly the kind of change that could resurface something similar.
- No test CI on `expo-callkit-telecom` itself — manual verification carries more weight than usual.
- Android is untouched by this specific migration (confirmed via issue #21: Android/JS have zero WebRTC-fork coupling) — but Android has its own separate blocker (section 3).

### Verification checklist
- [ ] `expo prebuild --clean` → `Podfile.lock` shows `WebRTC-SDK`, zero `JitsiWebRTC`.
- [ ] Voice call, both directions (caller and callee role) — audio actually flows.
- [ ] Video call — camera capture starts correctly.
- [ ] Mute toggle still silences the correct track.
- [ ] Call teardown still fully releases the mic (re-check against the exact regression the prior `54e7650` fix guarded against).
- [ ] App backgrounding mid-call still behaves per the existing unmount-cleanup logic in `call.tsx`.
- [ ] Web platform path (`Platform.OS === "web"`) unaffected — confirm the native-only conditional still gates correctly.

### Rollback
Single-commit revert: one dependency swap, one `require()` string. No native-config rollback needed since no `app.json`/entitlements changes are part of this migration.

## 3. Android: FCM crash fix plan (expo-callkit-telecom issue #27)

**Blocker:** confirmed via `grep` that this repo has zero Firebase presence anywhere — no `google-services.json`, no Firebase reference in `package.json` or any `.gradle` file. `expo-callkit-telecom`'s Android module will crash on init with certainty, not just possibly, until this is fixed.

### Root cause, exact source
`android/src/main/java/expo/modules/callkittelecom/managers/VoIPPushManager.kt`:

```kotlin
fun register() {
    FirebaseMessaging.getInstance()   // throws IllegalStateException here, synchronously,
        .token                        // if no default FirebaseApp is initialized
        .addOnSuccessListener { newToken -> updateToken(newToken) }
        .addOnFailureListener { error -> Log.e(TAG, "Failed to get FCM token: ${error.message}", error) }
}
```

Called from `ExpoCallKitTelecomModule.kt`'s `OnCreate`, sandwiched between two calls that must run:

```kotlin
OnCreate {
    val context = appContext.reactContext ?: return@OnCreate
    CallManager.shared.initialize(context)
    VoIPPushManager.register()                                    // <-- throws here
    CallEventEmitter.setSender { eventName, body -> sendEvent(eventName, body) }  // never runs
    handleLaunchIntent()                                          // never runs — cold-start answer broken too
}
```

Blast radius is bigger than "no FCM": no call events reach JS at all, and cold-start answer (tapping the notification action from a killed app) never fires. Confirmed still open on GitHub, zero comments, unfixed.

### Fix mechanism
`patch-package`, not a config plugin — this is a bug in the dependency's own source inside `node_modules`, not in the native project `expo prebuild` generates from `app.json`/plugins (the wrong layer for patching a dependency's own file). `patch-package` is not currently a dependency in this project; would need adding.

### The patch
```diff
--- a/node_modules/expo-callkit-telecom/android/src/main/java/expo/modules/callkittelecom/managers/VoIPPushManager.kt
+++ b/node_modules/expo-callkit-telecom/android/src/main/java/expo/modules/callkittelecom/managers/VoIPPushManager.kt
@@ -21,10 +21,18 @@
-    /** Registers for FCM push tokens by fetching the current token. */
+    /**
+     * Registers for FCM push tokens by fetching the current token.
+     *
+     * No-ops (with a warning log) if the default FirebaseApp isn't initialized — apps with no
+     * google-services.json (self-hosted signaling, no FCM) still get CallManager/CallEventEmitter
+     * wired up and reportIncomingCall() keeps working; only the FCM token path is skipped.
+     * See https://github.com/mfairley/expo-callkit-telecom/issues/27
+     */
     fun register() {
-        FirebaseMessaging.getInstance()
-            .token
+        val firebaseMessaging =
+            try {
+                FirebaseMessaging.getInstance()
+            } catch (e: IllegalStateException) {
+                Log.w(TAG, "FirebaseMessaging unavailable (no default FirebaseApp) — skipping FCM token registration", e)
+                return
+            }
+        firebaseMessaging.token
             .addOnSuccessListener { newToken -> updateToken(newToken) }
             .addOnFailureListener { error ->
                 Log.e(TAG, "Failed to get FCM token: ${error.message}", error)
```

Matches the fix the issue's own reporter already runs locally. Behavior when Firebase *is* configured is unchanged.

### Steps (once `expo-callkit-telecom` is installed)
1. `npm install --save-dev patch-package` + add `"postinstall": "patch-package"` to `package.json` scripts.
2. Hand-edit the file above inside `node_modules` with the diff shown.
3. `npx patch-package expo-callkit-telecom` → writes `patches/expo-callkit-telecom+<version>.patch`.
4. Commit `patches/` — durable across reinstalls and EAS builds (`npm install` triggers `postinstall`, which reapplies the patch before Gradle sees the unpatched source).
5. `expo prebuild --platform android --clean` to confirm the patched file lands in the generated project.

### Risk register
- Patch drift on `expo-callkit-telecom` version bumps — `patch-package` fails loudly (correct failure mode) rather than silently applying a stale patch; each bump needs a manual recheck.
- This is a workaround, not a merged fix — should be dropped once/if the maintainer merges a real fix.
- Only fixes the crash, not full Android FCM functionality — "FCM high-priority arrival" itself remains a separate, later piece of work.

### Verification checklist
- [ ] `expo prebuild --clean` (android) → confirm patched source in the generated tree.
- [ ] Local debug build, no `google-services.json` → app launches without the crash in `adb logcat`.
- [ ] `CallEventEmitter.setSender` actually wires up post-patch (a call event round-trips to JS).
- [ ] Cold-start answer path (`handleLaunchIntent()`) fires from a killed state.
- [ ] Clean `npm install` reapplies the patch automatically (tests the `postinstall` wiring, not just the patch content).

### Rollback
Remove `patches/expo-callkit-telecom+*.patch`, the `postinstall` script line, and the `patch-package` devDependency.

## 4. Sequencing: Android → iOS

The two blockers above are independent — no shared files, no shared native code. Android goes first, for one reason: **which fix risks code that already works.**

- Android's blocker is a bug in a third-party dependency's own init path, patched via `patch-package`. It touches zero lines of GHOSTFACE's existing code. Worst case: Android push still doesn't work — no regression to anything shipping today.
- iOS's blocker touches `app/call.tsx` and the actual calling media pipeline — the one thing this effort was told to leave alone. That risk deserves full isolated verification before CallKit/PushKit wiring lands on top of it, so a regression can be attributed to one change, not two landing together.
- Doing Android first also proves the JS-side integration pattern (feature-flag gating, `registerVoipToken` wiring, event-listener shape, answer/decline → `app/call.tsx` routing) once, in isolation — iOS then only adds its platform-specific half on top of an already-validated pattern.

**Scope correction:** the original Phase 2 task list assumed `react-native-callkeep` + raw Android `ConnectionService` + hand-rolled FCM. Having pivoted to `expo-callkit-telecom`, Android actually goes through **Jetpack Core-Telecom** (`androidx.core:core-telecom`) — newer and less battle-tested than `ConnectionService` — and the FCM receiving service is auto-registered by the package's own config plugin rather than hand-built. Less manual work than originally scoped, but resting on a less-proven platform API.

### Stages

**Stage 0 — done, no gate.** `lib/callPush.ts` (feature flag, payload contract, token-endpoint contract) exists, inert, imports neither evaluated-and-rejected library.

**Stage 1 — Android FCM patch, in isolation.** Apply the section 3 patch. Install `expo-callkit-telecom`. Wire Android JS: FCM token → `registerVoipToken()`, `reportIncomingCall`/answer/decline events → `app/call.tsx` routing.
Gate: manually-triggered `reportIncomingCall()` produces native incoming-call UI; answer routes into the existing WS-based call flow; decline sends `call-hangup`. Existing Android voice/video calling re-verified unchanged.

**Stage 2 — iOS WebRTC migration, in isolation, no CallKit/PushKit code yet.** Execute section 2. Nothing from `expo-callkit-telecom` wired on iOS yet.
Gate: full iOS calling verification checklist (section 2) passes before any CallKit code lands.

**Stage 3 — iOS CallKit/PushKit wiring**, on top of the now-migrated WebRTC. `PKPushRegistry` auto-registers via `AppDelegateSubscriber` — nothing to hand-write there. JS side reuses the pattern proven in Stage 1: token-updated event → `registerVoipToken()`, answer/decline → `app/call.tsx`.
Gate: same manual-trigger incoming-call test as Stage 1, iOS side.

**Stage 4 — cross-platform, once both native halves exist.**
- `app.json` diff finalized (`UIBackgroundModes: [voip, audio]` + the actual plugin entries — deliberately left as a placeholder earlier since the plugin choice wasn't settled).
- CallKit privacy display config: generic "GHOSTFACE Call" label, alias-only, Recents-inclusion toggle point documented for a future opt-in.
- Payload-contract wiring against the schema `expo-callkit-telecom` actually expects (the `"incomingCall"`-keyed shape, per its 0.3.9 changelog).

**Stage 5 — Phase 3 dependency.** Everything above can be built and manually verified (triggering `reportIncomingCall` directly from a dev-only call, bypassing real push delivery) without Phase 3 existing. Real end-to-end testing needs the server-side token registry and push-sending, which is out of scope here. `CALLING_PUSH_ENABLED` stays `false` through every stage; it flips only once Stage 4 is verified on both platforms **and** Phase 3 ships.

## Appendix A — payload contract & token endpoint (implemented, inert)

`lib/callPush.ts`:
- `CALLING_PUSH_ENABLED = false`
- `VoipPushPayload = { callId: string; mode: "voice" | "video" }` — opaque callId only, no alias/name; caller identity resolves in-app post-wake over the existing encrypted WS channel.
- `registerVoipToken(token, platform, alias)` — `POST {apiBase}/calls/register-voip-token`, body `{ token, platform, alias }`, `204` on success. No-ops while the flag is off. Server side is Phase 3.

## Appendix B — infoPlist audit correction

`NSMicrophoneUsageDescription` is already present in `app.json` and has been since the earliest commit in this repo's history — it was not a pending/missing item. The original silent-mic bug's actual root cause (a separate, already-fixed `Audio.setAudioModeAsync` conflict in `app/call.tsx`) is unrelated to this string. No other genuinely-missing permission strings were found referenced anywhere in the codebase.
