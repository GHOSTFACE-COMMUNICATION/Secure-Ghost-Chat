import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";

// Metallic gold sheen used across the app's gold surfaces (buttons/badges).
// Pale-gold highlight → bright gold → deep gold → dark edge gives a polished,
// beveled-metal look that a single flat fill cannot. Also doubles as the
// fallback gradient on platforms without native Liquid Glass (below).
export const GOLD_METALLIC = ["#f4e2a1", "#d9b84a", "#bf9b30", "#9a7a24"] as const;
export const GOLD_METALLIC_LOCATIONS = [0, 0.45, 0.75, 1] as const;

// Same gold used as the "active" tint on the home screen's radial-menu glass
// nodes — kept in one place so every gold-glass surface in the app tints
// identically.
export const GOLD_GLASS_TINT = "rgba(245,200,80,0.4)";

const useNativeGlass = isLiquidGlassAvailable();

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
        style={[{ overflow: "hidden" }, style]}
        glassEffectStyle="clear"
        tintColor={GOLD_GLASS_TINT}
        isInteractive
      >
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView intensity={32} tint="dark" style={[{ overflow: "hidden" }, style]}>
      <LinearGradient
        colors={GOLD_METALLIC}
        locations={GOLD_METALLIC_LOCATIONS}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        // Solid-gold fallback so the button stays visible if the gradient ever fails to render.
        style={[{ backgroundColor: "#bf9b30" }, StyleSheet.absoluteFill]}
      />
      {children}
    </BlurView>
  );
}
