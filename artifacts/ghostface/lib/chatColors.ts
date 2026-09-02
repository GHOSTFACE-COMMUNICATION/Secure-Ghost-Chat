/**
 * Shared palette for per-chat wallpaper backgrounds and derived per-contact
 * avatar colour. Both purely local/derived — a background is a user choice
 * stored on the conversation, a profile colour is a pure hash of the alias
 * computed fresh on every device. Neither is ever transmitted.
 *
 * Unlike the old muted/dark-only palette, these span light and dark swatches
 * (white and grey included), so nothing here can assume a fixed text colour
 * reads legibly on top of it — callers must use `getContrastText` for any
 * text/icon drawn directly on a swatch. Wallpaper use (chat screen
 * background) instead darkens via a scrim rather than picking text colour
 * per swatch — see the scrim comment in app/chat/[id].tsx.
 */
export const CHAT_COLOR_PALETTE: string[] = [
  "#FFFFFF", // white
  "#000000", // black
  "#8E8E93", // grey
  "#0A84FF", // blue
  "#FF3B30", // red
  "#DEB451", // gold — the app's brand gold, see GoldGradient.tsx
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

/**
 * Relative-luminance-based text colour for content drawn directly on a
 * palette swatch (e.g. avatar initials) — light swatches get dark text,
 * dark swatches get light text. Not needed for wallpaper use, which relies
 * on the scrim instead.
 */
export function getContrastText(hex: string): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#0A0A0A" : "#FFFFFF";
}
