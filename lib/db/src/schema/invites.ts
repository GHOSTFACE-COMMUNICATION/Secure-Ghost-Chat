import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";

/**
 * Stores short-lived invite codes that map a random GF-XXXX-XXXX code
 * to the real alias of the person who generated it.
 *
 * When Person A generates a code, their alias is stored here.
 * When Person B redeems the code, they look up the ownerAlias and
 * establish a real E2EE session with that alias — not a phantom.
 *
 * Codes are single-use: redeemed is set to true after first use.
 * Expired or redeemed codes return 404/410.
 */
export const invitesTable = pgTable("invites", {
  id:         serial("id").primaryKey(),
  code:       text("code").notNull().unique(),
  ownerAlias: text("owner_alias").notNull(),
  expiresAt:  timestamp("expires_at").notNull(),
  redeemed:   boolean("redeemed").notNull().default(false),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});

export type Invite = typeof invitesTable.$inferSelect;
