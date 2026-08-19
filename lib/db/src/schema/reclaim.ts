import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Short-lived DH possession-proof challenges for alias reclaim (recovery
 * phrase flow). A device that regenerated the original IK private key from
 * its recovery phrase proves it — without ever sending that private key
 * over the wire — via a DH key-confirmation handshake:
 *
 *   1. Server generates an ephemeral X25519 keypair, stores the private
 *      half here keyed by a random challengeId, sends the public half +
 *      nonce to the client.
 *   2. Client computes ss = X25519(recoveredIkPriv, serverEphPub) and
 *      returns HMAC-SHA256(ss, nonce).
 *   3. Server recomputes ss' = X25519(serverEphPriv, storedIkPublicKey)
 *      for that alias — by ECDH commutativity ss === ss' iff the client's
 *      key truly matches what's on file — and verifies the HMAC.
 *
 * One-shot and short-TTL by design: a row is deleted the moment it's used
 * or found expired, and a background sweep (see reclaim route) clears
 * anything left over from an abandoned attempt.
 */
export const reclaimChallengesTable = pgTable("reclaim_challenges", {
  id:            serial("id").primaryKey(),
  challengeId:   text("challenge_id").notNull().unique(),
  userId:        text("user_id").notNull(),
  serverEphPriv: text("server_eph_priv").notNull(),
  nonce:         text("nonce").notNull(),
  expiresAt:     timestamp("expires_at").notNull(),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});

export type ReclaimChallenge = typeof reclaimChallengesTable.$inferSelect;
