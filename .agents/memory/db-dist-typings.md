---
name: Stale db dist typings
description: api-server typecheck fails with "property does not exist" on schema columns when lib/db composite declarations are stale
---

The db workspace package is a TS composite project (`emitDeclarationOnly` → `dist/`), and api-server references it via project references. After any schema change, the checked-in/generated `dist/*.d.ts` can lag behind `src/`, making api-server typecheck fail with `TS2339 Property '<column>' does not exist` even though the column exists in source.

**Why:** tsc resolves the reference through the emitted declarations, not the source.

**How to apply:** run `pnpm exec tsc -b lib/db` to regenerate declarations, then re-run the api-server typecheck.
