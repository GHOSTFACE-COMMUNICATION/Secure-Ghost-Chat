import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Push tokens for waking a device when a call rings while the app is
 * closed (task #150, Phase 2/3 calling push).
 *
 * One row per (device) push token. `userId` is the alias the token routes
 * for — used ONLY server-side to select which device(s) to push when a
 * call-ring arrives for an offline alias. The push payload itself never
 * carries the alias or any caller identity (see the payload contract in
 * artifacts/ghostface/lib/callPush.ts): it holds just the opaque callId
 * and the call mode, useless to anyone but the holder of the session keys.
 *
 * `token` is opaque to us; `tokenType` says which transport it rides
 * (task #152):
 * - "expo"      — Expo push token (ExponentPushToken[...]) for the alert-push
 *                 wake path via Expo's push service.
 * - "apns-voip" — raw APNs PushKit VoIP token: native full-screen CallKit
 *                 ring on iOS dev/production builds.
 * - "fcm"       — raw FCM registration token: Core-Telecom full-screen ring
 *                 on Android dev/production builds (FCM data message).
 * Unique so a token that moves between aliases (device wipe + re-register)
 * is re-pointed, never duplicated.
 */
export const callPushTokensTable = pgTable("call_push_tokens", {
  id:        serial("id").primaryKey(),
  userId:    text("user_id").notNull(),
  token:     text("token").notNull().unique(),
  platform:  text("platform").notNull(), // "ios" | "android"
  tokenType: text("token_type").notNull().default("expo"), // "expo" | "apns-voip" | "fcm"
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CallPushToken = typeof callPushTokensTable.$inferSelect;
