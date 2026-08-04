---
name: Running pnpm in the task shell
description: How to run pnpm/drizzle/vitest when the shell has no node/pnpm on PATH
---

Task/agent shells here may lack node and pnpm even though workflows use pnpm.

**How to apply:**
- Find a Node 22+ runtime in the nix store (`ls -d /nix/store/*nodejs-22*/bin`) and prepend it to PATH; pnpm 11 requires Node >= 22.13.
- If pnpm 11 fails with "Unexpected store location" (node_modules linked from store v10), install with `npx -y pnpm@10` and set `npm_config_manage_package_manager_versions=false` (otherwise it self-upgrades to the packageManager pin and hits the same store mismatch). Set `XDG_DATA_HOME` under the workspace so the store path matches `node_modules/.modules.yaml`.
- `drizzle-kit push` prompts interactively for new tables even with `--force`; when there is no TTY, create the table with `executeSql` instead (push then sees no diff).
- Run vitest/tsc via `node_modules/.bin` on PATH (`.bin/*` are shell scripts — execute them, don't `node` them).
- Background processes die between shell invocations — start a server and curl it in the SAME command.

**Why:** each of these failure modes wastes several blind retries; the fixes are non-obvious and stable across sessions.
