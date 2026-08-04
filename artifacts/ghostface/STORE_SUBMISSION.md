# GHOSTFACE — App Store & Google Play Submission Guide

## Prerequisites

### Accounts Required
- **Apple**: [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year)
- **Google**: [Google Play Console](https://play.google.com/console) account ($25 one-time fee)
- **Expo**: Free account at [expo.dev](https://expo.dev) — run `npx eas login`

### Tools Required
```bash
npm install -g eas-cli
eas login
```

---

## Step 1 — Link Your EAS Project

Run once to associate this project with your Expo account:

```bash
cd artifacts/ghostface
eas init
```

This will create an EAS project and populate `extra.eas.projectId` in `app.json` automatically with a real UUID.

---

## Step 2 — Configure Signing Credentials

### iOS (App Store)
EAS can manage certificates and provisioning profiles automatically:
```bash
eas credentials --platform ios
```
Choose **"Let EAS handle this"** when prompted. You will need your Apple Developer account login.

### Android (Google Play)
EAS can generate a keystore automatically:
```bash
eas credentials --platform android
```
Save the keystore file and passwords in a secure location — you'll need them for every future release.

---

## Step 3 — Trigger Production Builds

### Build iOS (.ipa)
```bash
eas build --platform ios --profile production
```

### Build Android (.aab)
```bash
eas build --platform android --profile production
```

### Build Both Simultaneously
```bash
eas build --platform all --profile production
```

Build progress can be monitored at [expo.dev/builds](https://expo.dev/builds) or in the terminal. iOS builds typically take 15–25 minutes; Android builds take 5–15 minutes.

---

## Step 4 — Download Build Artifacts

Once complete, EAS prints a download URL. You can also download from the Expo dashboard:
1. Go to [expo.dev](https://expo.dev) → Your Project → **Builds**
2. Click the completed build
3. Download the `.ipa` (iOS) or `.aab` (Android) file

---

## Step 5 — Submit to App Store (iOS)

### Option A: Automated via EAS Submit

Before running, update `eas.json` → `submit.production.ios.ascAppId` with your real App Store Connect App ID (found in App Store Connect → App → App Information → Apple ID field).

```bash
eas submit --platform ios --profile production
```

You will be prompted interactively for your Apple ID and Apple Team ID. To pass them non-interactively:
```bash
eas submit --platform ios --profile production \
  --apple-id YOUR_APPLE_ID@example.com \
  --apple-team-id YOUR_APPLE_TEAM_ID
```

### Option B: Manual via Transporter
1. Download [Transporter](https://apps.apple.com/us/app/transporter/id1450874784) from Mac App Store
2. Sign in with your Apple ID
3. Drag and drop the `.ipa` file
4. Click **Deliver**
5. Go to [App Store Connect](https://appstoreconnect.apple.com) → Your App → **TestFlight** or **App Store** tab to complete the submission

---

## Step 6 — Submit to Google Play (Android)

### Option A: Automated via EAS Submit

You will need a Google Play service account JSON key. See [EAS Submit docs](https://docs.expo.dev/submit/android/) for setup steps. Save the key file to your project root as `google-service-account.json` (do not commit to version control), then run:
```bash
eas submit --platform android --profile production \
  --android-service-account-key-path ./google-service-account.json
```

### Option B: Manual via Google Play Console
1. Go to [Google Play Console](https://play.google.com/console)
2. Select your app (or create a new one)
3. Navigate to **Production** → **Create new release**
4. Upload the `.aab` file
5. Fill in release notes and submit for review

---

## Store Listing Assets Needed

### App Icon
- **iOS**: 1024×1024 PNG, no alpha channel, no rounded corners (Apple applies mask automatically)
  - Current `assets/images/icon.png` — verify it is exactly 1024×1024
- **Android**: 512×512 PNG for the store listing icon (separate from the adaptive icon in the app)

### Screenshots
You must capture screenshots on real devices or simulators for each required device size:

#### iOS (Required sizes)
| Device | Resolution |
|--------|-----------|
| iPhone 6.9" (iPhone 16 Pro Max) | 1320×2868 or 1290×2796 |
| iPhone 6.5" (iPhone 14 Plus / 15 Plus) | 1284×2778 |
| iPad Pro 13" (if supporting iPad) | 2064×2752 |

**Minimum**: 3 screenshots per size. Recommended: 5–8 screenshots.

#### Android (Required sizes)
| Type | Requirements |
|------|-------------|
| Phone screenshots | At least 2, 16:9 or 9:16, min 320px on shortest side |
| 7" tablet (optional) | Same ratio requirements |
| 10" tablet (optional) | Same ratio requirements |

### Feature Graphic (Android only)
- 1024×500 PNG or JPEG — displayed at the top of the Play Store listing

### Recommended Screenshots to Capture
1. **Onboarding screen** — ghost logo and tagline "NO FACE. NO TRACE."
2. **Lock screen** — PIN entry or biometric prompt
3. **Messages list** — encrypted conversation list
4. **Active chat** — encrypted message thread with self-destruct indicator
5. **Security Audit screen** — showing security score
6. **Settings screen** — showing biometric and privacy toggles
7. **Wallet screen** — anonymized payment flow

---

## App Store Connect Setup (iOS)

Before submitting, complete the following in App Store Connect:

1. **Create your app** at [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
   - Bundle ID: `com.ghostface.app`
   - SKU: `ghostface-app-001` (any unique string)

2. **App Information**
   - Name: GHOSTFACE
   - Subtitle: Private & Anonymous Messaging
   - Category: Utilities (Primary), Social Networking (Secondary)
   - Privacy Policy URL: `https://ghostface.app/privacy`

3. **App Privacy** (required)
   - Complete the Data & Privacy questionnaire
   - GHOSTFACE collects: no data linked to identity
   - Note encryption and local-only storage where applicable

4. **Version Information**
   - Description: Write a compelling description (up to 4,000 chars)
   - Keywords: private messaging, anonymous, encrypted, NFC, no trace, secure chat
   - Support URL: Your support URL
   - Marketing URL: `https://ghostface.app`

5. **Age Rating**: Complete the content rating questionnaire (expected: 4+)

6. **Export Compliance**: App uses real non-exempt encryption (Signal-protocol E2E messaging) — `ITSAppUsesNonExemptEncryption` is `true` in app.json. In the questionnaire, answer "Yes" to uses encryption, and "No" to qualifying for EAR Category 5 Part 2 exemptions, then complete the self-classification report step.

---

## Google Play Console Setup (Android)

1. **Create your app** at [play.google.com/console](https://play.google.com/console)
   - Package name: `com.ghostface.app`
   - Default language: English (United States)

2. **Store Listing**
   - Short description (80 chars): Private, encrypted messaging with NFC anonymity
   - Full description (4,000 chars): Write detailed description
   - App icon, feature graphic, and screenshots

3. **Content Rating**
   - Complete the IARC questionnaire (expected: Everyone or Teen)

4. **Data Safety**
   - Disclose what data the app collects, processes, or shares
   - GHOSTFACE: No personal data collected, no data shared with third parties

5. **App Category**: Communication (Primary)

6. **Privacy Policy**: Enter your privacy policy URL

---

## Build Version Management

Build numbers are auto-incremented by EAS (`"autoIncrement": true` in `eas.json`).

To manually bump the user-facing version (e.g., 1.0.0 → 1.1.0):
- Update `"version"` in `app.json`
- The build number/versionCode will still auto-increment via EAS

---

## Development & Preview Builds

### Run on iOS Simulator
```bash
eas build --platform ios --profile development
```

### Run on Physical Android Device (APK)
```bash
eas build --platform android --profile preview
npx expo install expo-dev-client
```

### Local Development (Expo Go)
```bash
pnpm run dev
```

---

## Useful Links

- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [EAS Submit Documentation](https://docs.expo.dev/submit/introduction/)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Policy Center](https://play.google.com/about/developer-content-policy/)
- [App Store Connect](https://appstoreconnect.apple.com)
- [Google Play Console](https://play.google.com/console)
