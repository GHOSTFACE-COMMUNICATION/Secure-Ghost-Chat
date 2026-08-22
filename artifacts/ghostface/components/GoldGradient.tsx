import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

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
export const GOLD_OUTLINE_WIDTH = 1;
export const GOLD_OUTLINE_STYLE = {
  borderWidth: GOLD_OUTLINE_WIDTH,
  borderColor: GOLD_OUTLINE_COLOR_CLEAR,
} as const;

// Fallback gradient for platforms without native Liquid Glass. Matches
// NODE_GLASS_METALLIC_FALLBACK on the home screen. The old top stop (#3c3c40)
// was lighter and read as a painted metallic panel.
export const GLASS_METALLIC_BLACK = ["#2a2a2c", "#141416", "#050505", "#000000"] as const;

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

const useNativeGlass = isLiquidGlassAvailable();

// Diagonal specular highlight — a light streak across the upper-left of the
// surface, like light catching a curved glass edge. Native Liquid Glass
// does this dynamically on a real device (moves with tilt/scroll); this is
// the static approximation both paths render underneath, since neither
// GlassView's own effect nor the flat metallic fallback has this on its
// own. Sits above the glass/gradient, below the button's own content.
export function SpecularHighlight({ intensity = 0.65 }: { intensity?: number }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={["rgba(255,255,255,0)", `rgba(255,255,255,${intensity})`, "rgba(255,255,255,0)"]}
      locations={[0.15, 0.35, 0.55]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
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
  if (useNativeGlass) {
    return (
      <GlassView
        style={[
          { overflow: "hidden" },
          GOLD_OUTLINE_STYLE,
          solid && { backgroundColor: GLASS_SOLID_FILL },
          style,
        ]}
        glassEffectStyle="clear"
        tintColor={GLASS_TINT_BLACK}
        isInteractive
      >
        <SpecularHighlight intensity={specularIntensity} />
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView
      intensity={32}
      tint="dark"
      style={[{ overflow: "hidden" }, GOLD_OUTLINE_STYLE, style]}
    >
      <LinearGradient
        colors={GLASS_METALLIC_BLACK}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[{ backgroundColor: "#000000" }, StyleSheet.absoluteFill]}
      />
      {/* Same reasoning as the native path: without native refraction this
          gradient bottoms out at pure black, so a surface on a black screen
          needs the fill to be visible at all. */}
      {solid && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: GLASS_SOLID_FILL }]}
        />
      )}
      <SpecularHighlight intensity={specularIntensity} />
      {children}
    </BlurView>
  );
}
