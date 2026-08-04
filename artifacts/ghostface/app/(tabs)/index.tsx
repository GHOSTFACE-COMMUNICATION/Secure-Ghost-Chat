import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { useApp } from "@/context/AppContext";
import { boxShadow } from "@/lib/shadow";

const BG = "#000";
const GOLD = "#bf9b30";
const RED = "#dc2626";

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

// ── Coin physics ──────────────────────────────────────────────────────────────
const CYCLE = 5200; // ms per full spin-slow-fall cycle
// Tap-spin impulse tuning: one tap ≈ a quick flick; 4–5 fast taps hit the cap
// for a fast whirl; the 0.18^dt decay in the frame loop winds it down within
// ~2 s (half-life ≈ 0.4 s).
const TAP_KICK_DEG_S = 900; // deg/s added per tap
const MAX_BOOST_DEG_S = 4000; // cap on stacked boost velocity
// Motion blur ramps in between these boost velocities (deg/s). Below the
// start the face stays crisp; at the end the pre-blurred face fully covers
// the crisp one so top-speed spins read as a whirl, not a strobing logo.
const BLUR_START_DEG_S = 1400;
const BLUR_FULL_DEG_S = 3200;
// Haptic spin buzz: light ticks whose rate ramps with boost velocity so fast
// tap-spins feel physical. Below the start threshold there are no ticks, so
// the idle spin cycle stays silent. Interval shrinks from SLOW→FAST as the
// boost approaches the cap. No-op on web (expo-haptics has no web impl).
const HAPTIC_START_DEG_S = 700;
const HAPTIC_SLOW_INTERVAL_MS = 220;
const HAPTIC_FAST_INTERVAL_MS = 60;
const FAST_END = 0.3;
const SLOW_END = 0.68;
const FALL_END = 0.88;

function easeIn3(t: number) { return t * t * t; }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function coinPhysics(ms: number): { rotY: number; tiltX: number; scaleX: number } {
  const t = (ms % CYCLE) / CYCLE;
  if (t < FAST_END) {
    return { rotY: (t / FAST_END) * 1800, tiltX: 0, scaleX: 1 };
  }
  if (t < SLOW_END) {
    const p = easeIn3((t - FAST_END) / (SLOW_END - FAST_END));
    return { rotY: 1800 + p * 720, tiltX: lerp(0, 62, p), scaleX: 1 };
  }
  if (t < FALL_END) {
    const p = (t - SLOW_END) / (FALL_END - SLOW_END);
    const ep = easeIn3(p);
    const wobble = lerp(6, 2, ep) * Math.sin(p * Math.PI * 14);
    return {
      rotY: 2520 + p * 180,
      tiltX: lerp(62, 86, ep) + wobble,
      scaleX: lerp(1, 0.15, 1 - Math.pow(1 - p, 3)),
    };
  }
  return { rotY: 2700, tiltX: 88, scaleX: 0.08 };
}

