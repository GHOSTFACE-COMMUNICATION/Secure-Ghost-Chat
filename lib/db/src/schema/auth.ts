import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Refresh tokens for the JWT auth system (task #198).
 *
 * The client holds a long-lived (30-day) refresh-token JWT; we store only its
 * SHA-256 hash so a DB leak cannot mint sessions. Refresh is rotation-based:
 * every successful /auth/refresh revokes the presented token (revokedAt) and
 * inserts a new row. /auth/revoke sets revokedAt without issuing a new pair.
 */
export const refreshTokensTable = pgTable("refresh_tokens", {
  id:        serial("id").primaryKey(),
  userId:    text("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type RefreshToken = typeof refreshTokensTable.$inferSelect;
