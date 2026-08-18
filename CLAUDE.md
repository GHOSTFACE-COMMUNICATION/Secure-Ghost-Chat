# GHOSTFACE — working agreement

## Repo layout

- **Canonical repo**: `~/Projects/ghostface-clean` (this directory). It is the
  one source of truth — the several similarly-named GitHub repos under
  `ghostzeronz-coder` are empty or abandoned.
- **The real Expo app lives in `artifacts/ghostface/`**, not the repo root.
  Run `expo`/`pnpm` app commands from there. The root is a pnpm workspace;
  `pnpm-workspace.yaml` lists packages **explicitly**, not by glob — add new
  ones by hand.
- `artifacts/api-server/` is the backend (Express + TypeScript, deployed to
  Railway).
- **vault2fa is not part of this repo.** It is a separate project at
  `~/Projects/vault2fa` with its own git remote. It formerly sat at
  `artifacts/vault2fa/` and was wrongly absorbed by the old `artifacts/*`
  glob. Do not move it back.
- `mockup-sandbox/`, `ghostface-1/` and `SETUP-READ-ME-FIRST.md` were archived
  to `~/Projects/_archive/ghostface-clean-2026-08-18/` on 18 Aug 2026.
- Replit pushes to branches `replit-main` / `replit-workspace` on the same
  `origin` remote. `replit-main` has **no common git ancestor** with our
  working branches — treat any merge between them as a manual port, never a
  `git merge`.

## Rules

### Never run EAS builds without an explicit go-ahead
Builds cost real money (the account is already well past its included credits,
into pay-as-you-go). Never run `eas build` — or anything that triggers one —
unless the user has just said to. Same for `eas submit`: that pushes a binary
to real users' TestFlight.

### Always report findings before writing code
Investigate, then say what was found and what the plan is, and wait. Do not
jump from "here's the bug" straight to editing files.

### Always answer "no" to the Apple login prompt in EAS
When an EAS command asks to log in to an Apple account, decline. The stored
credentials on EAS servers (App Store Connect API key + provisioning profiles)
are what should be used.

### Verify `EXPO_PUBLIC_DOMAIN` before any build
It must be a **bare host with no scheme and no trailing slash** — e.g.
`api.ghostface.co.nz`, never `https://api.ghostface.co.nz`. `lib/apiBase.ts`
builds the URL as `https://${domain}/api`, so a scheme here produces a
malformed URL and every API call silently 404s.

Known-good values:
- Local dev (`.env`): `api.ghostface.co.nz`
- EAS preview/production (`eas.json` `env`): `api-server-production-b252.up.railway.app`

Note `ghostface.co.nz` (no `api.` prefix) is a **different host** — a Vercel
site, not the API. Pointing at it is the cause of `[REGISTER] ... 404`.

### Never install dependencies without explicit approval
No `pnpm add` / `npm install` / removing packages unless asked. Dependency
changes here have repeatedly had non-obvious native consequences.

### Typecheck after every change
From `artifacts/ghostface/`: `npx tsc -p tsconfig.json --noEmit`
(or `pnpm typecheck`). Do this before reporting work as done.

## iOS identifiers

| | |
|---|---|
| Bundle ID | `com.ghostface.app` (do not change) |
| ASC App ID | `6781518828` |
| Apple Team | `98337579X8` (BENJAMIN HENDERSON, Individual) |
| EAS project | `@ghost_face/mayybachh` |

## Useful context

- The home-screen coin is a **plain `Animated` physics implementation** inline
  in `app/(tabs)/index.tsx` — velocity model, tap impulse, hold-to-brake, fake
  3D flip. It is deliberately **not** WebGL: `three`, `@react-three/fiber` and
  `expo-gl` were removed because expo-gl doesn't implement
  `renderbufferStorageMultisample` (transmission materials hang the render
  loop) and `THREE.TextureLoader` calls `document.createElementNS`, which
  doesn't exist under Hermes. Don't reintroduce them.
- Interaction: **tap** the coin toggles the radial menu; **hold** brakes the
  spin and is suppressed from also toggling the menu.
- The app auto-locks on real backgrounding after the configured timeout
  (`app/_layout.tsx`). Automated simulator testing that backgrounds the app
  will trip this and the focus-gated animation loops — it looks like a bug but
  isn't.
- CallKit (`react-native-callkeep` + `plugins/withVoipPushKit.js`) can't be
  properly tested in the Simulator; VoIP push needs a physical device.