type NavNode = {
  icon: IconName;
  label: string;
  onPress: () => void;
  activeKey?: "vpn";
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { alias, vpnConnected, panicWipe } = useApp();
  const [wipeArmed, setWipeArmed] = useState(false);
  const [isWiping, setIsWiping] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const wipeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wipeFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Decorative ring spin
  const spin = useRef(new Animated.Value(0)).current;
  // Coin physics values — driven by rAF, not Animated.timing
  const coinRotY = useRef(new Animated.Value(0)).current;
  const coinTiltX = useRef(new Animated.Value(0)).current;
  const coinScaleX = useRef(new Animated.Value(1)).current;
  const coinGlow = useRef(new Animated.Value(0.6)).current;
  // 0..1 — how edge-on the coin is; drives the fake "thickness" rim band
  const coinEdge = useRef(new Animated.Value(0)).current;
  // 0..1 — motion-blur mix; crossfades a pre-blurred face over the crisp one
  const coinBlur = useRef(new Animated.Value(0)).current;
  // Tap-to-spin impulse (deg/s), decays exponentially each frame
  const boostVel = useRef(0);
  const boostDeg = useRef(0);
  const lastFrameMs = useRef(0);
  // Timestamp of the last spin-haptic tick (performance.now() ms)
  const lastHapticMs = useRef(0);

  const fade = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const wipeAnim = useRef(new Animated.Value(0)).current;
  const rafRef = useRef<number>(0);

  // Decorative ring + breathing fade — gated on screen focus
  useFocusEffect(
    useCallback(() => {
      const spinLoop = Animated.loop(
        Animated.timing(spin, {
          toValue: 1,
          duration: 26000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      const fadeLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(fade, {
            toValue: 1,
            duration: 2600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(fade, {
            toValue: 0,
            duration: 3200,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      spinLoop.start();
      fadeLoop.start();
      return () => {
        spinLoop.stop();
        fadeLoop.stop();
      };
    }, [spin, fade]),
  );

  // Coin physics loop — runs on JS thread, drives Animated.Values via setValue
  useEffect(() => {
    const startMs = performance.now();
    function frame(now: number) {
      const dt = lastFrameMs.current
        ? Math.min((now - lastFrameMs.current) / 1000, 0.05)
        : 0;
      lastFrameMs.current = now;
      // Integrate tap-spin impulse with exponential decay
      if (boostVel.current > 1) {
        boostDeg.current += boostVel.current * dt;
        boostVel.current *= Math.pow(0.18, dt);
      } else {
        boostVel.current = 0;
      }
      const phys = coinPhysics(now - startMs);
      // While the tap boost is strong, let it dominate: pull the coin toward
      // an upright, full-width spin so the boost never fights the fall phase.
      const boostMix = Math.min(boostVel.current / 1200, 1);
      const tiltX = lerp(phys.tiltX, 0, boostMix);
      const scaleX = lerp(phys.scaleX, 1, boostMix);
      const totalRotY = (phys.rotY + boostDeg.current) % 360;
      coinRotY.setValue(totalRotY);
      coinTiltX.setValue(tiltX);
      coinScaleX.setValue(scaleX);
      coinGlow.setValue(scaleX > 0.5 ? 0.65 : 0.2);
      // Edge band peaks when the face is edge-on; fades out as the coin
      // flattens into its fall phase so it never floats over the "puddle".
      const edgeOn = Math.pow(Math.abs(Math.sin((totalRotY * Math.PI) / 180)), 3);
      const flatFade = Math.max(0, Math.min(1, (scaleX - 0.3) / 0.7));
      coinEdge.setValue(edgeOn * flatFade);
      // Motion blur: ramp with boost velocity, smoothstep-shaped so it eases
      // in near top speed and fades out smoothly as the boost decays.
      const blurT = Math.max(
        0,
        Math.min(
          1,
          (boostVel.current - BLUR_START_DEG_S) /
            (BLUR_FULL_DEG_S - BLUR_START_DEG_S),
        ),
      );
      coinBlur.setValue(blurT * blurT * (3 - 2 * blurT));
      // Haptic buzz: tick rate ramps with boost velocity. Only fires while a
      // tap boost is active (never during the idle spin cycle) and no-ops on
      // web where expo-haptics has no implementation.
      if (Platform.OS !== "web" && boostVel.current > HAPTIC_START_DEG_S) {
        const speedT = Math.min(
          (boostVel.current - HAPTIC_START_DEG_S) /
            (MAX_BOOST_DEG_S - HAPTIC_START_DEG_S),
          1,
        );
        const interval = lerp(
          HAPTIC_SLOW_INTERVAL_MS,
          HAPTIC_FAST_INTERVAL_MS,
          speedT,
        );
        if (now - lastHapticMs.current >= interval) {
          lastHapticMs.current = now;
          Haptics.impactAsync(
            speedT > 0.6
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light,
          ).catch(() => {});
        }
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Reveal/hide orbiting menu on tap
  useEffect(() => {
    Animated.timing(reveal, {
      toValue: menuOpen ? 1 : 0,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [menuOpen, reveal]);

  useEffect(() => {
    Animated.timing(wipeAnim, {
      toValue: wipeArmed || isWiping ? 1 : 0,
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [wipeArmed, isWiping, wipeAnim]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (wipeTimer.current) clearTimeout(wipeTimer.current);
      if (wipeFeedbackTimer.current) clearTimeout(wipeFeedbackTimer.current);
    };
  }, []);

  // Panic-wipe gesture — silent: no haptics, no audio, no toast, no alert.
  const handleWipePressIn = () => {
    if (isWiping) return;
    setWipeArmed(true);
    if (wipeTimer.current) clearTimeout(wipeTimer.current);
    wipeTimer.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      setIsWiping(true);
      setWipeArmed(false);
      try {
        await panicWipe();
      } catch {
        // swallow — silent
      }
      if (!mountedRef.current) return;
      if (wipeFeedbackTimer.current) clearTimeout(wipeFeedbackTimer.current);
      wipeFeedbackTimer.current = setTimeout(() => {
        if (mountedRef.current) setIsWiping(false);
      }, 1500);
    }, 3000);
  };

  const handleWipePressOut = () => {
    if (wipeTimer.current) clearTimeout(wipeTimer.current);
    if (!isWiping) setWipeArmed(false);
  };

  const go = (path: () => void) => () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    path();
  };

  const toggleMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Tap-spin kick: stacks across rapid taps, capped so mashing can't
    // spin the coin absurdly fast or break edge-band/glow visuals.
    boostVel.current = Math.min(boostVel.current + TAP_KICK_DEG_S, MAX_BOOST_DEG_S);
    setMenuOpen((open) => !open);
  };

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
  const circleOpacity = fade.interpolate({
    inputRange: [0, 1],
    outputRange: [0.82, 1],
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

  // Coin transform — driven by physics rAF loop via setValue
  const coinTransform = [
    { perspective: 800 },
    {
      rotateX: coinTiltX.interpolate({
        inputRange: [0, 90],
        outputRange: ["0deg", "90deg"],
        extrapolate: "clamp",
      }),
    },
    {
      rotateY: coinRotY.interpolate({
        inputRange: [0, 360],
        outputRange: ["0deg", "360deg"],
        extrapolate: "clamp",
      }),
    },
    { scaleX: coinScaleX },
  ];

  return (
    <TabScreenWrapper>
      <View style={styles.container}>
        {/* Panic-wipe seal — top-right, tiny, silent */}
        <View
          pointerEvents="box-none"
          style={[styles.wipeContainer, { top: insets.top + 16 }]}
        >
          <Pressable
            onPressIn={handleWipePressIn}
            onPressOut={handleWipePressOut}
            hitSlop={16}
            style={styles.wipeHit}
          >
            <Animated.View
              style={[
                styles.wipeSeal,
                {
                  backgroundColor: wipeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["rgba(127,29,29,0.4)", RED],
                  }),
                  transform: [
                    {
                      scale: wipeAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 1.25],
                      }),
                    },
                  ],
                  boxShadow: boxShadow(RED, wipeArmed || isWiping ? 0.95 : 0.5, 10),
                },
              ]}
            >
              <Ionicons name="flame" size={13} color="#fff" />
            </Animated.View>
            <Text style={styles.wipeLabel}>
              {isWiping ? "WIPED" : wipeArmed ? "HOLD 3s" : "WIPE"}
            </Text>
          </Pressable>
        </View>

        {/* Alias header */}
        <View pointerEvents="none" style={[styles.header, { top: insets.top + 18 }]}>
          <Text style={styles.aliasText}>{aliasText}</Text>
          <View style={styles.aliasDivider} />
          <Text style={styles.aliasTagline}>SECURE IDENTITY</Text>
        </View>

        {/* Radial dial: tap the coin to reveal/hide the menu */}
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

            {/* Coin centerpiece — tap to reveal/hide menu */}
            <View pointerEvents="box-none" style={styles.centerWrap}>
              <View style={styles.centerCol}>
                <Pressable
                  onPress={toggleMenu}
                  hitSlop={24}
                  style={styles.centerHit}
                  accessibilityRole="button"
                  accessibilityLabel={menuOpen ? "Hide menu" : "Tap to reveal menu"}
                >
                  {/* Outer ambient glow */}
                  <View pointerEvents="none" style={styles.globeGlow} />

                  {/* Fake thickness: gold edge band flashes when edge-on */}
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.coinEdgeBand,
                      {
                        opacity: Animated.multiply(coinEdge, circleOpacity),
                        transform: [
                          { perspective: 800 },
                          {
                            rotateX: coinTiltX.interpolate({
                              inputRange: [0, 90],
                              outputRange: ["0deg", "90deg"],
                              extrapolate: "clamp",
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <View style={styles.coinEdgeHighlight} />
                  </Animated.View>

                  {/* Physics-driven spinning coin with metallic rim */}
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.coinRim,
                      {
                        opacity: circleOpacity,
                        transform: coinTransform,
                      },
                    ]}
                  >
                    <Image
                      source={require("../../assets/images/ghostface-logo.jpeg")}
                      resizeMode="cover"
                      style={styles.coinImage}
                    />
                    {/* Motion blur: pre-blurred face crossfades in with boost
                        velocity so top-speed spins read as a whirl */}
                    <Animated.Image
                      source={require("../../assets/images/ghostface-logo.jpeg")}
                      resizeMode="cover"
                      blurRadius={18}
                      style={[styles.coinBlurImage, { opacity: coinBlur }]}
                    />
                    {/* Faint horizontal streaks sell the spin direction */}
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.coinBlurStreaks,
                        { opacity: Animated.multiply(coinBlur, 0.55) },
                      ]}
                    >
                      <View style={[styles.coinStreak, { top: "28%" }]} />
                      <View style={[styles.coinStreak, { top: "50%" }]} />
                      <View style={[styles.coinStreak, { top: "72%" }]} />
                    </Animated.View>
                  </Animated.View>
                </Pressable>

                <Animated.Text
                  pointerEvents="none"
                  style={[styles.centerHint, { opacity: hintOpacity }]}
                >
                  TAP TO REVEAL
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
                        color={active ? GOLD : "rgba(191,155,48,0.75)"}
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
      </View>
    </TabScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // Wipe seal (top-right)
  wipeContainer: {
    position: "absolute",
    right: 24,
    alignItems: "center",
    zIndex: 50,
  },
  wipeHit: { alignItems: "center", justifyContent: "center", padding: 8 },
  wipeSeal: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(220,38,38,0.7)",
  },
  wipeLabel: {
    position: "absolute",
    top: 32,
    fontFamily: FONT_MONO,
    fontSize: 8,
    letterSpacing: 2,
    color: "rgba(220,38,38,0.9)",
  },

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

  // Central coin
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
    width: 196,
    height: 196,
    alignItems: "center",
    justifyContent: "center",
  },
  globeGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    top: (196 - 260) / 2,
    left: (196 - 260) / 2,
    borderRadius: 130,
    backgroundColor: "rgba(191,155,48,0.06)",
    boxShadow: boxShadow(GOLD, 0.55, 50),
  },
  // Metallic coin rim — conic-gradient-style gold ring
  coinRim: {
    width: 190,
    height: 190,
    borderRadius: 95,
    padding: 5,
    borderWidth: 4,
    borderColor: "rgba(191,155,48,0.0)", // transparent — visual ring comes from backgroundColor
    backgroundColor: "#c9971c",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: [
      boxShadow(GOLD, 0.7, 18),
      "inset 0 2px 6px rgba(255,235,120,0.5)",
      "inset 0 -4px 10px rgba(50,32,0,0.6)",
    ].join(", "),
    overflow: "hidden",
  },
  // Fake coin thickness — vertical gold band shown when the coin is edge-on
  coinEdgeBand: {
    position: "absolute",
    width: 16,
    height: 190,
    top: (196 - 190) / 2,
    left: (196 - 16) / 2,
    borderRadius: 8,
    backgroundColor: "#8a6a12",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: [
      boxShadow(GOLD, 0.8, 14),
      "inset 0 0 4px rgba(30,20,0,0.7)",
    ].join(", "),
  },
  coinEdgeHighlight: {
    width: 4,
    height: 176,
    borderRadius: 2,
    backgroundColor: "rgba(255,222,110,0.75)",
  },
  coinImage: {
    width: 176,
    height: 176,
    borderRadius: 88,
  },
  coinBlurImage: {
    position: "absolute",
    width: 176,
    height: 176,
    borderRadius: 88,
  },
  coinBlurStreaks: {
    position: "absolute",
    width: 176,
    height: 176,
    borderRadius: 88,
    overflow: "hidden",
  },
  coinStreak: {
    position: "absolute",
    left: "6%",
    right: "6%",
    height: 2,
    borderRadius: 1,
    backgroundColor: "rgba(255,230,150,0.35)",
  },
  centerHint: {
    marginTop: 16,
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 4,
    color: "rgba(191,155,48,0.6)",
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
    backgroundColor: "rgba(191,155,48,0.07)",
    borderWidth: 1,
    borderColor: "rgba(191,155,48,0.3)",
  },
  nodeCircleActive: {
    backgroundColor: "rgba(191,155,48,0.16)",
    borderColor: "rgba(191,155,48,0.6)",
  },
  nodeLabel: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 2,
    color: "rgba(255,255,255,0.78)",
  },
  nodeLabelActive: { color: "#ffffff" },
});
