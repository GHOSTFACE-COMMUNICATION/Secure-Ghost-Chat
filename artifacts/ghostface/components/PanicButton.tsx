import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { boxShadow } from "@/lib/shadow";

const { width: W, height: H } = Dimensions.get("window");

// ─── Expanding smoke ring ──────────────────────────────────────────────────────

function SmokeRing({
  delay,
  maxScale,
  color,
  size,
  duration,
}: {
  delay: number;
  maxScale: number;
  color: string;
  size: number;
  duration: number;
}) {
  const scale = useRef(new Animated.Value(0.05)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(scale, {
          toValue: maxScale,
          duration,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.55, duration: 400, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: duration - 400, useNativeDriver: true }),
        ]),
      ]).start();
    }, delay);
    return () => clearTimeout(t);
  }, []);

  return (
    <Animated.View
      style={{
        position: "absolute",
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

// ─── Ghost wipe screen ────────────────────────────────────────────────────────

function GhostWipeScreen({ onDone }: { onDone: () => void }) {
  const ghostOpacity = useRef(new Animated.Value(0)).current;
  const ghostScale = useRef(new Animated.Value(0.6)).current;
  const ghostGlow = useRef(new Animated.Value(0)).current;
  const bgOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Ghost materialises
    Animated.parallel([
      Animated.sequence([
        Animated.timing(ghostOpacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(ghostOpacity, { toValue: 0.6, duration: 1000, useNativeDriver: true }),
        Animated.timing(ghostOpacity, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
      Animated.timing(ghostScale, {
        toValue: 2.8,
        duration: 2500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      // Ghostly glow pulse
      Animated.loop(
        Animated.sequence([
          Animated.timing(ghostGlow, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(ghostGlow, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        ]),
        { iterations: 3 }
      ),
    ]).start();

    // Dark smoke fills screen after ghost swells
    setTimeout(() => {
      Animated.timing(bgOpacity, {
        toValue: 1,
        duration: 1800,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start();
    }, 1200);

    // "DATA WIPED" text
    setTimeout(() => {
      Animated.timing(textOpacity, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    }, 2400);

    const t = setTimeout(onDone, 3600);
    return () => clearTimeout(t);
  }, []);

  // Smoke rings — staggered waves radiating from ghost
  const RINGS = [
    { delay: 200,  maxScale: 6,  color: "rgba(10,10,15,0.75)",  size: 120, duration: 2200 },
    { delay: 450,  maxScale: 8,  color: "rgba(8,8,12,0.70)",    size: 160, duration: 2400 },
    { delay: 700,  maxScale: 10, color: "rgba(6,6,10,0.80)",    size: 100, duration: 2600 },
    { delay: 950,  maxScale: 7,  color: "rgba(12,12,18,0.65)",  size: 180, duration: 2200 },
    { delay: 1200, maxScale: 9,  color: "rgba(8,8,14,0.75)",    size: 140, duration: 2400 },
    { delay: 1450, maxScale: 11, color: "rgba(5,5,10,0.85)",    size: 120, duration: 2600 },
    { delay: 300,  maxScale: 5,  color: "rgba(15,15,22,0.60)",  size: 200, duration: 2000 },
    { delay: 600,  maxScale: 8,  color: "rgba(10,10,16,0.70)",  size: 150, duration: 2300 },
  ];

  const glowOpacity = ghostGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.25],
  });

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Smoke rings origin: center of screen */}
      <View style={{ position: "absolute", top: H * 0.42, left: W / 2 }}>
        {RINGS.map((r, i) => (
          <SmokeRing key={i} {...r} />
        ))}
      </View>

      {/* Ghost glow aura */}
      <Animated.View
        style={{
          position: "absolute",
          top: H * 0.42 - 130,
          left: W / 2 - 130,
          width: 260,
          height: 260,
          borderRadius: 130,
          backgroundColor: "#bf9b30",
          opacity: glowOpacity,
          transform: [{ scale: ghostScale }],
        }}
      />

      {/* Ghost logo */}
      <Animated.Image
        source={require("../assets/images/ghostlogo.png")}
        style={{
          position: "absolute",
          top: H * 0.42 - 70,
          left: W / 2 - 70,
          width: 140,
          height: 140,
          borderRadius: 25,
          opacity: ghostOpacity,
          transform: [{ scale: ghostScale }],
        }}
        resizeMode="contain"
      />

      {/* Dark smoke fill */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "#000008", opacity: bgOpacity },
        ]}
      />

      {/* DATA WIPED */}
      <Animated.View
        style={{
          ...StyleSheet.absoluteFillObject,
          alignItems: "center",
          justifyContent: "center",
          opacity: textOpacity,
        }}
      >
        <Ionicons name="nuclear" size={44} color="#FF3B30" />
        <Text style={ss.wipedHeading}>DATA WIPED</Text>
        <Text style={ss.wipedSub}>ALL TRACES ELIMINATED</Text>
      </Animated.View>
    </View>
  );
}

const ss = StyleSheet.create({
  wipedHeading: {
    color: "#FF3B30",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 8,
    marginTop: 18,
  },
  wipedSub: {
    color: "#FF3B30",
    fontSize: 11,
    letterSpacing: 4,
    opacity: 0.7,
    marginTop: 6,
  },
});

// ─── Main PanicButton ──────────────────────────────────────────────────────────

interface PanicButtonProps {
  onWipe: () => Promise<void>;
}

export function PanicButton({ onWipe }: PanicButtonProps) {
  const colors = useColors();
  const [panicHeld, setPanicHeld] = useState(false);
  const [panicProgress, setPanicProgress] = useState(0);
  const [ghostWipe, setGhostWipe] = useState(false);
  const panicTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panicInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    if (panicTimer.current) { clearTimeout(panicTimer.current); panicTimer.current = null; }
    if (panicInterval.current) { clearInterval(panicInterval.current); panicInterval.current = null; }
  };

  useEffect(() => () => clearTimers(), []);

  const startPanic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setPanicHeld(true);
    setPanicProgress(0);
    let p = 0;
    panicInterval.current = setInterval(() => {
      p += 2;
      setPanicProgress(p);
      if (p >= 100) {
        clearInterval(panicInterval.current!);
        panicInterval.current = null;
      }
    }, 60);
    panicTimer.current = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setGhostWipe(true);
    }, 3000);
  };

  const cancelPanic = () => {
    setPanicHeld(false);
    setPanicProgress(0);
    clearTimers();
  };

  return (
    <>
      <Modal visible={ghostWipe} transparent animationType="none" statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: "#000008" }}>
          <GhostWipeScreen onDone={async () => { await onWipe(); }} />
        </View>
      </Modal>

      <View>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          HOLD 3 SECONDS TO WIPE ALL DATA
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.btnWrap,
            { borderRadius: colors.radius },
            pressed && { opacity: 0.9 },
          ]}
          onPressIn={startPanic}
          onPressOut={cancelPanic}
          testID="panic-btn"
        >
          <LinearGradient
            colors={["#ff6b6b", "#ef4444", "#b91c1c", "#7f1d1d"]}
            locations={[0, 0.45, 0.75, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[styles.btn, { borderRadius: colors.radius }]}
          >
            {panicHeld && (
              <View
                style={[styles.progressFill, { width: `${panicProgress}%` }]}
              />
            )}
            <Ionicons name="nuclear-outline" size={22} color="#ffffff" />
            <Text style={styles.btnText}>
              {panicHeld ? "WIPING..." : "PANIC WIPE"}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    letterSpacing: 3,
    marginBottom: 12,
    textAlign: "center",
  },
  btnWrap: {
    borderWidth: 1,
    borderColor: "#ffffff",
    boxShadow: boxShadow("#ef4444", 0.45, 16, 0, 4),
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 17,
    overflow: "hidden",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  btnText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800" as const,
    letterSpacing: 5,
  },
});
