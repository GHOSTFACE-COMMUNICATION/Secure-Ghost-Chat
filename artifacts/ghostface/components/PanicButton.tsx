import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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
import { GoldGradient } from "@/components/GoldGradient";
import { useColors } from "@/hooks/useColors";
import { type } from "@/constants/typography";

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
          backgroundColor: "#F5D26B",
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
        <Ionicons name="nuclear" size={44} color="#FF3B30" allowFontScaling={false} />
        <Text style={ss.wipedHeading}>DATA WIPED</Text>
        <Text style={ss.wipedSub}>ALL TRACES ELIMINATED</Text>
      </Animated.View>
    </View>
  );
}

const ss = StyleSheet.create({
  wipedHeading: {
    ...type.display,
    fontSize: 24,
    letterSpacing: 2,
    color: "#FF3B30",
    marginTop: 18,
  },
  wipedSub: {
    ...type.caption,
    fontSize: 11,
    letterSpacing: 1.5,
    color: "#FF3B30",
    opacity: 0.7,
    marginTop: 6,
  },
});

// ─── Main PanicButton ──────────────────────────────────────────────────────────

interface PanicButtonProps {
  onWipe: () => Promise<void>;
  /** Uniform size multiplier for width/padding/icon/text. Defaults to 1 (full size). */
  scale?: number;
}

export function PanicButton({ onWipe, scale = 1 }: PanicButtonProps) {
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

      <View style={{ width: `${scale * 100}%`, alignSelf: "center" }}>
        <Text
          style={[
            styles.label,
            { color: colors.mutedForeground, fontSize: 10 * scale, marginBottom: 12 * scale },
          ]}
        >
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
          {/* Glass surface, but the icon and label stay destructive-red — the
              action is irreversible, so the danger signal has to survive the
              restyle. Same treatment as DELETE SEALED CONVERSATION in
              app/chat/[id].tsx; colour lives in the content, never in the
              surface or the rim (see GoldGradient).
              `solid` because on the settings screen this sits on a flat
              #000000 backdrop with nothing behind it to refract — clear glass
              over black renders as black. See GLASS_SOLID_FILL. */}
          <GoldGradient
            solid
            style={[
              styles.btn,
              { borderRadius: colors.radius, paddingVertical: 17 * scale, gap: 12 * scale },
            ]}
          >
            {panicHeld && (
              <View
                style={[styles.progressFill, { width: `${panicProgress}%` }]}
              />
            )}
            <Ionicons
              name="nuclear-outline"
              size={22 * scale}
              color={colors.destructive}
              allowFontScaling={false}
            />
            <Text
              style={[
                styles.btnText,
                { fontSize: 15 * scale, letterSpacing: 2 * scale, color: colors.destructive },
              ]}
            >
              {panicHeld ? "WIPING..." : "SELF DESTRUCT"}
            </Text>
          </GoldGradient>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    ...type.label,
    fontSize: 10,
    marginBottom: 12,
    textAlign: "center",
  },
  // Just the hit area now. The full-opacity white border and red glow this
  // used to carry belonged to the old solid-red button; layered outside glass
  // they read as a double rim and a coloured leak — precisely the "painted
  // plastic imitating glass" look GoldGradient exists to avoid. The rim is
  // now GoldGradient's own neutral one.
  btnWrap: {
    overflow: "hidden",
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
    // Was rgba(255,255,255,0.22), tuned against the old saturated-red fill.
    // Over GLASS_TINT_BLACK that washes out, and this sweep is the only
    // feedback that the 3-second hold is progressing — so it goes red, which
    // also puts the danger colour back exactly when it matters most.
    backgroundColor: "rgba(255,59,48,0.32)",
  },
  btnText: {
    ...type.labelStrong,
    fontSize: 15,
    letterSpacing: 2,
    color: "#ffffff",
  },
});
