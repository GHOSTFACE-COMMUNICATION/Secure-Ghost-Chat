import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { useApp } from "@/context/AppContext";
import { boxShadow } from "@/lib/shadow";

// Light-mode depth treatment. A gold glass surface on a light/white
// background has no dark backdrop to separate it visually the way it does
// in dark mode, so it needs an explicit raised look: a soft gold-toned drop
// shadow underneath, plus a bright inset highlight along the top edge and a
// faint inset shadow along the bottom — the same "beveled glass" cues used
// on the coin rim, just gold-toned instead of neutral. Dark mode is left
// alone; its glass already reads as glass against the black backdrop.
const LIGHT_DEPTH_SHADOW = [
  boxShadow("#8a6d1f", 0.28, 10, 0, 4),
  `inset ${boxShadow("#FFFFFF", 0.85, 0, 0, 1)}`,
  `inset ${boxShadow("#B8892A", 0.25, 3, 0, -2)}`,
].join(", ");

// Metallic gold sheen used across the app's gold surfaces (buttons/badges).
// Pale-gold highlight → bright gold → deep gold → dark edge gives a polished,
// beveled-metal look that a single flat fill cannot. Also doubles as the
// fallback gradient on platforms without native Liquid Glass (below).
// Anchored on #F5D26B — the actual registered trademark gold (see the GF
// monogram artwork) — not an approximation of it.
export const GOLD_METALLIC = ["#FBEACB", "#F5D26B", "#D1A94A", "#9C7A2E"] as const;
export const GOLD_METALLIC_LOCATIONS = [0, 0.45, 0.75, 1] as const;

// Same gold used as the "active" tint on the home screen's radial-menu glass
// nodes — kept in one place so every gold-glass surface in the app tints
// identically. rgba of #F5D26B. Alpha deliberately high (not a "subtle
// tint" value): native Liquid Glass tintColor alpha-composites over
// whatever's behind it, and this app's backdrop is solid black almost
// everywhere — at low alpha the result reads as dark olive-brown, not
// gold (rgba(...,0.4) over black renders ~rgb(98,84,43); confirmed on
// device). 0.82 is the lowest alpha that still reads unambiguously gold
// against a black backdrop while keeping some genuine translucency.
export const GOLD_GLASS_TINT = "rgba(245,210,107,0.82)";

// Light-theme glass tint. A white backdrop has the OPPOSITE problem from
// black: alpha-compositing gold over white lightens it toward pastel cream
// rather than muddying it toward brown, so it actually needs a HIGHER alpha
// than the dark-mode tint to read as true gold rather than a wash — e.g.
// rgba(245,210,107,0.62) over solid white composites to ~rgb(249,227,163),
// a pale cream, not gold. 0.85 composites to ~rgb(246,214,118), close to
// the trademark hex itself.
export const GOLD_GLASS_TINT_LIGHT = "rgba(245,210,107,0.85)";

// Black liquid-glass tint — MUST match the home screen's radial-menu nodes
// (NODE_GLASS_TINT in app/(tabs)/index.tsx). Those are the reference
// treatment: they are the one surface in the app that reads as real glass,
// and every other glass button should be indistinguishable from them.
//
// This was previously rgba(60,60,64,0.5) — a lighter, greyer tint that made
// buttons look like painted plastic imitating glass rather than glass. The
// home screen was corrected in ca2d7aa; GoldGradient was not, which is why
// the rest of the app diverged from it.
export const GLASS_TINT_BLACK = "rgba(10,10,12,0.55)";

export const GOLD_OUTLINE_COLOR = "#F5D26B";

// Neutral white rim, matching nodeCircleGlassBorder on the home screen.
//
// The gold rim this replaces was the other half of the "fake glass" problem:
// real glass picks up a light edge from what's behind it, not a coloured
// ring painted around it. The gold now lives only in content (icons, text,
// active states), never in the surface edge. Kept as GOLD_OUTLINE_* names so
// existing call sites keep working.
export const GOLD_OUTLINE_COLOR_CLEAR = "rgba(255,255,255,0.18)";
// Light-theme rim — a white rim on a white/light background would be
// invisible, so light mode gets a muted gold-brown edge instead.
export const GOLD_OUTLINE_COLOR_CLEAR_LIGHT = "rgba(217,161,26,0.9)";
export const GOLD_OUTLINE_WIDTH = 1;
export const GOLD_OUTLINE_STYLE = {
  borderWidth: GOLD_OUTLINE_WIDTH,
  borderColor: GOLD_OUTLINE_COLOR_CLEAR,
} as const;
export const GOLD_OUTLINE_STYLE_LIGHT = {
  borderWidth: GOLD_OUTLINE_WIDTH,
  borderColor: GOLD_OUTLINE_COLOR_CLEAR_LIGHT,
} as const;

