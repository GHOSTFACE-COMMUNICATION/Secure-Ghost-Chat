import { db, identityKeysTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";

/**
 * Opaque per-user routing token. Messages are addressed to this id instead of
 * the human alias so neither stored rows nor wire frames expose the recipient's
 * identity. 16 random bytes → 32 hex chars; collision probability is negligible
 * and the column carries a UNIQUE constraint as a backstop.
 */
export function generateDeliveryId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Return the user's delivery id, lazily generating + persisting one when the
 * row predates task #128 (delivery_id IS NULL). Returns null only when the user
 * has no identity_keys row at all.
 */
export async function ensureDeliveryId(userId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(identityKeysTable)
    .where(eq(identityKeysTable.userId, userId));
  if (!row) return null;
  if (row.deliveryId) return row.deliveryId;

  // Backfill atomically: the UPDATE only fires while delivery_id IS NULL, so
  // concurrent first-time callers can't each mint (and clobber) a different
  // token — exactly one write wins and the rest fall through to re-read it.
  // Without this guard a later writer could overwrite an id a sender already
  // received, stranding messages addressed to the old token.
  const deliveryId = generateDeliveryId();
  const claimed = await db
    .update(identityKeysTable)
    .set({ deliveryId })
    .where(and(eq(identityKeysTable.userId, userId), isNull(identityKeysTable.deliveryId)))
    .returning({ deliveryId: identityKeysTable.deliveryId });
  if (claimed.length > 0) return claimed[0].deliveryId;

  // Lost the race (someone set it first) — return the now-committed value.
  const [fresh] = await db
    .select({ deliveryId: identityKeysTable.deliveryId })
    .from(identityKeysTable)
    .where(eq(identityKeysTable.userId, userId));
  return fresh?.deliveryId ?? null;
}

export interface PushTokens {
  expoPushToken: string | null;
  voipPushToken: string | null;
}

/** Push tokens for a user addressed by alias — used for call signalling, which is alias-addressed. */
export async function pushTokensForAlias(userId: string): Promise<PushTokens | null> {
  const [row] = await db
    .select({ expoPushToken: identityKeysTable.expoPushToken, voipPushToken: identityKeysTable.voipPushToken })
    .from(identityKeysTable)
    .where(eq(identityKeysTable.userId, userId));
  return row ?? null;
}

/** Push tokens for a user addressed by delivery id — used for messages, which are delivery-id-addressed. */
export async function pushTokensForDeliveryId(deliveryId: string): Promise<PushTokens | null> {
  const [row] = await db
    .select({ expoPushToken: identityKeysTable.expoPushToken, voipPushToken: identityKeysTable.voipPushToken })
    .from(identityKeysTable)
    .where(eq(identityKeysTable.deliveryId, deliveryId));
  return row ?? null;
}

/**
 * Clears a dead expo push token (Expo reported DeviceNotRegistered) so we
 * stop pushing to it — addressed by alias, for the call-wake path.
 */
export async function clearExpoPushTokenForAlias(userId: string): Promise<void> {
  await db.update(identityKeysTable).set({ expoPushToken: null }).where(eq(identityKeysTable.userId, userId));
}

/** Same, addressed by delivery id, for the message-wake path. */
export async function clearExpoPushTokenForDeliveryId(deliveryId: string): Promise<void> {
  await db
    .update(identityKeysTable)
    .set({ expoPushToken: null })
    .where(eq(identityKeysTable.deliveryId, deliveryId));
}

/**
 * Clears a dead VoIP (PushKit) token — APNs reported it permanently invalid
 * (BadDeviceToken/Unregistered) — so we stop wasting an APNs round-trip plus
 * the full call-wake grace window on every future call to this user.
 */
export async function clearVoipPushTokenForAlias(userId: string): Promise<void> {
  await db.update(identityKeysTable).set({ voipPushToken: null }).where(eq(identityKeysTable.userId, userId));
}
