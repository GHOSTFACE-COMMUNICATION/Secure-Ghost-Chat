import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GhostCoin } from "@/components/GhostCoin";
import { PanicButton } from "@/components/PanicButton";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { useApp } from "@/context/AppContext";

const BG = "#000";

const FONT_SERIF = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia",
});
const FONT_MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

type IconName = keyof typeof Ionicons.glyphMap;

// ── Radial menu geometry ──────────────────────────────────────────────────────
const ORBIT_SIZE = 340;
const ORBIT_CENTER = ORBIT_SIZE / 2;
const ORBIT_RADIUS = 134;
const NODE = 60;

type NavNode = {
  icon: IconName;
  label: string;
  onPress: () => void;
  activeKey?: "vpn";
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { alias, vpnConnected, panicWipe } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [coinActive, setCoinActive] = useState(true);
  const [coinHeld, setCoinHeld] = useState(false);
  const [coinSpinDurationMs, setCoinSpinDurationMs] = useState(9000);
  // Distinguishes a quick tap (speed burst) from a hold that reveals the
  // menu (onPressIn fires for both — this flags which one actually happened
  // by the time onPressOut runs).
  const longPressFiredRef = useRef(false);
  const boostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const spin = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;
  const hintPulse = useRef(new Animated.Value(1)).current;

  // Gated by screen focus so nothing churns battery while this tab is off-screen.
  useFocusEffect(
    useCallback(() => {
      setCoinActive(true);
      const spinLoop = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: 26000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      const glowLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(glowPulse, {
            toValue: 1,
            duration: 2200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(glowPulse, {
            toValue: 0,
            duration: 2200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      // "HOLD TO REVEAL" hint blinks out and back in on a steady 5s cycle
      // to keep drawing the eye without being permanently distracting.
      const hintLoop = Animated.loop(
        Animated.sequence([
          Animated.delay(3900),
          Animated.timing(hintPulse, {
            toValue: 0,
            duration: 400,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(300),
          Animated.timing(hintPulse, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      spinLoop.start();
      glowLoop.start();
      hintLoop.start();
      return () => {
        spinLoop.stop();
        glowLoop.stop();
        hintLoop.stop();
        setCoinActive(false);
      };
    }, [spin, glowPulse, hintPulse]),
  );

  // Reveal/hide the orbiting menu when the central circle is long-pressed.
  useEffect(() => {
    Animated.timing(reveal, {
      toValue: menuOpen ? 1 : 0,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [menuOpen, reveal]);

  const handlePanicWipe = async () => {
    await panicWipe();
    // Navigation handled automatically — panicWipe sets isOnboarded: false
  };

  const go = (path: () => void) => () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    path();
  };

  const toggleMenu = () => {
    longPressFiredRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenuOpen((open) => !open);
  };

  // Touch down: pause the spin immediately — covers both "hold to stop" and
  // the lead-up to a long-press menu reveal, since onLongPress can't fire
  // without onPressIn firing first anyway.
  const handleCoinPressIn = () => {
    longPressFiredRef.current = false;
    setCoinHeld(true);
  };

  // Release: only treat it as a "tap" (speed burst) if the hold never
  // crossed the long-press threshold — otherwise this release is just the
  // end of an already-handled menu-reveal hold.
  const handleCoinPressOut = () => {
    setCoinHeld(false);
    if (longPressFiredRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
    setCoinSpinDurationMs(2200);
    boostTimerRef.current = setTimeout(() => setCoinSpinDurationMs(9000), 2500);
  };

  useEffect(() => {
    return () => {
      if (boostTimerRef.current) clearTimeout(boostTimerRef.current);
    };
  }, []);

  const aliasText = (alias ?? "GHOST_00").toUpperCase();

  const nodes: NavNode[] = [
    {
      icon: "chatbubble-ellipses-outline",
      label: "MSG",
      onPress: go(() => router.push("/(tabs)/messages")),
    },
    {
      icon: "call-outline",
      label: "CALL",
      onPress: go(() =>
        router.push({
          pathname: "/call",
          params: { alias: "SECURE_LINE", mode: "voice" },
        }),
      ),
    },
    {
      icon: "shield-outline",
      label: vpnConnected ? "VPN ON" : "VPN",
      activeKey: "vpn",
      onPress: go(() => router.push("/(tabs)/vpn")),
    },
    {
      icon: "wallet-outline",
      label: "WALLET",
      onPress: go(() => router.push("/(tabs)/wallet")),
    },
    {
      icon: "phone-portrait-outline",
      label: "NUMBER",
      onPress: go(() => router.push("/(tabs)/ghostnumber")),
    },
    {
      icon: "settings-outline",
      label: "SETTINGS",
      onPress: go(() => router.push("/(tabs)/settings")),
    },
  ];

  const spinDeg = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const glowOpacity = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.05, 0.2],
  });
  const glowScale = glowPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.07],
  });
  const nodeScale = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });
  const ringOpacity = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const hintOpacity = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });
  const hintFinalOpacity = Animated.multiply(hintOpacity, hintPulse);

  return (
    <TabScreenWrapper>
      <View style={styles.container}>
        {/* Alias header */}
        <View pointerEvents="none" style={[styles.header, { top: insets.top + 18 }]}>
          <Text style={styles.aliasText}>{aliasText}</Text>
          <View style={styles.aliasDivider} />
          <Text style={styles.aliasTagline}>SECURE IDENTITY</Text>
        </View>

        {/* Radial dial: long-press the transparent circle to reveal the menu */}
        <View style={styles.orbitWrap}>
          <View style={styles.orbit}>
            {/* Decorative tick ring — fades in with the menu */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ring,
                { opacity: ringOpacity, transform: [{ rotate: spinDeg }] },
              ]}
            >
              {Array.from({ length: 12 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.tick,
                    {
                      transform: [
                        { rotate: `${i * 30}deg` },
                        { translateY: -(ORBIT_RADIUS - 4) },
                      ],
                    },
                  ]}
                />
              ))}
            </Animated.View>

            {/* Rotating compass emblem — long-press to reveal/hide menu */}
            <View pointerEvents="box-none" style={styles.centerWrap}>
              <View style={styles.centerCol}>
                <Pressable
                  onPressIn={handleCoinPressIn}
                  onPressOut={handleCoinPressOut}
                  onLongPress={toggleMenu}
                  delayLongPress={350}
                  hitSlop={24}
                  style={styles.centerHit}
                  accessibilityRole="button"
                  accessibilityLabel={
                    menuOpen
                      ? "Hide menu"
                      : "Tap to spin faster, hold to stop or reveal menu"
                  }
                >
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.globeGlowInner,
                      { opacity: glowOpacity, transform: [{ scale: glowScale }] },
                    ]}
                  />
                  <View style={styles.centerEmblem}>
                    <GhostCoin
                      size={184}
                      active={coinActive && !coinHeld}
                      spinDurationMs={coinSpinDurationMs}
                    />
                  </View>
                </Pressable>
                <Animated.Text
                  pointerEvents="none"
                  style={[styles.centerHint, { opacity: hintFinalOpacity }]}
                >
                  HOLD TO REVEAL
                </Animated.Text>
              </View>
            </View>

            {/* Orbiting nav nodes — hidden until revealed */}
            {nodes.map((node, i) => {
              const angle = (-90 + i * (360 / nodes.length)) * (Math.PI / 180);
              const x = ORBIT_CENTER + ORBIT_RADIUS * Math.cos(angle) - NODE / 2;
              const y = ORBIT_CENTER + ORBIT_RADIUS * Math.sin(angle) - NODE / 2;
              const active = node.activeKey === "vpn" && !!vpnConnected;
              return (
                <Animated.View
                  key={node.label}
                  pointerEvents={menuOpen ? "auto" : "none"}
                  style={[
                    styles.node,
                    {
                      left: x,
                      top: y,
                      opacity: reveal,
                      transform: [{ scale: nodeScale }],
                    },
                  ]}
                >
                  <Pressable
                    onPress={node.onPress}
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.nodeInner,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View
                      style={[
                        styles.nodeCircle,
                        active && styles.nodeCircleActive,
                      ]}
                    >
                      <Ionicons
                        name={node.icon}
                        size={20}
                        color={active ? "#FFFFFF" : "rgba(255,255,255,0.75)"}
                      />
                    </View>
                    <Text
                      style={[styles.nodeLabel, active && styles.nodeLabelActive]}
                    >
                      {node.label}
                    </Text>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        </View>

        {/* Panic wipe — below globe, same button as Settings, at half size here */}
        <View style={styles.panicWrap}>
          <PanicButton onWipe={handlePanicWipe} scale={0.5} />
        </View>
      </View>
    </TabScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // Alias header
  header: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  aliasText: {
    fontFamily: FONT_SERIF,
    fontSize: 20,
    letterSpacing: 8,
    fontWeight: "400" as const,
    color: "rgba(191,155,48,0.78)",
  },
  aliasDivider: {
    width: 32,
    height: 1,
    marginVertical: 12,
    backgroundColor: "rgba(191,155,48,0.3)",
  },
  aliasTagline: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 5,
    color: "rgba(191,155,48,0.5)",
  },

  // Radial dial
  orbitWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  orbit: {
    width: ORBIT_SIZE,
    height: ORBIT_SIZE,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  tick: {
    position: "absolute",
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: "rgba(191,155,48,0.4)",
  },

  // Central rotating compass emblem
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  centerCol: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerHit: {
    width: 184,
    height: 184,
    alignItems: "center",
    justifyContent: "center",
  },
  centerEmblem: {
    width: 184,
    height: 184,
  },
  globeGlowInner: {
    position: "absolute",
    width: 196,
    height: 196,
    top: (184 - 196) / 2,
    left: (184 - 196) / 2,
    borderRadius: 98,
    backgroundColor: "rgba(245,200,80,0.05)",
    borderWidth: 1,
    borderColor: "rgba(191,155,48,0.22)",
  },
  centerHint: {
    position: "absolute",
    bottom: -26,
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 4,
    color: "rgba(191,155,48,0.6)",
  },

  panicWrap: {
    position: "absolute",
    bottom: 100,
    left: 24,
    right: 24,
  },

  // Nav nodes
  node: {
    position: "absolute",
    width: NODE,
    alignItems: "center",
  },
  nodeInner: { alignItems: "center", gap: 6 },
  nodeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  nodeCircleActive: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderColor: "rgba(255,255,255,0.6)",
  },
  nodeLabel: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 2,
    color: "rgba(255,255,255,0.78)",
  },
  nodeLabelActive: { color: "#ffffff" },
});
