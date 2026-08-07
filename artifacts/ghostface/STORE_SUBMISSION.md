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

You will need a Google Play service account JSON key. `eas.json` → `submit.production.android.serviceAccountKeyPath` already points at `./google-service-account.json` (gitignored — never commit this file). Generate the key first:

#### Generating the service account key
1. **Link a Google Cloud project to Play Console** (skip if already linked): [Play Console](https://play.google.com/console) → **Setup** → **API access**. If no Cloud project is linked, Play Console will offer to create/link one — do that.
2. **Create the service account**: still on **Setup → API access**, click **Create new service account**. This opens Google Cloud Console with a pre-filled service account creation form — follow it through (name it something like `ghostface-eas-submit`), no special IAM roles needed at the Cloud project level.
3. **Generate the JSON key**: in Google Cloud Console → **IAM & Admin** → **Service Accounts**, select the account you just created → **Keys** tab → **Add Key** → **Create new key** → type **JSON** → Create. This downloads the key file to your machine.
4. **Grant Play Console permissions**: back in Play Console → **Setup → API access**, find the new service account under "Service accounts" and click **Manage Play Console permissions**. Grant:
   - **Releases**: at least "Release apps to production, exclude devices, and use Play App Signing" (required for the `track: "production"` / `releaseStatus: "completed"` config in `eas.json`)
   - **App information**: view access (EAS needs to read app metadata)
5. **Move the key into place**: rename/move the downloaded JSON file to `google-service-account.json` in the project root (`artifacts/ghostface/`) — matches the gitignore entry and the `serviceAccountKeyPath` already set in `eas.json`.
6. **Verify and submit**:
```bash
eas submit --platform android --profile production --latest
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

## Store Listing Copy (Draft v1.0)

### Promotional text (170 char max, editable anytime without review)
> No Face. No Trace. Encrypted messaging, disposable numbers, and a crypto wallet — built for people who don't want to be found.

### Description (4000 char max)
```
GHOSTFACE is a privacy-first communications app for people who want to talk, call, and pay without leaving a trail.

No phone number required to sign up. No email. Just an alias and a PIN.

FEATURES

Encrypted Messaging
Every conversation is end-to-end encrypted. Only you and the person you're talking to can read what's sent.

Ghost Numbers
Get disposable, rotating phone numbers for SMS and calls — keep your real number private.

Encrypted Calls
Voice and video calls, encrypted end-to-end.

GHOSTPAD
A live shared scratchpad you can pair with anyone using a one-time code — no accounts, no history.

Crypto Wallet
Built-in Solana wallet for sending and receiving crypto, with support for GHOST and CASPER tokens.

VPN Dashboard
Monitor your connection status across multiple server locations.

Panic Wipe
Hold the panic button for 3 seconds to instantly and irreversibly wipe all local data.

Decoy Mode
Unlock into a harmless-looking empty app under duress, keeping your real data hidden.

Biometric Lock
Face ID / Touch ID and PIN protection on every launch.

GHOSTFACE is built for anyone who values privacy — journalists, activists, or anyone who just doesn't want their communications tracked, sold, or subpoenaed.

No Face. No Trace.
```

### Keywords (100 char max, comma-separated, no spaces after commas)
```
privacy,encrypted,messaging,anonymous,burner number,secure chat,e2ee,crypto wallet,vpn,disposable
```

### What's New in This Version
```
Initial release: encrypted messaging, ghost numbers, encrypted calls, GHOSTPAD, Solana wallet, VPN dashboard, panic wipe, and decoy mode.
```

### Support URL
```
mailto:support@ghostface.app
```
Added to `app.json` → `extra.supportUrl` alongside the existing `marketingUrl`/`privacyPolicyUrl` entries (those two aren't wired into any Apple/EAS build step either — none of the three are referenced anywhere in the app code, they're metadata only). Use `mailto:support@ghostface.app` directly in the App Store Connect "Support URL" field.

**Before submitting**: `support@ghostface.app` needs to actually be a working inbox, or Apple's review (and real users) will get bounces. Since `ghostface.app` is already pointed at this repo's Railway server (`server/serve.js`), the domain itself doesn't do email — you'll need to add email routing at the DNS level (e.g. Cloudflare Email Routing is free and just forwards `support@ghostface.app` to whatever inbox you choose) before this goes live. That's a registrar/DNS step, not a code change.

---

## Encryption Export Compliance

**Determination: should be `true`** in `app.json`. The `false` value claims the standard OS-crypto/HTTPS-only exemption, which doesn't match what the app does.

**🟡 Temporarily reverted to `false` on 2026-07-12** — TestFlight/device testing was hitting the build 71 export-compliance wall (see the 🔴 BLOCKED section below) while the real classification is still with counsel, and the developer can't use the iOS Simulator (8GB machine) to test any other way. `false` matches what build 70 shipped with. **Flip this back to `true` before any real App Store submission** — do not let a submission go out with `false` once counsel resolves the classification.

### The facts (from the code)
GHOSTFACE implements its own protocol — a Signal-style Double Ratchet plus a post-quantum hybrid (`lib/crypto.ts`, `lib/doubleRatchet.ts`) — rather than relying only on OS/TLS encryption. But every primitive it uses is a **published, standardized algorithm**, not a proprietary/invented one:

| Purpose | Algorithm | Status |
|---|---|---|
| Key exchange | X25519 | Standard (RFC 7748) |
| Identity signing | Ed25519 | Standard (RFC 8032) |
| Symmetric AEAD | ChaCha20-Poly1305 | Standard (RFC 8439) |
| KDF | HKDF/HMAC-SHA256 | Standard |
| PIN key derivation | PBKDF2-SHA256 | Standard |
| Post-quantum KEM | ML-KEM-768 | NIST-standardized (FIPS 203) |

This distinction (custom implementation of standard algorithms, vs. non-standard/proprietary algorithms) is the crux of the determination — the former generally qualifies for the lightweight **mass-market self-classification** path under EAR (same route Signal/WhatsApp use); the latter would force a much heavier formal classification-request process.

### Two separate obligations — don't conflate them
1. **Apple's declaration** — the `ITSAppUsesNonExemptEncryption` flag + the App Store Connect export compliance questionnaire.
2. **The actual US export law obligation** — a filing with the US government (BIS + NSA), independent of Apple, required *before* the app is commercially available and renewed annually. Flipping the Apple flag does **not** satisfy this — it's a separate step.

### App Store Connect questionnaire — expected answers
- Uses encryption? **Yes**
- Qualifies for Category 5 Part 2 exemptions (OS-only/auth-only/etc.)? **No**
- Uses proprietary/non-standard algorithms? **No** (all algorithms above are standard/published — this is what should keep it on the lighter self-classification path instead of a full CCATS)

### 🔴 BLOCKED — 2026-07-11

`eas submit --platform ios` for build 71 (buildNumber 71, iOS artifact `kJWK93txxHEQ5PwzxuRAUK1EtUyRIpa2bKu2C5PpGsY.ipa`) fails: App Store Connect reports export compliance is missing on the build and is asking for a **commodity classification**.

**This is a discrepancy worth resolving, not routing around.** The determination above says this app should qualify for the *lightweight* mass-market self-classification path (no CCATS) because every algorithm is standard/published. "Commodity classification" is CCATS-flavored language — the *heavier* path. Two possibilities:
- The App Store Connect questionnaire got answered onto the wrong branch (most likely candidate: the proprietary/non-standard-algorithm question), which is fixable by re-answering it correctly per the table above.
- Or the determination itself needs revisiting — worth a second look with counsel rather than assumed correct.

**Do not click through App Store Connect's questionnaire to force a submission through.** Whatever gets selected there is a legal attestation to Apple, and it must be backed by an actual completed BIS/NSA filing — not chosen because it's the combination of answers that unblocks the build.

**Next actions, in order:**
1. Check exactly what App Store Connect's export compliance screen asked for build 71, and how the proprietary/non-standard-algorithm question specifically was answered.
2. Take that, plus the algorithm table above, to export-control counsel — resolve the CCATS-vs-self-classification discrepancy and get the actual classification determined.
3. File the self-classification report (or CCATS, if that turns out to be what's actually required) with BIS/NSA. Mass-market items are typically ECCN 5D992.c, but confirm current process/addresses against BIS's live guidance — don't rely on this doc for that.
4. Only then re-answer the App Store Connect questionnaire to match the real, filed classification, and retry `eas submit`.

Sanctioned-destination restrictions (Iran, Cuba, North Korea, Syria, Crimea) aren't covered by the mass-market exception, but Apple's own App Store territory settings already exclude those — no action needed there.

**This is not legal advice.**

**This is not legal advice.**

---

## Age Rating (iOS)

Based on a code review of the app (no violence/sexual/gambling content, no in-app browser, contact-adding is invite/QR-code only with no public discovery) — resolved to **4+**, same tier as Signal, WhatsApp, and Telegram.

### Content descriptor grid
| Descriptor | Answer |
|---|---|
| Cartoon or Fantasy Violence | None |
| Realistic Violence | None |
| Sexual Content or Nudity | None |
| Profanity or Crude Humor | None (E2EE user messages aren't reviewable/ratable by Apple — same precedent as Signal/WhatsApp/Telegram) |
| Alcohol, Tobacco, or Drug Use/References | None |
| Mature or Suggestive Themes | None (the surveillance-evasion framing — Ghost Numbers, Panic Wipe, Decoy Mode — doesn't depict content, just function) |
| Horror or Fear Themes | None |
| Medical or Treatment Information | None |
| Gambling (simulated) | None |
| Contests | None |
| Unrestricted Web Access | No — confirmed no in-app browser/WebView; all links (including the MoonPay on-ramp in `app/(tabs)/wallet.tsx`) hand off to the external Safari via `Linking.openURL`, not an embedded browser |

### Related flags (not part of the rating grid, but adjacent — don't let these slip through review)
- **Guideline 1.2 (User Generated Content)** — contact-adding is invite/QR-only (`components/GhostInvite.tsx`), no public discovery or alias search, so this stays in the closed-messenger category rather than the open-community category that triggers Apple's stricter filter/report/block/support-contact requirements. Note: the app currently only has "Delete Contact" (`app/(tabs)/messages.tsx`), not an explicit block — deleting a thread doesn't necessarily stop the other party from re-adding you. Not required for the 4+ rating, but worth adding defensively since reviewers sometimes ask for it even on closed models.
- **Guideline 3.1.5 / Finance category** — the MoonPay fiat on-ramp (buy SOL/USDC with a card) is live, not a placeholder. App Store Connect should likely list **Finance** as a category (primary or secondary) alongside Utilities, and App Review notes should be ready to explain that MoonPay — not GHOSTFACE — handles the KYC/money-transmission side of that transaction.

---

## App Store Connect Setup (iOS)

Before submitting, complete the following in App Store Connect:

1. **Create your app** at [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
   - Bundle ID: `com.ghostface.app`
   - SKU: `ghostface-app-001` (any unique string)

2. **App Information**
   - Name: GHOSTFACE
   - Subtitle: Private & Anonymous Messaging
   - Category: Utilities (Primary), Social Networking or Finance (Secondary) — see the Guideline 3.1.5 flag under "Age Rating (iOS)" re: the live MoonPay on-ramp
   - Privacy Policy URL: `https://ghostface.app/privacy`

3. **App Privacy** (required)
   - Complete the Data & Privacy questionnaire
   - GHOSTFACE collects: no data linked to identity
   - Note encryption and local-only storage where applicable

4. **Version Information**
   - Description, Keywords, What's New: see "Store Listing Copy (Draft v1.0)" above
   - Support URL: `mailto:support@ghostface.app` (see "Support URL" above — requires DNS email routing to be set up before submission)
   - Marketing URL: `https://ghostface.app`

5. **Age Rating**: See "Age Rating (iOS)" above — resolves to 4+. Confirm the grid still matches actual app behavior at submission time before entering it in App Store Connect (these are legal declarations).

6. **Export Compliance**: See "Encryption Export Compliance" above — `ITSAppUsesNonExemptEncryption` is now `true`. Answer the App Store Connect questionnaire per that section, and confirm the BIS/NSA self-classification filing is done (separate from Apple, still outstanding) before submitting.

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
