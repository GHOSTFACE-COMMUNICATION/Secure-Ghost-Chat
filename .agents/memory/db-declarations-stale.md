---
name: Stale db package declarations
description: api-server typecheck can fail on schema columns that exist — rebuild lib/db dist first.
---
The `@workspace/db` package ships hand-built `.d.ts` files in `lib/db/dist` (no build script). After schema changes land (e.g. via a rebase), api-server typecheck may report "property does not exist" for columns that ARE in the source schema.

**Why:** api-server's tsconfig resolves types from the stale compiled declarations, not `lib/db/src`.

**How to apply:** run `pnpm exec tsc -b lib/db --force` from the repo root, then re-run the typecheck, before assuming the schema is actually missing a column.
