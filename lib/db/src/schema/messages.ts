import { pgTable, serial, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Stores encrypted messages for delivery between devices.
 *
 * Messages are encrypted end-to-end on the sender's device before being stored here.
 * The server never has access to plaintext — it only routes opaque ciphertext blobs.
 *
 * Metadata-blindness (task #128):
 *   The sender is NEVER stored — not as an alias, not as a token. The sender's
 *   identity travels only inside the encrypted payload and is recovered by the
 *   recipient's device after decryption. The recipient is addressed by an opaque
 *   `to_delivery_id` (a random per-user routing token, see identity_keys), not a
 *   human alias, so a database dump reveals neither who sent a message nor a
 *   human-readable recipient.
 *
 * x3dhHeader: present only on the very first message in a conversation (X3DH init).
 *   Contains the sender's IK public key, ephemeral key, and which OPK was consumed,
 *   so the recipient's device can derive the same shared secret without any private
 *   keys being transmitted to the server.
 *
 * delivered: set to true once the message has been pushed to the recipient over
 *   WebSocket OR fetched via the /api/messages/pending poll endpoint.
 */
export const messagesTable = pgTable("messages", {
  id:           serial("id").primaryKey(),
  toDeliveryId: text("to_delivery_id").notNull(),
  payload:      text("payload").notNull(),
  x3dhHeader:   text("x3dh_header"),
  delivered:    boolean("delivered").notNull().default(false),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  // The only two reads of this table — deliverPending (ws/manager.ts) and the
  // GET /messages/pending poll (routes/messages.ts) — both filter on exactly
  // this pair, and both run on every reconnect. Without this they were
  // sequential scans of the whole table, so their cost grew with total
  // messages ever sent while their frequency grew with subscriber count.
  //
  // Partial on `delivered = false` (same shape as idx_ghost_numbers_next_rotation):
  // a delivered row is never read back by any query, so it does not belong in
  // the index. That keeps the index sized to the live backlog rather than to
  // lifetime volume.
  index("idx_messages_pending")
    .on(table.toDeliveryId)
    .where(sql`${table.delivered} = false`),
]);

export type Message = typeof messagesTable.$inferSelect;
