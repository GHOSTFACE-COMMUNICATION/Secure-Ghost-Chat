# Locked-Screen Ring — Real-Device Smoke Test

Goal: confirm an incoming call rings a **locked** iPhone (CallKit full-screen sheet) and a **locked** Android phone (Core-Telecom full-screen ring), that answering from the lock screen lands in the in-app call screen, and that revoked push tokens are pruned server-side.

## 0. Prerequisites

- An Apple Developer account with the VoIP Services push capability for `com.ghostface.app` (the APNs VoIP key referenced by `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_VOIP_KEY`).
- A Firebase project matching the `FCM_SERVICE_ACCOUNT` secret, with `com.ghostface.app` registered as an Android app.
- A valid Expo access token (the current `EXPO_TOKEN` secret is **invalid/expired** — replace it, or log in locally with `eas login`).
- The API server reachable from the phones (published deployment, or the dev URL while the workspace is running).
- **Dev sideloads only:** set `APNS_USE_SANDBOX=1` on the API server so VoIP pushes target `api.sandbox.push.apple.com`. Development builds' tokens are rejected by the production APNs host as `BadDeviceToken` (the server logs a startup warning when `NODE_ENV` is not `production` but this var is unset). TestFlight/App Store builds use the production host — leave it unset there.

## 1. Build & sideload

From `artifacts/ghostface`:

```sh
# real iPhone (requires the device UDID registered on the Apple account)
eas device:create            # once per new iPhone
eas build --profile development:device --platform ios

# real Android phone (APK, installable directly)
eas build --profile development:device --platform android
```

Install each build (iOS: via the install link / TestFlight-style internal distribution; Android: download and open the APK).

## 2. Register two accounts

1. On each phone, open GHOSTFACE, complete onboarding, and sign in as two different aliases (one per phone, or one phone + the web preview as the caller).
2. Confirm token registration: on the server DB, `select transport, platform from call_push_tokens;` should show an `apns-voip` row for the iPhone and an `fcm` row for the Android phone.

## 3. Locked-screen ring — iOS

1. Lock the iPhone. Force-quit the app (swipe away) to prove the push wakes it.
2. From the other account, start a call to the iPhone's alias.
3. **Expect:** the full-screen CallKit incoming-call sheet appears on the lock screen within ~2–5 s, with the caller alias and ringtone, without unlocking.
4. Tap answer. **Expect:** after Face ID/passcode, the app opens directly on the in-app call screen with live audio.
5. Repeat once with the app merely backgrounded (not force-quit).

## 4. Locked-screen ring — Android

1. Lock the Android phone; force-stop the app.
2. Call its alias from the other account.
3. **Expect:** the Core-Telecom full-screen incoming-call UI over the lock screen with ringtone/vibration. (First run: grant the "Display over other apps"/full-screen intent permission if prompted, then retest.)
4. Answer from the lock screen. **Expect:** routes into the in-app call screen with live audio.

## 5. Bad-token pruning

1. Uninstall the app from one phone (this revokes its push token).
2. Call that alias again from the other account.
3. **Expect (server logs):** APNs returns `410/BadDeviceToken/Unregistered` or FCM returns `404/UNREGISTERED`, and the sender logs pruning of the token.
4. Verify: `select * from call_push_tokens;` — the revoked token's row is gone.

## 6. Pass criteria checklist

- [ ] iOS: CallKit sheet on lock screen, app force-quit
- [ ] iOS: answer from lock screen → in-app call screen, audio both ways
- [ ] Android: full-screen ring on lock screen, app force-stopped
- [ ] Android: answer from lock screen → in-app call screen, audio both ways
- [ ] Revoked token pruned from `call_push_tokens` after one failed send

If any step fails, capture: server logs around the push send (`nativeCallPushSender`), device OS logs (iOS: Console.app filtered to `PushKit`; Android: `adb logcat -s Telecom`), and the `call_push_tokens` rows for the alias.
