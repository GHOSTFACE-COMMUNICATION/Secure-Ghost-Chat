# GHOSTFACE — working agreement

## Start here, every session

**Read `STATUS.md` (repo root) first** — it is the living cross-session
state: active incidents, audit board, pre-ship gates, in-flight work.
**Update it before ending any session** in which state changed. A stale
STATUS.md is worse than none.

**`TRACKER.md` (repo root) is the task board** — GF-xx business tasks,
audit findings, release gates, open engineering items. When you finish,
start, or block a piece of work, update its row in the same commit as the
work itself. Don't wait to be asked.

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

### Always report findings before writing code
Investigate, then say what was found and what the plan is, and wait. Do not
jump from "here's the bug" straight to editing files.

### Never install dependencies without explicit approval
No `pnpm add` / `npm install` / removing packages unless asked. Dependency
changes here have repeatedly had non-obvious native consequences.

See `artifacts/ghostface/CLAUDE.md` for mobile-app-specific rules (EAS/Apple
login, `EXPO_PUBLIC_DOMAIN`, typecheck command, iOS identifiers, coin/CallKit
notes) — loads only when working in that directory.
