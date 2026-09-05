# GHOSTFACE api-server — working agreement

Scoped to this directory — see the repo-root `CLAUDE.md` for repo-wide rules
(STATUS.md/TRACKER.md, repo layout, report-before-writing-code, dependency
approval).

## ⚠️ Pushing this branch deploys to production

Railway watches `ghostzeronz-coder/Secure-Ghost-Chat` on branch
**`feat/push-notifications`** and deploys `api-server` on every push. There is
no staging environment. A docs-only commit is skipped by `watchPatterns` in
`railway.json`; anything touching `artifacts/api-server/**`, `lib/db/**`,
`lib/api-zod/**` or the lockfile ships.

A deploy restarts the process, which **drops every live WebSocket**.

## Which box is which

Getting this wrong has already cost a session's worth of debugging.

| Host | What it is |
|---|---|
| `88.99.225.231` | **VPN box** — WireGuard `wg0` + the peer agent on 8443. `VPN_AGENT_URL` / `VPN_SERVER_ENDPOINT` point here. |
| `204.168.139.146` | **coturn only** (`turnbox` in `~/.ssh/config`, user `coturnops`). No `wg0`, no agent. Serves TURN for calls. |

`STATUS.md` sometimes calls the VPN box `ghostface-vpn-eu1`; its hostname is
`ubuntu-4gb-hel1-*`. Confirm by IP, not by name. Agent source and deploy steps
live in `infra/vpn-agent/`.

## Railway topology — do not delete services

`api-server` → `pgbouncer.railway.internal` → `postgres-ha` → Patroni leader.
**PgBouncer and Postgres HA are both in the only path from the API to the
database.** Deleting either is an instant, total outage. PgBouncer logging
`0 queries/s` when idle is normal, not evidence it is unused.

`DATABASE_URL` points at PgBouncer (`transaction` pool mode), so the `max` in
`lib/db/src/index.ts` is a client-side cap inside the pooler's budget, not a
direct claim on backend connections. If the pooler is ever bypassed,
`max × replica count` must stay under Postgres `max_connections`.

## Railway access (Claude Code has it)

Two routes, different visibility: **MCP tools** (`mcp__railway__*` — projects,
services, variables, deployments, config, logs, redeploy, set-variables) show
variable **names only**, values redacted; the authenticated **`railway` CLI**
(workspace `GHOSTFACELIMITED`) can show values with `-k`/`--json`, though the
auto-mode classifier may refuse a command that prints secrets.

This project is **`secure-ghost-chat-api`**, `a5d14056-5ff3-4e49-88b1-dab864b1feec`,
environment production `b384f51f-4397-4fa5-9c59-69bbc099ec47`. Services:
`api-server`, `PgBouncer`, `Postgres`, `Redis`, `etcd-4`, `etcd-5`.

⛔ **Pin `-p` on every Railway command.** DIOR is a *separate* Railway project
(`dior-api`, `06f24135-947d-4b9d-9dd3-4cec1c9cc635`) and **also has a service
called `api-server`** — and `~/Projects/dior-mobile` is itself linked to *this*
project, so an unpinned command run from either repo can read the wrong app with
nothing to signal it. Same class of error as the shared Apple team.

🪤 **`DATABASE_URL` here points at PgBouncer's internal hostname**, which is not
resolvable from a laptop. For a read-only query against production use
`railway run --service Postgres -- …` and `DATABASE_PUBLIC_URL`, which is on the
**Postgres** service, not `api-server`, and bypasses PgBouncer to reach the
Patroni leader.

🪤 **Parse `--json | jq`, never the table** — a value containing newlines splits
across lines and a line-based parse reports phantom variables and wrong lengths.

## Redis is load-bearing

`REDIS_URL` backs both the rate limiters and all cross-replica WebSocket state
(`ws/sharedState.ts`, `ws/router.ts`). `REDIS_URL` unset is a supported mode —
dev and tests fall back to per-process state — but **that fallback is only
correct at one replica**. A mid-flight outage degrades limits to per-replica
rather than failing open, which matters because `provisionLimiter` spends real
money.

## Do not put new state in module scope in `ws/manager.ts`

That is what pinned this service to `numReplicas: 1` and took three commits to
undo. Anything that must be visible to another replica belongs in
`ws/sharedState.ts`; anything that must reach a socket on another replica goes
through `ws/router.sendToAlias`. A socket handle itself stays local.

