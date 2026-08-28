import * as Haptics from "expo-haptics";
import React, { useRef } from "react";
import { Animated, Easing, Image, PanResponder, View } from "react-native";

import { boxShadow } from "@/lib/shadow";

interface GhostLogoProps {
  size?: number;
  color?: string;
  /** Render as a metallic coin (silver rim + disc face + edge band that flashes
   *  when edge-on) that you TAP to flip, matching the home-screen radial coin.
   *  When false (default) it's the flat gold trademark mark. */
  coin?: boolean;
  /** Called when the coin is tapped (coin mode) — e.g. to trigger a reward reveal. */
  onTap?: () => void;
}

export function GhostLogo({ size = 64, coin = false, onTap }: GhostLogoProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const spin = useRef(new Animated.Value(0)).current;
  // Accumulated rotation in full turns; each tap adds more and eases out.
  const spinTargetRef = useRef(0);

  const flip = () => {
    spinTargetRef.current += 3; // three full turns per tap, ends face-front
    Animated.timing(spin, {
      toValue: spinTargetRef.current,
      duration: 1600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (coin) { flip(); onTap?.(); }
        Animated.spring(scale, {
          toValue: 1.06,
          useNativeDriver: true,
          speed: 30,
          bounciness: 8,
        }).start();
      },

      onPanResponderRelease: () => {
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 20,
          bounciness: 4,
        }).start();
      },

      onPanResponderTerminate: () => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 0 }).start();
      },
    })
  ).current;

  // extend so accumulated turns keep rotating past 360°
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"], extrapolate: "extend" });

  if (coin) {
    // Edge band peaks near the edge-on angles (every 90° / 270° of each turn).
    const edgeOpacity = spin.interpolate({
      inputRange: [0, 0.25, 0.5, 0.75, 1],
      outputRange: [0, 1, 0, 1, 0],
      extrapolate: "extend",
    });
    const rim = size * 0.017;
    const face = size - rim * 2;
    const band = Math.max(8, size * 0.084);
    // Thin sparkling diamond edge: fine high-contrast facets with a brighter
    // glint every few facets — the sparkle carries it, not thickness.
    const facetCount = 84;
    const facetR = size / 2 - rim / 2;
    const facetW = Math.max(2, size * 0.014);
    const facetH = rim * 1.7;

    return (
      <Animated.View
        style={{
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
          opacity,
          transform: [{ scale }],
        }}
        {...panResponder.panHandlers}
      >
        {/* fake thickness: edge band flashes when edge-on */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: band,
            height: size,
            borderRadius: band / 2,
            backgroundColor: "#8a8a92",
            alignItems: "center",
            justifyContent: "center",
            opacity: edgeOpacity,
            boxShadow: [boxShadow("#FFFFFF", 0.5, 14), "inset 0 0 4px rgba(20,20,24,0.7)"].join(", "),
          }}
        >
          <View style={{ width: Math.max(2, band * 0.25), height: face, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.85)" }} />
        </Animated.View>

        {/* the coin: metallic rim + disc face */}
        <Animated.View
          pointerEvents="none"
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            padding: rim,
            backgroundColor: "#dfe1e6",
            borderWidth: Math.max(1, size * 0.006),
            borderColor: "rgba(255,255,255,0.92)",
            alignItems: "center",
            justifyContent: "center",
            transform: [{ perspective: 800 }, { rotateY: rotate }],
            boxShadow: [
              boxShadow("#FFFFFF", 0.5, 20),
              "inset 0 2px 5px rgba(255,255,255,0.95)",
              "inset 0 -6px 12px rgba(14,14,18,0.7)",
            ].join(", "),
          }}
        >
          <Image
            source={require("../assets/images/ghostface-logo.jpeg")}
            resizeMode="cover"
            style={{ width: face, height: face, borderRadius: face / 2 }}
          />
          {/* diamond-cut milled edge */}
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            {Array.from({ length: facetCount }).map((_, i) => {
              const glint = i % 4 === 0; // frequent gemstone sparkle points
              const bright = i % 2 === 0;
              return (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    top: size / 2 - facetH / 2,
                    left: size / 2 - facetW / 2,
                    width: glint ? facetW * 1.25 : facetW,
                    height: glint ? facetH * 1.7 : facetH,
                    borderRadius: facetW,
                    backgroundColor: glint ? "#ffffff" : bright ? "#f4f6fb" : "#1c1c26",
                    boxShadow: glint
                      ? [boxShadow("#FFFFFF", 1, 7), boxShadow("#FFFFFF", 0.8, 3)].join(", ")
                      : undefined,
                    transform: [{ rotate: `${(360 / facetCount) * i}deg` }, { translateY: -facetR }],
                  }}
                />
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    );
  }

  // Default: the flat gold trademark mark (static), with a touch bounce.
  return (
    <Animated.Image
      source={require("../assets/images/ghostface-mark-gold.webp")}
      style={{ width: size, height: size, opacity, transform: [{ scale }] }}
      resizeMode="contain"
      {...panResponder.panHandlers}
    />
  );
}
