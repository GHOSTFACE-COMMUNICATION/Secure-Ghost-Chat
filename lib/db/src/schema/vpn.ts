import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * One row per device's WireGuard tunnel registration. The device generates
 * its own WireGuard keypair on-device — the private key never leaves it,
 * only the public key is ever sent here. tunnelIp is the address assigned
 * inside the VPN's 10.66.0.0/24 range and is what gets pushed as this
 * peer's AllowedIPs on the WireGuard server (see routes/vpn.ts).
 *
 * userId is unique — mirrors deviceTokensTable's one-device-per-identity
 * model (see prekeys.ts). Re-registering (new key, e.g. app reinstall)
 * replaces the existing row and re-pushes the new peer to the server,
 * removing the old one.
 */
export const vpnPeersTable = pgTable("vpn_peers", {
  id:        serial("id").primaryKey(),
  userId:    text("user_id").notNull().unique(),
  publicKey: text("public_key").notNull().unique(),
  tunnelIp:  text("tunnel_ip").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type VpnPeer = typeof vpnPeersTable.$inferSelect;
