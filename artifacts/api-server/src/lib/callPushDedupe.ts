/**
 * Call-push deduplication (task #172).
 *
 * A device can end up with BOTH an Expo alert-push token and a native
 * APNs-VoIP/FCM token registered for the same alias (e.g. an Expo Go install
 * later replaced by a dev build, or a build that registers both paths). The
 * native push already wakes the app and shows the full-screen CallKit /
 * Core-Telecom ring — firing the Expo alert too would stack a redundant
 * "Incoming call" notification on top of the native sheet.
 *
 * Rule: for a given (alias, platform), when at least one native token exists
 * AND its transport's credentials are configured (so the native ring will
 * actually be sent), suppress every Expo token for that same platform. When
 * the native transport is unconfigured, the Expo path stays live — it is the
 * only way that platform can ring at all.
 *
 * Kept as a pure function (rows in → rows out) so it can be unit-tested
 * without touching the database or push transports.
 */

export type DedupeTokenRow = {
  tokenType: string; // "expo" | "apns-voip" | "fcm"
  platform: string; // "ios" | "android"
};

const NATIVE_TYPES = new Set(["apns-voip", "fcm"]);

/**
 * Returns the subset of `expoRows` that should still receive the Expo alert
 * push, given every token row registered for the alias. `isConfigured`
 * reports whether a native transport's credentials are present (injected so
 * tests don't depend on process.env).
 */
export function filterExpoRowsShadowedByNative<T extends DedupeTokenRow>(
  allRows: readonly DedupeTokenRow[],
  expoRows: readonly T[],
  isConfigured: (tokenType: "apns-voip" | "fcm") => boolean,
): T[] {
  const nativePlatforms = new Set(
    allRows
      .filter(
        (r) => NATIVE_TYPES.has(r.tokenType) && isConfigured(r.tokenType as "apns-voip" | "fcm"),
      )
      .map((r) => r.platform),
  );
  return expoRows.filter((r) => !nativePlatforms.has(r.platform));
}
