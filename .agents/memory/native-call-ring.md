---
name: Native full-screen call ring
description: How locked-device call ringing works (CallKit/Core-Telecom) and its constraints
---

# Native full-screen call ring

- Library: `expo-callkit-telecom` (Expo module, New-Arch OK) — chosen over react-native-callkeep + react-native-voip-push-notification, which have open New Arch / SDK 54 issues.
- **Why:** it parses APNs VoIP (PushKit) and FCM data pushes natively before JS runs, so cold-start ringing works, and it ships an Expo config plugin.
- It requires the `@livekit/react-native-webrtc` fork as the WebRTC impl (replaces `react-native-webrtc`; the two cannot coexist). The fork's RTCAudioSession is coordinated with CallKit by the module — don't reintroduce plain react-native-webrtc.
- Privacy contract: VoIP/FCM push payloads stay identity-free (opaque serverCallId + mode, caller shown as generic "GHOSTFACE"); real alias arrives via the encrypted WS parked-ring replay. Any new push field must clear the same bar.
- A device registers exactly ONE call-push transport (native apns-voip/fcm in dev builds, else expo alert token) — registering both would double-ring.
- Server sending needs credentials via env: APNS_VOIP_KEY/APNS_KEY_ID/APNS_TEAM_ID (+APNS_BUNDLE_ID, APNS_USE_SANDBOX) for iOS, FCM_SERVICE_ACCOUNT JSON for Android. Unconfigured transports are skipped and excluded from "can we push?" checks.
- None of this is verifiable in the workspace — it needs an EAS dev build on a real device; Expo Go has no remote push at all (SDK 53+).

**How to apply:** touching call push, ring UX, or webrtc deps — keep the transport split, the identity-free payload, and the livekit fork.
