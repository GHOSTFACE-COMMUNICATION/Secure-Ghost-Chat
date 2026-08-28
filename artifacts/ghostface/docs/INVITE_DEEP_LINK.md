# Invite deep links — `https://ghostface.co.nz/i/<CODE>`

Spec, 27 Aug 2026. Not implemented.

Goal: turn "here is my invite code, type it in" into one tap, because every
retype loses people and invites are the *only* way a new user gets a first
conversation in an alias-only product with no contact discovery.

## What already exists

| Piece | State |
|---|---|
| `scheme: "ghostface"` in `app.json` | ✅ declared — `ghostface://…` already works when installed |
| Landing site `ghostface.co.nz` | ✅ live on Vercel, static HTML, `/privacy` and `/support` are directories with `index.html` |
| `lookupInviteCode` / `consumeInviteCode` (`lib/invites.ts`) | ✅ non-destructive lookup, then consume after `addConversation` |
| `CODE_REGEX` `^GF-[A-Z2-9]{4}-[A-Z2-9]{4}$` | ✅ shared client + server |
| `GET /invites/:code`, `POST /invites/:code/consume` | ✅ live |
| `ios.associatedDomains` | ❌ absent — no Universal Links |
| `android.intentFilters` | ❌ absent — no App Links |

So the app-side redemption logic is done. What is missing is the *transport*:
getting a code from one person's screen into another person's app.

## The honest constraint, stated up front

**A deep link cannot survive an App Store install.** iOS does not preserve the
originating URL through installation. Anyone who claims otherwise is
describing one of two things:

1. **Deferred deep-link SDKs** (Branch, AppsFlyer, Adjust). These work by
   fingerprinting the device — IP, screen size, OS version, timing — to match
   a pre-install click to a post-install launch. **Reject these outright.**
   They are precisely the tracking technology this product exists to oppose,
   they add a third-party SDK with network access to an E2EE app, and
   shipping one would be indefensible next to the privacy policy.

2. **Clipboard reading on first launch.** Technically works. But iOS 14+
   shows a visible paste banner, and an app that silently reads your
   clipboard on launch is a bad look for a privacy product — the optics are
   worse than the friction it saves.

**Therefore:** the already-installed path gets to be one tap. The
not-yet-installed path gets to be *one deliberate paste*, made as obvious as
possible. That is the honest ceiling, and it is still a large improvement on
retyping `GF-XXXX-XXXX` from a chat message.

## Design

### 1. Landing route — `/i/<CODE>`

A static page at `ghostface-landing/i/index.html`, reading the code from the
path (Vercel rewrite) or the query string.

It must be **dumb**. It does NOT call the API to resolve the owner alias.
`GET /invites/:code` is unauthenticated, and having a public web page resolve
codes to aliases turns the landing site into an enumeration oracle for
anyone who wants to probe the code space from a browser. The page shows the
code and nothing it did not already know.

Behaviour:

- Renders the code in large monospace with a **Copy** button.
- "Open in GHOSTFACE" button → `ghostface://invite/<CODE>`.
- If the app is installed, the Universal Link means the OS opens the app
  before this page is ever drawn — the page is the fallback, not the path.
- Below: App Store link, with a short line saying to paste the code after
  installing. The code stays visible so it can be copied again afterwards.

### 2. Universal Links (iOS)

`app.json`:

```json
"ios": {
  "associatedDomains": ["applinks:ghostface.co.nz"]
}
```

Served from the landing site at
`https://ghostface.co.nz/.well-known/apple-app-site-association`:

```json
{
  "applinks": {
    "details": [
      { "appID": "98337579X8.com.ghostface.app", "paths": ["/i/*"] }
    ]
  }
}
```

Requirements that bite in practice:

- Served over HTTPS with `Content-Type: application/json`, **no redirect**,
  no `.json` extension on the path.
- Scope is `/i/*` only. Do NOT claim `/*` — that would hijack `/privacy` and
  `/support`, which App Store review needs reachable in a browser.
- Apple caches the AASA via its CDN. Changes are not instant; test on a
  device with the app freshly installed.

### 3. App Links (Android)

`app.json` `android.intentFilters` with `autoVerify: true` for
`https://ghostface.co.nz/i/*`, plus
`https://ghostface.co.nz/.well-known/assetlinks.json` carrying the release
signing certificate's SHA-256 fingerprint. Note the current Android builds
use the default EAS keystore (`TVxbfrwdDe`), so the fingerprint must come
from that keystore — `eas credentials` can print it.

### 4. In-app handling

`expo-router` already maps paths to routes. Add `app/invite/[code].tsx`:

1. Validate against `CODE_REGEX` before anything else — a malformed code
   should never reach the network.
2. **If not registered** (no alias yet): stash the code, send the user
   through onboarding, then redeem immediately after registration completes.
   This is the common case for an invited user and the one most likely to be
   got wrong — an invite that dead-ends at the register screen is worse than
   no deep link.
3. **If registered:** `lookupInviteCode` → show who it is from → confirm →
   `addConversation` → `consumeInviteCode`. Consume only after the handshake
   succeeds, which is what `lib/invites.ts` already documents.
4. Handle `expired` / `used` / `not_found` with distinct copy. "Code already
   used" and "code not found" mean very different things to someone who was
   just sent one.

### 5. Onboarding affordance

Independently of deep links: onboarding needs a visible **"Have an invite
code?"** entry that offers to paste. This is what carries the
not-yet-installed case, and it is useful with or without any of the above.

## Sequencing

1. **`/i/` landing page + onboarding paste field.** No native changes, no
   rebuild, works immediately for the install-first case. Most of the value.
2. **Universal Links + AASA.** One `app.json` change and one static file, but
   requires a native rebuild and an AASA cache wait.
3. **Android App Links.** Same shape, needs the keystore fingerprint.

## Open questions

- **Invite codes survive an identity change on the same alias.** A code
  carries `ownerAlias`, not a key, so a code minted before an alias was
  released and re-registered still resolves — to a different identity with
  the same name. Noted while releasing GHOSTFACE on 27 Aug; 11 invites
  survived that deletion. Decide whether codes should be invalidated when an
  identity is replaced.
- **Referral attribution.** The referral perk added on `devtest` needs a
  grant to hang off something. `POST /invites/:code/consume` is the natural
  hook — it is the moment a referral demonstrably succeeded.
