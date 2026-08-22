import { Platform, TextStyle } from "react-native";

/**
 * The app's type scale.
 *
 * ── Why this file exists ───────────────────────────────────────────────
 * Before this, there was no typography system at all: ~190 ad-hoc
 * fontWeight/letterSpacing values were spread across the screens, skewed
 * heavily toward `fontWeight: "800"` (132 uses) with wide tracking
 * (letterSpacing 2/3/4) and near-universal ALL CAPS. Heavy weight + wide
 * tracking + caps reads as *tactical*; the brief was *executive*, which is
 * close to the opposite — lighter weights, tighter tracking, and whitespace
 * doing the work instead of weight.
 *
 * Inter was already installed and loaded in app/_layout.tsx but never
 * applied anywhere, so the app was rendering in the platform default (SF Pro
 * / Roboto) while still paying to download four Inter weights. These styles
 * actually use it.
 *
 * ── IMPORTANT: family names, not fontWeight ────────────────────────────
 * @expo-google-fonts ships each weight as its own family: `Inter_400Regular`,
 * `Inter_500Medium`, and so on. The correct way to select a weight is to set
 * `fontFamily` to that exact name and to NOT set `fontWeight`. Setting both
 * makes Android synthesise a fake bold on top of an already-bold face, which
 * is precisely the too-heavy look this is meant to fix.
 *
 * So: pick a style from this file. Don't add `fontWeight` next to it.
 *
 * ── Weight ceiling ─────────────────────────────────────────────────────
 * The heaviest Inter weight loaded is 700. Nothing here goes above 600
 * except `display`, which is the one genuine headline moment. Existing
 * `fontWeight: "800"` call sites cannot be honoured by the loaded font at
 * all — they were only ever working because no fontFamily was set.
 */

export const FONT = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

/**
 * Monospace, for values a user might need to read character by character:
 * key fingerprints, wallet addresses, recovery phrases, PIN entry. Kept as
 * the platform mono rather than Share Tech Mono for anything where
 * character disambiguation matters more than styling.
 */
export const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
}) as string;

/** Share Tech Mono — the loaded display mono, for deliberate "terminal" moments. */
export const MONO_DISPLAY = "ShareTechMono_400Regular";

/**
 * Tracking scale.
 *
 * Negative tracking on large text is what makes a headline look composed
 * rather than shouted — the bigger the type, the tighter it wants to be.
 * The old values (2–4, occasionally 6) were applied uniformly regardless of
 * size, which is what produced the spaced-out, uppercase, tactical register.
 * Wide tracking is now reserved for genuinely small uppercase labels, where
 * it aids legibility instead of adding volume.
 */
export const TRACKING = {
  display: -0.6,
  title: -0.3,
  heading: -0.1,
  body: 0,
  label: 1,
  micro: 1.4,
} as const;

type T = TextStyle;

/**
 * Semantic text styles. Spread into a StyleSheet entry and add colour:
 *
 *   title: { ...type.title, color: colors.foreground }
 */
// ── Weight pass 2 ──────────────────────────────────────────────────────
// Every style below dropped one step: semibold→medium, medium→regular. The
// first pass removed the 800s but still leant on 600 for headings and 500
// for body, which kept the screens feeling denser than intended. Weight is
// now carried almost entirely by size and colour rather than stroke, which
// is what reads as "executive" rather than "sturdy". 600 survives only on
// `title`, and 700 nowhere.
export const type = {
  /** Screen-level headline. */
  display: { fontFamily: FONT.semibold, fontSize: 26, letterSpacing: TRACKING.display } as T,

  /** Screen titles / header bars. The only remaining 600. */
  title: { fontFamily: FONT.semibold, fontSize: 20, letterSpacing: TRACKING.title } as T,

  /** Section headings, card titles, primary row labels. */
  heading: { fontFamily: FONT.medium, fontSize: 16, letterSpacing: TRACKING.heading } as T,

  /** Emphasised row text — a setting's name, a contact's alias. */
  subheading: { fontFamily: FONT.regular, fontSize: 15, letterSpacing: TRACKING.heading } as T,

  /** Default reading text. */
  body: { fontFamily: FONT.regular, fontSize: 15, letterSpacing: TRACKING.body } as T,

  /** Body text that needs weight without becoming a heading. */
  bodyStrong: { fontFamily: FONT.medium, fontSize: 15, letterSpacing: TRACKING.body } as T,

  /** Secondary/explanatory copy. */
  caption: { fontFamily: FONT.regular, fontSize: 13, letterSpacing: TRACKING.body } as T,

  /**
   * Small uppercase labels — section dividers, status chips, button text.
   * This is the one place tracking stays wide, because small caps genuinely
   * need it. Apply `textTransform: "uppercase"` at the call site.
   */
  label: { fontFamily: FONT.regular, fontSize: 11, letterSpacing: TRACKING.label } as T,

  /** Same, with a little more presence — active tabs, primary button text. */
  labelStrong: { fontFamily: FONT.medium, fontSize: 11, letterSpacing: TRACKING.label } as T,

  /** Timestamps, counters, the smallest supporting text. */
  micro: { fontFamily: FONT.regular, fontSize: 9, letterSpacing: TRACKING.micro } as T,

  /** Technical values read character by character. */
  mono: { fontFamily: MONO, fontSize: 13, letterSpacing: 0.4 } as T,
  monoSmall: { fontFamily: MONO, fontSize: 11, letterSpacing: 0.4 } as T,
} as const;

export type TypeToken = keyof typeof type;
