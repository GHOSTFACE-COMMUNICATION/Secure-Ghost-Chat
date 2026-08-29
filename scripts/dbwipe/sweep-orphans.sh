#!/usr/bin/env bash
# Orphan sweep — removes alias-keyed rows whose owning identity no longer
# exists in identity_keys. The per-alias wipe cannot see these: it scopes from
# identity_keys, so a row whose identity was already deleted is invisible to it.
# ghost_numbers is never touched (deleting it does not release the number).
set -euo pipefail
: "${DATABASE_PUBLIC_URL:?set DATABASE_PUBLIC_URL}"
END=$([ "${1:-dry}" = "commit" ] && echo COMMIT || echo ROLLBACK)

psql "$DATABASE_PUBLIC_URL" -v ON_ERROR_STOP=1 <<EOF
BEGIN;
\\echo '--- orphaned rows (owning identity_keys row is gone) ---'
SELECT 'prekeys'   AS t, count(*) FROM prekeys    WHERE user_id     NOT IN (SELECT user_id FROM identity_keys)
UNION ALL SELECT 'invites',    count(*) FROM invites    WHERE owner_alias NOT IN (SELECT user_id FROM identity_keys)
UNION ALL SELECT 'departures', count(*) FROM departures WHERE from_alias  NOT IN (SELECT user_id FROM identity_keys)
                                                           OR to_alias    NOT IN (SELECT user_id FROM identity_keys)
UNION ALL SELECT 'messages',   count(*) FROM messages   WHERE to_delivery_id NOT IN (SELECT delivery_id FROM identity_keys WHERE delivery_id IS NOT NULL)
UNION ALL SELECT 'device_tokens',      count(*) FROM device_tokens      WHERE user_id NOT IN (SELECT user_id FROM identity_keys)
UNION ALL SELECT 'reclaim_challenges', count(*) FROM reclaim_challenges WHERE user_id NOT IN (SELECT user_id FROM identity_keys)
UNION ALL SELECT 'welcome_gifts',      count(*) FROM welcome_gifts      WHERE user_id NOT IN (SELECT user_id FROM identity_keys)
UNION ALL SELECT 'ghost_entitlements', count(*) FROM ghost_entitlements WHERE user_id NOT IN (SELECT user_id FROM identity_keys)
UNION ALL SELECT 'ghost_payments',     count(*) FROM ghost_payments     WHERE user_id NOT IN (SELECT user_id FROM identity_keys)
UNION ALL SELECT 'vpn_peers',          count(*) FROM vpn_peers          WHERE user_id NOT IN (SELECT user_id FROM identity_keys)
UNION ALL SELECT 'ghost_sms',          count(*) FROM ghost_sms          WHERE to_user_id NOT IN (SELECT user_id FROM identity_keys)
UNION ALL SELECT 'user_rotation_limits',count(*) FROM user_rotation_limits WHERE user_id NOT IN (SELECT user_id FROM identity_keys);

DELETE FROM prekeys              WHERE user_id     NOT IN (SELECT user_id FROM identity_keys);
DELETE FROM invites              WHERE owner_alias NOT IN (SELECT user_id FROM identity_keys);
DELETE FROM departures           WHERE from_alias  NOT IN (SELECT user_id FROM identity_keys)
                                    OR to_alias    NOT IN (SELECT user_id FROM identity_keys);
DELETE FROM messages             WHERE to_delivery_id NOT IN (SELECT delivery_id FROM identity_keys WHERE delivery_id IS NOT NULL);
DELETE FROM device_tokens        WHERE user_id NOT IN (SELECT user_id FROM identity_keys);
DELETE FROM reclaim_challenges   WHERE user_id NOT IN (SELECT user_id FROM identity_keys);
DELETE FROM welcome_gifts        WHERE user_id NOT IN (SELECT user_id FROM identity_keys);
DELETE FROM ghost_entitlements   WHERE user_id NOT IN (SELECT user_id FROM identity_keys);
DELETE FROM ghost_payments       WHERE user_id NOT IN (SELECT user_id FROM identity_keys);
DELETE FROM vpn_peers            WHERE user_id NOT IN (SELECT user_id FROM identity_keys);
DELETE FROM ghost_sms            WHERE to_user_id NOT IN (SELECT user_id FROM identity_keys);
DELETE FROM user_rotation_limits WHERE user_id NOT IN (SELECT user_id FROM identity_keys);
\\echo '--- ghost_numbers left intact ---'
SELECT count(*) AS ghost_numbers_kept FROM ghost_numbers;
$END;
EOF
