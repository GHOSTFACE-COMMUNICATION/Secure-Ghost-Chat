-- GF-20 — GhostNumber pivot: per-user assignment -> masked pool leases (SMS half)
--
-- WHY THIS IS A FILE AND NOT A `db push`
-- The repo's normal mechanism is `pnpm --filter db push`, which infers changes
-- from the Drizzle schema. This change DROPS columns and a whole table, and a
-- push that infers a destructive step is not something anyone should approve by
-- reading a diff of TypeScript. It is written out so the exact statements can be
-- reviewed, and so the pre-flight below can be run first.
--
-- NOT APPLIED. Do not run against production until the pre-flight returns zero
-- rows, or until the fallout is accepted in writing.
--
-- Voice is deliberately untouched: `capabilities` may still contain "VOICE",
-- but no voice routing exists and none is added here (GF-20 is SMS-only until
-- the vendor answer and a separate design pass).

BEGIN;

-- ---------------------------------------------------------------------------
-- PRE-FLIGHT — run these THREE first, on production, and read the answers.
-- ---------------------------------------------------------------------------
-- Every one of these is data that this migration destroys or orphans.
--
--   -- 1. Live per-user numbers. Each is a real rented MSISDN with a real user
--   --    expecting it to keep working. This migration severs that ownership.
--   SELECT count(*) AS live_assigned FROM ghost_numbers WHERE status = 'active';
--
--   -- 2. Numbers with rotation scheduled. Their schedule silently stops.
--   SELECT count(*) AS with_rotation FROM ghost_numbers WHERE next_rotation_at IS NOT NULL;
--
--   -- 3. Stored SMS whose owning number is about to lose its user_id. These
--   --    rows keep to_user_id, so history survives, but the number they point
--   --    at stops being that user's.
--   SELECT count(*) AS stored_sms FROM ghost_sms;
--
-- If (1) is non-zero, STOP and read the provider column before going further.
-- Those users hold numbers under the old model and there is no backfill here
-- that could invent leases for them: a lease needs a counterparty
-- (external_number), and an assigned number has none. Migrating them is a
-- product decision, not a schema one.
--
--   -- 1b. The distinction that decides how serious (1) is:
--   SELECT provider, count(*)::int FROM ghost_numbers
--    WHERE status = 'active' GROUP BY provider;
--
-- provider = 'demo' rows were generated locally by the no-Vonage-configured
-- branch of the old /numbers/provision. They are not rented, cost nothing, and
-- have no carrier relationship to sever — the only loss is what those users see
-- in the app. provider = 'vonage' rows are real subscribed numbers and must not
-- be quarantined without a decision about the humans holding them.
--
-- ---------------------------------------------------------------------------
-- OBSERVED ON PRODUCTION, 5 Sep 2026 (read-only, nothing applied):
--   live_assigned       = 3      <-- STOP condition technically met
--   with_rotation       = 0
--   stored_sms          = 0
--   total_numbers       = 3
--   rotation_limit_rows = 0
--   status breakdown    = [{"status":"active","n":3}]
--   provider breakdown  = all 3 are 'demo', NZ, plan 'basic', SMS-only,
--                         3 distinct owners, created 28 Aug / 29 Aug / 3 Sep.
--
-- Reading: no real Vonage inventory exists in production, so this migration
-- severs no carrier relationship and orphans no message history (stored_sms is
-- 0). What it does do is take a number out of three real users' apps. That is
-- a product call, not a schema one, and it is why this file is still NOT
-- APPLIED.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Lease table — the model
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS number_leases (
  id               serial PRIMARY KEY,
  pool_number_id   integer     NOT NULL,
  external_number  text        NOT NULL,
  owner_alias      text        NOT NULL,
  created_at       timestamp   NOT NULL DEFAULT now(),
  expires_at       timestamp,
  released_at      timestamp
);

-- THE defining constraint: at most one LIVE lease per (pool number, counterparty).
-- Partial, so released leases accumulate as history and the same pair can be
-- leased again later without tripping the unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_number_leases_active_pair
  ON number_leases (pool_number_id, external_number)
  WHERE released_at IS NULL;

-- Inbound routing: (to, from) -> lease.
CREATE INDEX IF NOT EXISTS idx_number_leases_routing
  ON number_leases (pool_number_id, external_number)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_number_leases_owner
  ON number_leases (owner_alias)
  WHERE released_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Dead-end reply ledger — exactly-once, enforced by the PK
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dead_end_replies (
  pool_msisdn      text      NOT NULL,
  external_number  text      NOT NULL,
  replied_at       timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (pool_msisdn, external_number)
);

-- ---------------------------------------------------------------------------
-- 3. ghost_sms — lease provenance
-- ---------------------------------------------------------------------------
ALTER TABLE ghost_sms ADD COLUMN IF NOT EXISTS lease_id integer;

-- ---------------------------------------------------------------------------
-- 4. ghost_numbers -> pool inventory
-- ---------------------------------------------------------------------------
-- Existing rows are per-user and carry no counterparty, so they cannot become
-- leases. They are quarantined rather than dropped or silently freed: a
-- quarantined number is not handed to anyone, and the MSISDN is still ours, so
-- nothing is released at the carrier by accident and nothing is re-leased to a
-- stranger while the old owner still has it written down.
UPDATE ghost_numbers SET status = 'quarantined' WHERE status = 'active';

DROP INDEX IF EXISTS idx_ghost_numbers_next_rotation;

ALTER TABLE ghost_numbers DROP COLUMN IF EXISTS user_id;
ALTER TABLE ghost_numbers DROP COLUMN IF EXISTS plan;
ALTER TABLE ghost_numbers DROP COLUMN IF EXISTS rotate_every_days;
ALTER TABLE ghost_numbers DROP COLUMN IF EXISTS next_rotation_at;
ALTER TABLE ghost_numbers DROP COLUMN IF EXISTS archived_msisdns;

ALTER TABLE ghost_numbers ALTER COLUMN status SET DEFAULT 'available';

CREATE INDEX IF NOT EXISTS idx_ghost_numbers_status_country
  ON ghost_numbers (status, country);

-- One pool row per MSISDN. Will fail loudly if duplicates exist, which is the
-- correct outcome — duplicate inventory means double billing at the carrier.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ghost_numbers_msisdn
  ON ghost_numbers (msisdn);

-- ---------------------------------------------------------------------------
-- 5. Rotation retires
-- ---------------------------------------------------------------------------
-- Rotation existed to give a user a fresh number periodically. Under leases the
-- user never holds a number, so there is nothing to rotate. lib/rotationScheduler.ts
-- and both its test files are deleted in the same commit.
DROP TABLE IF EXISTS user_rotation_limits;

COMMIT;
