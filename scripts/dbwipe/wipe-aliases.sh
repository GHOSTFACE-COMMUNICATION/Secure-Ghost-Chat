#!/usr/bin/env bash
# Full alias wipe — backup, dry-run, then commit. Nothing is deleted without
# a ROLLBACK dry run whose counts you have read first.
#
#   ./wipe-aliases.sh dry            # counts only, ROLLBACK, no writes
#   ./wipe-aliases.sh commit         # takes a backup, then deletes for real
#
# Scope: set ALIASES to the aliases to remove, or leave it empty for ALL.
set -euo pipefail

: "${DATABASE_PUBLIC_URL:?set DATABASE_PUBLIC_URL to the tokaido.proxy.rlwy.net:29263 URL}"
MODE="${1:-dry}"
ALIASES="${ALIASES:-}"        # e.g. ALIASES="MAYYBACHHFKU,GF_TEST,STATIC_Q"
# Deleting a ghost_numbers row does NOT release the number at Vonage — it only
# loses our record of a number we are still billed for. Kept by default.
KEEP_GHOST_NUMBERS="${KEEP_GHOST_NUMBERS:-1}"

if [ -z "$ALIASES" ]; then
  SCOPE="TRUE"                        # every identity
  echo "SCOPE: *** ALL IDENTITIES ***"
else
  LIST=$(printf "%s" "$ALIASES" | tr ',' '\n' | sed "s/^/'/;s/$/'/" | paste -sd, -)
  SCOPE="user_id IN ($LIST)"
  echo "SCOPE: $ALIASES"
fi

if [ "$KEEP_GHOST_NUMBERS" = "1" ]; then
  GN_DELETE="\\echo 'ghost_numbers: KEPT (release at Vonage before deleting)'"
  echo "ghost_numbers: KEPT"
else
  GN_DELETE="DELETE FROM ghost_numbers WHERE user_id IN (SELECT user_id FROM _victims);"
  echo "ghost_numbers: WILL BE DELETED"
fi

if [ "$MODE" = "commit" ]; then
  STAMP=$(date +%Y%m%d-%H%M)
  echo "==> backup to ~/ghostface-full-$STAMP.sql"
  pg_dump "$DATABASE_PUBLIC_URL" > "$HOME/ghostface-full-$STAMP.sql"
  ls -lh "$HOME/ghostface-full-$STAMP.sql"
  END="COMMIT"
else
  END="ROLLBACK"
fi

psql "$DATABASE_PUBLIC_URL" -v ON_ERROR_STOP=1 <<EOF
BEGIN;

-- Resolve delivery ids BEFORE identity_keys is touched: messages are keyed on
-- delivery_id, and deleting the identity row first orphans them permanently.
CREATE TEMP TABLE _victims ON COMMIT DROP AS
  SELECT user_id, delivery_id FROM identity_keys WHERE $SCOPE;

\\echo '--- identities in scope ---'
SELECT user_id, delivery_id FROM _victims ORDER BY user_id;

\\echo '--- row counts to be deleted ---'
SELECT 'messages'             AS t, count(*) FROM messages             WHERE to_delivery_id IN (SELECT delivery_id FROM _victims WHERE delivery_id IS NOT NULL)
UNION ALL SELECT 'departures',       count(*) FROM departures          WHERE from_alias IN (SELECT user_id FROM _victims) OR to_alias IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'invites',          count(*) FROM invites             WHERE owner_alias IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'prekeys',          count(*) FROM prekeys             WHERE user_id IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'device_tokens',    count(*) FROM device_tokens       WHERE user_id IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'reclaim_challenges',count(*) FROM reclaim_challenges WHERE user_id IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'welcome_gifts',    count(*) FROM welcome_gifts       WHERE user_id IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'ghost_entitlements',count(*) FROM ghost_entitlements WHERE user_id IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'ghost_payments',   count(*) FROM ghost_payments      WHERE user_id IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'vpn_peers',        count(*) FROM vpn_peers           WHERE user_id IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'ghost_numbers',    count(*) FROM ghost_numbers       WHERE user_id IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'ghost_sms',        count(*) FROM ghost_sms           WHERE to_user_id IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'user_rotation_limits',count(*) FROM user_rotation_limits WHERE user_id IN (SELECT user_id FROM _victims)
UNION ALL SELECT 'identity_keys',    count(*) FROM identity_keys       WHERE user_id IN (SELECT user_id FROM _victims);

DELETE FROM messages             WHERE to_delivery_id IN (SELECT delivery_id FROM _victims WHERE delivery_id IS NOT NULL);
DELETE FROM departures           WHERE from_alias IN (SELECT user_id FROM _victims) OR to_alias IN (SELECT user_id FROM _victims);
DELETE FROM invites              WHERE owner_alias IN (SELECT user_id FROM _victims);
DELETE FROM prekeys              WHERE user_id IN (SELECT user_id FROM _victims);
DELETE FROM device_tokens        WHERE user_id IN (SELECT user_id FROM _victims);
DELETE FROM reclaim_challenges   WHERE user_id IN (SELECT user_id FROM _victims);
DELETE FROM welcome_gifts        WHERE user_id IN (SELECT user_id FROM _victims);
DELETE FROM ghost_entitlements   WHERE user_id IN (SELECT user_id FROM _victims);
DELETE FROM ghost_payments       WHERE user_id IN (SELECT user_id FROM _victims);
DELETE FROM vpn_peers            WHERE user_id IN (SELECT user_id FROM _victims);
$GN_DELETE
DELETE FROM ghost_sms            WHERE to_user_id IN (SELECT user_id FROM _victims);
DELETE FROM user_rotation_limits WHERE user_id IN (SELECT user_id FROM _victims);
DELETE FROM identity_keys        WHERE user_id IN (SELECT user_id FROM _victims);

\\echo '--- end state ---'
SELECT count(*) AS identities_remaining FROM identity_keys;
SELECT count(*) AS device_tokens_remaining FROM device_tokens;

$END;
EOF

echo "==> done ($END)"
