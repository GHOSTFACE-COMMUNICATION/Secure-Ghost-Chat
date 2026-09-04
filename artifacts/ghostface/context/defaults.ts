// Constants and default-state factories extracted verbatim from
// AppContext.tsx; the provider imports them and re-exports the public ones.

import type { Conversation, Message, Transaction, VPNServer } from "./types";

/**
 * Build a local, non-transported system/status Message (e.g. the
 * "secure channel established" banner). These messages never cross the
 * wire and carry no ciphertext — they are purely informational UI rows.
 */
export function buildSystemMessage(
  text: string,
  disappearAfterSec?: number,
): Message {
  const expiresAt = disappearAfterSec
    ? Date.now() + disappearAfterSec * 1000
    : undefined;

  return {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    text,
    fromMe: false,
    timestamp: Date.now(),
    encrypted: true,
    sealed: true,
    expiresAt,
  };
}

/**
 * Build the default conversations with fresh DR sessions each call.
 * Called on first launch and after panic wipe — ensures all default
 * conversations are always DR-enabled from the first render.
 */
export function createDefaultConversations(): Conversation[] {
  return [];
}

// ── Disappearing messages: always on ────────────────────────────────────────
// Policy (Benji, 19 Aug 2026): every conversation has a disappear timer,
// no OFF setting. Range 5s–7d, default 1h. clampDisappearSec is the single
// place that enforces it — applied to loads (migration of pre-policy
// conversations), local setting changes, and peer-synced "disappear-timer"
// signals (whose sender may be an older build that still knows about OFF /
// undefined).
export const DISAPPEAR_MIN_SEC = 5;
export const DISAPPEAR_MAX_SEC = 7 * 24 * 3600;
export const DEFAULT_DISAPPEAR_SEC = 3600;

export function clampDisappearSec(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DISAPPEAR_SEC;
  return Math.min(DISAPPEAR_MAX_SEC, Math.max(DISAPPEAR_MIN_SEC, Math.round(value)));
}

export const CALL_SIGNAL_TYPES = new Set([
  "call-ring", "call-accept", "call-hangup",
  "call-offer", "call-answer", "call-ice",
]);

export const GHOSTPAD_SIGNAL_TYPES = new Set([
  "ghostpad-created", "ghostpad-paired", "ghostpad-text", "ghostpad-wipe", "ghostpad-ended", "ghostpad-error",
]);

export const DEFAULT_TRANSACTIONS: Transaction[] = [];

const VPN_SERVERS: VPNServer[] = [
  { id: "1", name: "US East", country: "United States", region: "New York", shortRegion: "NYC", flag: "🇺🇸" },
  { id: "2", name: "EU West", country: "Germany", region: "Frankfurt", shortRegion: "FRA", flag: "🇩🇪" },
  { id: "3", name: "Asia Pacific", country: "Japan", region: "Tokyo", shortRegion: "TYO", flag: "🇯🇵" },
  { id: "4", name: "Nordic", country: "Sweden", region: "Stockholm", shortRegion: "ARN", flag: "🇸🇪" },
  { id: "5", name: "Offshore", country: "Iceland", region: "Reykjavik", shortRegion: "KEF", flag: "🇮🇸" },
  { id: "6", name: "SE Asia", country: "Singapore", region: "Singapore", shortRegion: "SIN", flag: "🇸🇬" },
];

export { VPN_SERVERS };
