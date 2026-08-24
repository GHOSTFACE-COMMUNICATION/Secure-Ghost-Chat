import { pgTable, serial, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Stores one-shot "I have self-destructed" notices broadcast by a client
 * just before it performs a local panic wipe. Each row pairs a departing
 * alias with one of its known contacts, so when that contact next connects
 * its conversation entry can be flagged as a destroyed contact in the UI.
 *
 * The payload is intentionally minimal: no message content, no keys, no
 * ciphertext — just the fact that `fromAlias` is gone, intended for
 * `toAlias`. Rows are marked `delivered` once pushed over WebSocket so we
 * don't replay the notice on every reconnect.
 */
export const departuresTable = pgTable("departures", {
  id:        serial("id").primaryKey(),
  fromAlias: text("from_alias").notNull(),
  toAlias:   text("to_alias").notNull(),
  delivered: boolean("delivered").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  // deliverPendingDepartures (ws/manager.ts) filters on exactly this pair on
  // every reconnect — same unindexed-sequential-scan problem the messages
  // table had, and the same partial-index fix.
  index("idx_departures_pending")
    .on(table.toAlias)
    .where(sql`${table.delivered} = false`),
]);

export type Departure = typeof departuresTable.$inferSelect;
