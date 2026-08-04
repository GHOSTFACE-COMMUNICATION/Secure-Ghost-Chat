# GHOSTFACE — clean build-ready drop

This is the **real encryption build** (Double Ratchet, X3DH, crypto stack present in
`artifacts/ghostface/lib/`), stripped down to source so you can run it natively on the iMac.

## What was removed (none of it is needed to build)
- `.local/` — 1GB of Replit runtime cache
- `.git/` — the old history had ~40 tangled remotes pointing at 3 different GitHub repos.
  Removed deliberately so you can start clean. (Your history still lives on Replit + GitHub.)
- `ghostface-project.zip` — a 16MB nested zip
- empty junk files (`expo`, `acesss tokin`), duplicate `.replit (copy)` / `.replitignore (copy)`
- all `node_modules` (you'll reinstall fresh)

## What was fixed
1. `artifacts/ghostface/metro.config.js` — added `watchFolders` + `nodeModulesPaths` so Metro
   can resolve the `@workspace/*` packages across the monorepo (kept your @solana blockList).
2. `pnpm-workspace.yaml` — the `@xmldom/xmldom` override only caught versions *below* 0.8.13,
   so 0.9.x slipped through. Changed to an unconditional pin: `'@xmldom/xmldom': '~0.8.13'`.

## Run it natively (iMac)
```bash
# from the unzipped folder root:
pnpm install

cd artifacts/ghostface
pnpm exec expo start --dev-client --clear
# then press  i  to open the iOS simulator
```
The `--clear` flag matters the first time — it forces Metro to rebuild with the new config.

## When you're ready for version control / EAS
Start fresh and point at ONE canonical repo (recommend retiring the others):
```bash
git init
git add -A
git commit -m "clean baseline: real encryption build"
git remote add origin https://github.com/ghostzeronz-coder/<the-one-repo-you-keep>.git
git push -u origin main
```

## The 3 repos that caused the chaos (pick one, retire two)
- `ghostzeronz-coder/Secure-Ghost-Chat-`     ← what the iMac was building from
- `ghostzeronz-coder/Secure-Ghost-Chat1111`  ← what Replit pushes to (real work)
- `pc7zfphhs2-del/Securegf`                   ← a second account, probably orphaned