Corollary: do not branch on `ws.readyState` to decide whether a peer received
something. It reads OPEN for tens of seconds after a backgrounded socket dies,
and it cannot see a socket held by another replica. Branch on what
`sendToAlias` actually returned.

## Static outbound IPs are region-bound

The VPN agent's 8443 is firewalled to this service's three Railway static
egress IPs. **Railway reassigns them if the service changes region**, and this
service moved `sfo` → `us-west2` on 24 Aug. A future region change breaks peer
registration silently, and it will look exactly like the P0 in STATUS.md.
Re-run `infra/vpn-agent/firewall.sh` with fresh values from
`railway outbound-network static-ip status --service api-server`.

## Schema changes: push for additive, a migration file for destructive

**`drizzle-kit push` for additive schema changes; a reviewable migration file
with pre-flight checks for anything destructive (drops columns/tables).**

For additive work the live schema is exactly what the TS in `lib/db/src/schema/`
declares and there is nothing to review beyond the TS. But
`pnpm --filter @workspace/db push` diffs the **entire** schema against
production, so its blast radius is every table — and a push that *infers* a
destructive step is not something anyone can approve by reading a diff of
TypeScript.

So anything that drops a column or a table gets a numbered SQL file under
`lib/db/migrations/`, which must:

- state the exact statements, so they can be read before they run;
- open with **pre-flight `SELECT`s** that count whatever the migration destroys
  or orphans, with an explicit STOP condition when a count is non-zero;
- say plainly whether it has been applied.

`lib/db/migrations/0001_gf20_number_leases.sql` (GF-20) is the worked example.

For a single index, prefer applying it by hand against the Patroni leader
(`DATABASE_PUBLIC_URL`, which bypasses PgBouncer) with
`CREATE INDEX CONCURRENTLY`, then let the TS declaration document what exists.

🪤 **`lib/db/dist` is stale build output and api-server typechecks against it**,
not against `lib/db/src` — the two are wired by TypeScript **project
references** (`tsconfig.json` → `references`). A new export in the schema is
invisible to `pnpm run typecheck` until you run `pnpm exec tsc -b ../../lib/db`.
It cost a confusing "has no exported member" round on 5 Sep.

## `delivered` does not mean delivered

`messagesTable.delivered` means *the server attempted delivery*. The client
never sends the ack the server handles (`ws/manager.ts` has a `type: "ack"`
branch nothing reaches), and three code paths set the flag without any proof of
receipt. Do not build anything that treats it as a receipt until the client ack
lands — see TRACKER.

Related: `"ack"` means two different things in the wire protocol — auth
confirmation server→client, and message receipt client→server.

## Rate limits are per-alias, not per-IP

The IP bucket counts **only failed authentication**. That is deliberate: mobile
carrier NAT and our own VPN egress put thousands of real users behind one
address, so any per-IP ceiling low enough to constrain an attacker also breaks
them. Real quotas are charged to the authenticated alias. Do not "simplify" this
back to per-IP.

Four endpoints have no alias to key on (`invites`, `blobs`, `iceConfig`,
`integrity`) and are capped by a `GlobalLimiter` on the resource instead.

`POST /blobs`, `GET /ice-config` and `POST /invites` now authenticate via
`lib/auth.ts` (`checkAuth`), **but only when `ENFORCE_ENDPOINT_AUTH` is set
to `1`/`true`**. It defaults to OFF and ships that way deliberately: no app
build before 27 Aug 2026 sends the header, so enforcing early breaks every
existing install. `/ice-config` is the one to watch — the client fails open
to STUN-only, so a 401 there silently degrades calls instead of erroring.
While the flag is off, every unauthenticated call is logged
("ENFORCE_ENDPOINT_AUTH is off") — when those stop appearing, it is safe to
flip. **Filter those logs by the message text, not by severity.** They are
emitted at pino `warn`, but Railway renders `warn` as `info` (verified live;
the pre-existing `logger.warn` in `iceConfig.ts` shows the same way), so a
severity filter returns nothing — which would read as "all clients have
updated" when they have not. Each line carries `endpoint` and `ip`.

Flipping is a Railway variable change, not a deploy, so it is instantly
reversible. `integrity` remains unauthenticated by design.

## Before reporting work done

`pnpm run typecheck && pnpm run lint && pnpm test` from this directory.

`pnpm run lint` currently fails on a pre-existing warning in
`lib/inviteRepository.ts` (`--max-warnings=0`). Not yours; lint your own files
with `npx eslint <paths>` to check cleanly.