// Fallback gradient for platforms without native Liquid Glass. Matches
// NODE_GLASS_METALLIC_FALLBACK on the home screen. The old top stop (#3c3c40)
// was lighter and read as a painted metallic panel.
export const GLASS_METALLIC_BLACK = ["#2a2a2c", "#141416", "#050505", "#000000"] as const;
// Light-theme fallback gradient — reuses GOLD_METALLIC directly (the same
// trademark-anchored stops used elsewhere in the app) rather than a paler
// approximation, so the light-mode fallback reads as the same brand gold.
export const GLASS_METALLIC_GOLD_LIGHT = GOLD_METALLIC;

/**
 * Fill for glass surfaces that sit on a FLAT BLACK background with nothing
 * behind them to refract — the lock screen PIN pad being the case that
 * exposed this.
 *
 * Liquid glass works by bending whatever is behind it. The home screen's
 * nodes look right because the spinning coin and its glow sit underneath.
 * Put the same "clear" glass on a plain #000000 screen and there is nothing
 * to bend, so it renders as... black. That is why the PIN pad keys
 * disappeared.
 *
 * Surfaces like that need an actual visible material instead: a faint white
 * fill that lifts them off the background, with the same rim so they still
 * belong to the same family. Use <GoldGradient solid> for these.
 */
export const GLASS_SOLID_FILL = "rgba(255,255,255,0.07)";
// Light-theme equivalent — a faint gold fill rather than white-on-white,
// which would add nothing visible.
export const GLASS_SOLID_FILL_LIGHT = "rgba(217,161,26,0.32)";

const useNativeGlass = isLiquidGlassAvailable();

