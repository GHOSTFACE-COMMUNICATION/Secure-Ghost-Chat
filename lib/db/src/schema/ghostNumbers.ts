import {
  pgTable,
  text,
  jsonb,
  timestamp,
  serial,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Pool inventory. GHOSTFACE is the sole subscriber of every number here —
 * numbers are NEVER assigned to a user. A user reaches a number only through
 * a lease in `number_leases`, scoped to one external counterparty.
 *
 * This replaced a per-user model on 5 Sep 2026 (TRACKER GF-20). The dropped
 * columns are load-bearing history, so they are named here rather than just
 * deleted: `user_id` (ownership), `plan` (per-user billing tier),
 * `rotate_every_days` / `next_rotation_at` / `archived_msisdns` (rotation).
 * Rotation existed because a user *held* a number; nobody holds one now.
 */
export const ghostNumbersTable = pgTable(
  "ghost_numbers",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull().default("vonage"),
    phoneNumber: text("phone_number").notNull(),
    country: text("country").notNull(),
    capabilities: jsonb("capabilities").notNull().default(["SMS"]),
    /** available | leased | quarantined | released */
    status: text("status").notNull().default("available"),
    msisdn: text("msisdn").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    // Lease acquisition scans for free inventory in a country; nothing else
    // scans this table in a hot path.
    index("idx_ghost_numbers_status_country").on(table.status, table.country),
    uniqueIndex("uq_ghost_numbers_msisdn").on(table.msisdn),
  ],
);

/**
 * A lease binds one pool number to one external counterparty for one owner.
 * Identity of a conversation is the PAIR, not the number: the same pool number
 * serves many counterparties at once, which is what lets a small pool cover a
 * large user base and what removes any per-user carrier relationship.
 */
export const numberLeasesTable = pgTable(
  "number_leases",
  {
    id: serial("id").primaryKey(),
    poolNumberId: integer("pool_number_id").notNull(),
    /** The counterparty's real E.164 number. Never shown to the owner's peer. */
    externalNumber: text("external_number").notNull(),
    /** Alias of the GHOSTFACE user this lease routes to. */
    ownerAlias: text("owner_alias").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    releasedAt: timestamp("released_at"),
  },
  (table) => [
    // THE constraint that defines the model: a (pool number, counterparty)
    // pair may have at most one LIVE lease. Partial, so released rows accumulate
    // as history without ever blocking re-lease of the same pair later.
    uniqueIndex("uq_number_leases_active_pair")
      .on(table.poolNumberId, table.externalNumber)
      .where(sql`released_at IS NULL`),
    // Inbound routing lookup: (to, from) -> lease.
    index("idx_number_leases_routing")
      .on(table.poolNumberId, table.externalNumber)
      .where(sql`released_at IS NULL`),
    // "List my leases".
    index("idx_number_leases_owner").on(table.ownerAlias).where(sql`released_at IS NULL`),
  ],
);

export const ghostSmsTable = pgTable("ghost_sms", {
  id: serial("id").primaryKey(),
  numberId: text("number_id").notNull(),
  /** Provenance: which lease routed this message. Null for pre-GF-20 rows. */
  leaseId: integer("lease_id"),
  toUserId: text("to_user_id").notNull(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  body: text("body").notNull(),
  direction: text("direction").notNull().default("inbound"),
  providerMetadata: jsonb("provider_metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Exactly-once ledger for the dead-end auto-reply.
 *
 * Policy for inbound with no active lease is DROP: the message is not stored,
 * not routed, and never auto-leased or held. We answer the sender ONCE so the
 * number is not a silent black hole, then stay silent forever after.
 *
 * The composite primary key IS the enforcement — the send is gated on an
 * `INSERT ... ON CONFLICT DO NOTHING` affecting a row, so concurrent inbound
 * from the same pair can only ever produce one reply.
 */
export const deadEndRepliesTable = pgTable(
  "dead_end_replies",
  {
    poolMsisdn: text("pool_msisdn").notNull(),
    externalNumber: text("external_number").notNull(),
    repliedAt: timestamp("replied_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.poolMsisdn, table.externalNumber] })],
);
