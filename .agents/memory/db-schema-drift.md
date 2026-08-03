---
name: db package stale declarations + dev-DB schema drift
description: Two recurring failure modes after editing lib/db schema files
---
- After editing `lib/db/src/schema/*`, run `npx tsc -b lib/db` — downstream typechecks (api-server) resolve the composite project's stale `dist/*.d.ts` and report "property does not exist" on brand-new columns.
- The dev Postgres DB is NOT auto-migrated: new schema columns (e.g. `owner_notified_at`) can be missing until `drizzle-kit push` runs. E2E tests self-provision with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (see rotation + invite-expiry e2e tests) to stay independent of push state.

**Why:** hit both in one session — typecheck failed and an e2e insert failed on a column that existed in the schema source but nowhere else.
**How to apply:** any schema change → rebuild db types, and either push the schema or make tests self-provisioning.