// Diagonal specular highlight — a light streak across the upper-left of the
// surface, like light catching a curved glass edge. Native Liquid Glass
// does this dynamically on a real device (moves with tilt/scroll); this is
// the static approximation both paths render underneath, since neither
// GlassView's own effect nor the flat metallic fallback has this on its
// own. Sits above the glass/gradient, below the button's own content.
// `rgb` lets a gold surface use a warm cream highlight instead of pure
// white, so the streak reads as "light catching gold" rather than a
// generic glass glare sitting on top of it.
export function SpecularHighlight({ intensity = 0.65, rgb = "255,255,255" }: { intensity?: number; rgb?: string }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[`rgba(${rgb},0)`, `rgba(${rgb},${intensity})`, `rgba(${rgb},0)`]}
      locations={[0.15, 0.35, 0.55]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

// Metallic banding for the NATIVE glass path in light mode. The native
// GlassView only takes a flat tintColor — no gradient — so on its own it
// reads as a single flat wash of color. This overlays the same
// light-to-dark gold banding the fallback path gets for free from its
// LinearGradient fill, translucent enough that the native blur/refraction
// still shows through underneath. Fallback path doesn't need this — its
// GLASS_METALLIC_GOLD_LIGHT fill already provides the banding.
const GOLD_TEXTURE_LIGHT = [
  "rgba(255,250,235,0.55)",
  "rgba(245,210,107,0.1)",
  "rgba(184,137,42,0.4)",
] as const;

function GoldTexture() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={GOLD_TEXTURE_LIGHT}
      locations={[0, 0.45, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
}

// Renders the app's standard gold surface: real native Liquid Glass (iOS 26+)
// where available, tinted gold, with this same metallic-gradient look as the
// fallback everywhere else — so every button wrapped in <GoldGradient> reads
// as the same "gold liquid glass" surface without call sites needing to know
// which path rendered. `style` is expected to carry sizing/borderRadius/
// padding, same as before.
// Default specular intensity for <GoldGradient> surfaces. Deliberately far
// lower than SpecularHighlight's own 0.65 default: that value was tuned for
// the radial menu's 44×44 circular nodes, where a tight diagonal streak
// reads as light catching a curved glass edge. Stretched across a
// full-width rectangular button the same streak becomes a bright bar
// sitting behind the label, and text — especially mutedForeground on
// inactive/disabled states — loses contrast where it crosses. Keep this low
// enough that the surface still reads as glass without competing with its
// own content; pass `specularIntensity` to opt a small//round surface back
// up if it needs the stronger sheen.
const WIDE_SURFACE_SPECULAR = 0.22;

/**
 * The radial menu's glass specular, promoted to a shared token.
 *
 * app/(tabs)/index.tsx kept its own frozen copy of the menu's glass values so
 * they couldn't drift when the shared button tint was tuned. The tint and the
 * fallback gradient in that copy turned out to be character-identical to
 * GLASS_TINT_BLACK / GLASS_METALLIC_BLACK, so the copy was protecting nothing —
 * what actually set the menu apart was this specular (originally 0.35 against
 * the 0.22 default, raised when the globe made everything else look matte, then walked
 * back to 0.486) and the absence of the `solid` white fill. Sharing the number is
 * what makes "match the radial menu" checkable instead of a value to remember.
 */
export const GLASS_REFERENCE_SPECULAR = 0.486;

export function GoldGradient({
  style,
  children,
  specularIntensity = WIDE_SURFACE_SPECULAR,
  solid = false,
}: {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  specularIntensity?: number;
  /**
   * Set on surfaces sitting on a flat black background with nothing behind
   * them to refract (the lock-screen PIN pad). Adds a faint white fill so
   * the surface is actually visible, instead of clear glass over #000000
   * rendering as black. See GLASS_SOLID_FILL.
   */
  solid?: boolean;
}) {
  const { themePreference } = useApp();
  const isLight = themePreference === "light";
  // Light-mode glass needs a stronger sheen than dark mode to read as glass
  // rather than a flat tinted panel — dark mode relies on the black backdrop
  // for contrast, light mode doesn't have that crutch.
  const effectiveSpecular = isLight ? Math.min(1, specularIntensity * 1.8) : specularIntensity;
  // Warm cream highlight for gold surfaces instead of a plain white glare —
  // reads as light catching gold rather than glass sitting on top of it.
  const specularRgb = isLight ? "255,247,222" : "255,255,255";

  if (useNativeGlass) {
    return (
      <GlassView
        style={[
          { overflow: "hidden" },
          isLight ? GOLD_OUTLINE_STYLE_LIGHT : GOLD_OUTLINE_STYLE,
          isLight && { boxShadow: LIGHT_DEPTH_SHADOW },
          solid && { backgroundColor: isLight ? GLASS_SOLID_FILL_LIGHT : GLASS_SOLID_FILL },
          style,
        ]}
        glassEffectStyle="clear"
        tintColor={isLight ? GOLD_GLASS_TINT_LIGHT : GLASS_TINT_BLACK}
        isInteractive
      >
        {isLight && <GoldTexture />}
        <SpecularHighlight intensity={effectiveSpecular} rgb={specularRgb} />
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView
      intensity={32}
      tint={isLight ? "light" : "dark"}
      style={[
        { overflow: "hidden" },
        isLight ? GOLD_OUTLINE_STYLE_LIGHT : GOLD_OUTLINE_STYLE,
        isLight && { boxShadow: LIGHT_DEPTH_SHADOW },
        style,
      ]}
    >
      <LinearGradient
        colors={isLight ? GLASS_METALLIC_GOLD_LIGHT : GLASS_METALLIC_BLACK}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[{ backgroundColor: isLight ? "#FFFDF5" : "#000000" }, StyleSheet.absoluteFill]}
      />
      {/* Same reasoning as the native path: without native refraction this
          gradient bottoms out at pure black (or pale gold, in light mode)
          on a flat background, so a surface there needs the fill to be
          visible at all. */}
      {solid && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: isLight ? GLASS_SOLID_FILL_LIGHT : GLASS_SOLID_FILL }]}
        />
      )}
      <SpecularHighlight intensity={effectiveSpecular} rgb={specularRgb} />
      {children}
    </BlurView>
  );
}
