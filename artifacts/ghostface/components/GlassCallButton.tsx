import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { boxShadow } from "@/lib/shadow";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const SIZE = 40;

interface GlassCallButtonProps {
  icon: IoniconName;
  onPress: () => void;
  iconColor?: string;
  testID?: string;
  accessibilityLabel?: string;
}

// Same liquid-glass recipe as the home-screen radial menu nodes
// (app/(tabs)/index.tsx nodeCircle*) — BlurView + specular gradient + rim +
// shadow — sized for a paired icon button instead of a labeled orbit node.
export function GlassCallButton({
  icon,
  onPress,
  iconColor = "rgba(255,255,255,0.88)",
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
        <View style={styles.circle}>
          <BlurView intensity={32} tint="dark" style={StyleSheet.absoluteFill} />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(255,255,255,0.45)", "rgba(255,255,255,0.08)", "rgba(255,255,255,0.02)"]}
            locations={[0, 0.55, 1]}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.rim} />
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
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
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: SIZE / 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
});
