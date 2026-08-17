import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { boxShadow } from "@/lib/shadow";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const SIZE = 40;
// Cool cyan-blue tint for the glass effect — distinct from the app's gold
// accent, which stays reserved for primary actions elsewhere.
const GLASS_TINT = "rgba(94,200,255,0.32)";

interface GlassCallButtonProps {
  icon: IoniconName;
  onPress: () => void;
  iconColor?: string;
  testID?: string;
  accessibilityLabel?: string;
}

// Uses real native Liquid Glass (iOS 26+, via expo-glass-effect) where
// available. Older iOS/Android fall back to the hand-rolled BlurView +
// gradient approximation this component used before — same cool-blue tint
// so the two paths read as the same design.
const useNativeGlass = isLiquidGlassAvailable();

export function GlassCallButton({
  icon,
  onPress,
  iconColor = "rgba(255,255,255,0.92)",
  testID,
  accessibilityLabel,
}: GlassCallButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
    >
      <View style={styles.shadow}>
        {useNativeGlass ? (
          <GlassView
            style={styles.glassCircle}
            glassEffectStyle="clear"
            tintColor={GLASS_TINT}
            isInteractive
          >
            <Ionicons name={icon} size={18} color={iconColor} />
          </GlassView>
        ) : (
          <View style={styles.circle}>
            <BlurView intensity={32} tint="dark" style={StyleSheet.absoluteFill} />
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(120,195,255,0.45)", "rgba(94,170,230,0.12)", "rgba(80,150,210,0.04)"]}
              locations={[0, 0.55, 1]}
              start={{ x: 0.15, y: 0 }}
              end={{ x: 0.85, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={styles.rim} />
            <Ionicons name={icon} size={18} color={iconColor} />
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: SIZE / 2,
    boxShadow: boxShadow("#000000", 0.35, 10, 0, 4),
  },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    overflow: "hidden",
  },
  // No manual background/border here — GlassView renders its own native
  // blur and refraction, so layering the fallback's flat tint underneath
  // would just mute it.
  glassCircle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    borderColor: "rgba(150,210,255,0.35)",
  },
});
