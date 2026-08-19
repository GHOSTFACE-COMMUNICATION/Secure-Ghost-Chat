/**
 * Shared palette for per-chat wallpaper backgrounds and derived per-contact
 * avatar colour. Both purely local/derived — a background is a user choice
 * stored on the conversation, a profile colour is a pure hash of the alias
 * computed fresh on every device. Neither is ever transmitted.
 *
 * All entries stay in the same dark luminance range as the app's existing
 * `#000000`/`#0A0A0A` — subtle hue tints, not bright colours — so text
 * already calibrated against near-black (timestamps, the translucent
 * system-message banner, empty-state copy) stays legible without any
 * per-swatch contrast logic.
 */
export const CHAT_COLOR_PALETTE: string[] = [
  "#0A0F16", // slate
  "#120A1C", // amethyst
  "#0A1712", // emerald
  "#1A0A14", // garnet
  "#160E08", // bronze
  "#08151A", // petrol
  "#0A0E1C", // sapphire
  "#140F1A", // plum
];

/**
 * Deterministic colour for a contact alias — same alias always yields the
 * same palette entry, on every device, with nothing transmitted or stored.
 */
export function getProfileColor(alias: string): string {
  let hash = 0;
  const upper = alias.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    hash = (hash * 31 + upper.charCodeAt(i)) | 0; // |0 keeps a 32-bit int, avoids float drift
  }
  return CHAT_COLOR_PALETTE[Math.abs(hash) % CHAT_COLOR_PALETTE.length];
}
