import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per identity that has been given the welcome gift — a free month of
 * SPECTER, granted once at the end of sign-up.
 *
 * WHY THIS EXISTS SEPARATELY from ghost_entitlements: that table is also
 * written by the Solana/USDC payment path, so the presence of an entitlement
 * row cannot mean "gift already claimed" — a paying user has one without ever
 * having been given anything. Idempotency needs its own record, and the
 * primary key on user_id is what enforces it: a second claim hits the
 * conflict and grants nothing.
 *
 * Also makes the giveaway auditable. "How many welcome gifts have we given,
 * and when" is a question the finance side will eventually ask, and it should
 * be answerable directly rather than inferred from entitlement shapes.
 */
export const welcomeGiftsTable = pgTable("welcome_gifts", {
  userId: text("user_id").primaryKey(),
  /** The plan granted. Fixed at "specter" today; stored rather than assumed so
   *  a later change of offer stays legible in the historical rows. */
  plan: text("plan").notNull(),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
});

export type WelcomeGift = typeof welcomeGiftsTable.$inferSelect;
