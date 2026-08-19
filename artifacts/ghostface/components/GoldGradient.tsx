import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";

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

// Black liquid-glass tint — the button surface itself stays dark/translucent
// (matching the app's black backdrop) with the gold carried by the outline
// and the white specular shine instead of a gold fill. Alpha kept moderate
// so native Liquid Glass still shows real refraction/blur under it rather
// than reading as an opaque flat panel. Lifted a bit off pure black (grey
// instead of near-black) for a touch more white in the surface itself, on
// top of the white shine.
export const GLASS_TINT_BLACK = "rgba(60,60,64,0.5)";
export const GOLD_OUTLINE_COLOR = "#F5D26B";
// Translucent gold used on the app's general glass buttons (everything
// except the radial menu, which keeps a crisper solid edge) — a lighter
// touch so these surfaces read as clear glass with a gold hint, not a
// gold-ringed panel.
export const GOLD_OUTLINE_COLOR_CLEAR = "rgba(245,210,107,0.45)";
export const GOLD_OUTLINE_WIDTH = 1;
export const GOLD_OUTLINE_STYLE = {
  borderWidth: GOLD_OUTLINE_WIDTH,
  borderColor: GOLD_OUTLINE_COLOR_CLEAR,
} as const;

// Fallback (non-native-glass) gradient for the black-tint style — dark
// graphite rather than metallic gold, since the gold now lives in the
// outline/shine, not the fill. Top stop lifted a touch for the same
// "more white" nudge as GLASS_TINT_BLACK above.
export const GLASS_METALLIC_BLACK = ["#3c3c40", "#141416", "#050505", "#000000"] as const;

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
export function GoldGradient({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  if (useNativeGlass) {
    return (
      <GlassView
        style={[{ overflow: "hidden" }, GOLD_OUTLINE_STYLE, style]}
        glassEffectStyle="clear"
        tintColor={GLASS_TINT_BLACK}
        isInteractive
      >
        <SpecularHighlight />
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
      <SpecularHighlight />
      {children}
    </BlurView>
  );
}
