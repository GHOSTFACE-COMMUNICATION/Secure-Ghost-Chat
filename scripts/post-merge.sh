#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Rebuild shared libs so stale dist d.ts files don't break typecheck
pnpm exec tsc -b lib/db
# --force: stdin is closed during post-merge, so interactive drizzle prompts
# (e.g. adding a unique constraint to a populated table) would hang otherwise
pnpm --filter db push-force
