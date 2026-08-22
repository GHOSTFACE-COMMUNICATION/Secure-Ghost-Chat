import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
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
import { SpecularHighlight } from "@/components/GoldGradient";
import { PanicButton } from "@/components/PanicButton";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { useApp } from "@/context/AppContext";
import { boxShadow } from "@/lib/shadow";

const BG = "#000";
const GOLD = "#F5D26B";
// Real native Liquid Glass (iOS 26+, via expo-glass-effect) for the radial
// menu nodes where available; older iOS/Android keep the BlurView +
// gradient approximation below. Black tint (same as every other gold-glass
// surface in the app) regardless of active state — gold lives in the rim
// border, not the fill. Active/inactive is distinguished by the rim border
// color and icon brightness instead, below.
const USE_NATIVE_GLASS = isLiquidGlassAvailable();
// Deliberately its own constant, not the shared GLASS_TINT_BLACK — this
// menu's look was confirmed as the reference/"perfect" one, so it's frozen
// here and doesn't drift if the shared tint used by the rest of the app's
// buttons gets tuned later.
const NODE_GLASS_TINT = "rgba(10,10,12,0.55)";
const NODE_GLASS_TINT_ACTIVE = NODE_GLASS_TINT;
const NODE_GLASS_TINT_INACTIVE = NODE_GLASS_TINT;
const NODE_GLASS_METALLIC_FALLBACK = ["#2a2a2c", "#141416", "#050505", "#000000"] as const;

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
// Velocity model: the coin spins upright forever at BASE_SPIN_DEG_S (it never
// tilts or falls). Taps add capped velocity kicks that decay back to the base
// rate; holding the coin brakes it to a stop, and releasing spins it back up.
const BASE_SPIN_DEG_S = 130; // idle spin rate
// Tap-spin impulse tuning: one tap ≈ a quick flick; 4–5 fast taps hit the cap
// for a fast whirl; the 0.18^dt decay in the frame loop winds it down within
// ~2 s (half-life ≈ 0.4 s).
const TAP_KICK_DEG_S = 900; // deg/s added per tap
const MAX_BOOST_DEG_S = 4000; // cap on stacked velocity
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

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

type NavNode = {
  icon: IconName;
  label: string;
  onPress: () => void;
  activeKey?: "vpn";
  locked?: boolean;
};

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { alias, vpnConnected, panicWipe, hasWalletPin } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  // Decorative ring spin
  const spin = useRef(new Animated.Value(0)).current;
  // Coin physics values — driven by rAF, not Animated.timing
  const coinRotY = useRef(new Animated.Value(0)).current;
  // 0..1 — how edge-on the coin is; drives the fake "thickness" rim band
  const coinEdge = useRef(new Animated.Value(0)).current;
  // 0..1 — motion-blur mix; crossfades a pre-blurred face over the crisp one
  const coinBlur = useRef(new Animated.Value(0)).current;
  // Spin velocity (deg/s) + accumulated angle; taps kick the velocity up,
  // holding brakes it to zero, release spins it back up to the base rate.
  const spinVel = useRef(BASE_SPIN_DEG_S);
  const spinAngle = useRef(0);
  const holdingCoin = useRef(false);
  // Set on long-press so the release doesn't also fire onPress (menu toggle)
  const didHoldCoin = useRef(false);
  const lastFrameMs = useRef(0);
  // Timestamp of the last spin-haptic tick (performance.now() ms)
  const lastHapticMs = useRef(0);

  const fade = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const rafRef = useRef<number>(0);

  // Decorative ring + breathing fade — gated on screen focus so nothing
  // churns battery while this tab is off-screen.
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

  // Coin physics loop — runs on JS thread, drives Animated.Values via setValue.
  // Gated on screen focus, same as the ring/fade loop above, so it doesn't
  // keep ticking at 60fps (and firing haptics) while another tab is open.
  useFocusEffect(
    useCallback(() => {
      function frame(now: number) {
        const dt = lastFrameMs.current
          ? Math.min((now - lastFrameMs.current) / 1000, 0.05)
          : 0;
        lastFrameMs.current = now;
        const v = spinVel.current;
        if (holdingCoin.current) {
          // Braking: hard exponential decay toward a full stop
          spinVel.current = v < 2 ? 0 : v * Math.pow(0.015, dt);
        } else if (v > BASE_SPIN_DEG_S) {
          // Tap boost decays back down to the idle rate
          spinVel.current =
            BASE_SPIN_DEG_S + (v - BASE_SPIN_DEG_S) * Math.pow(0.18, dt);
        } else {
          // Released after a hold: ease back up to the idle rate
          spinVel.current =
            BASE_SPIN_DEG_S + (v - BASE_SPIN_DEG_S) * Math.pow(0.08, dt);
        }
        spinAngle.current = (spinAngle.current + spinVel.current * dt) % 360;
        const totalRotY = spinAngle.current;
        coinRotY.setValue(totalRotY);
        // Edge band peaks when the face is edge-on
        const edgeOn = Math.pow(
          Math.abs(Math.sin((totalRotY * Math.PI) / 180)),
          3,
        );
        coinEdge.setValue(edgeOn);
        // Motion blur: ramp with spin velocity, smoothstep-shaped so it eases
        // in near top speed and fades out smoothly as the boost decays.
        const blurT = Math.max(
          0,
          Math.min(
            1,
            (spinVel.current - BLUR_START_DEG_S) /
              (BLUR_FULL_DEG_S - BLUR_START_DEG_S),
          ),
        );
        coinBlur.setValue(blurT * blurT * (3 - 2 * blurT));
        // Haptic buzz: tick rate ramps with spin velocity. Only fires while a
        // tap boost is active (never during the idle spin rate) and no-ops on
        // web where expo-haptics has no implementation.
        if (Platform.OS !== "web" && spinVel.current > HAPTIC_START_DEG_S) {
          const speedT = Math.min(
            (spinVel.current - HAPTIC_START_DEG_S) /
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
      return () => {
        cancelAnimationFrame(rafRef.current);
        lastFrameMs.current = 0;
      };
    }, []),
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Tap-spin kick: stacks across rapid taps, capped so mashing can't
    // spin the coin absurdly fast or break edge-band/glow visuals.
    spinVel.current = Math.min(
      spinVel.current + TAP_KICK_DEG_S,
      MAX_BOOST_DEG_S,
    );
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
      onPress: go(() => router.push("/(tabs)/calls")),
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
      locked: hasWalletPin,
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

  // Coin transform — driven by physics rAF loop via setValue. Always upright:
  // the coin spins around its vertical axis and never tilts or falls.
  const coinTransform = [
    { perspective: 800 },
    {
      rotateY: coinRotY.interpolate({
        inputRange: [0, 360],
        outputRange: ["0deg", "360deg"],
        extrapolate: "clamp",
      }),
    },
  ];

  return (
    <TabScreenWrapper>
      <View style={styles.container}>
        {/* Alias header */}
        <View
          pointerEvents="none"
          style={[styles.header, { top: insets.top + 18 }]}
        >
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
                  onPress={() => {
                    // A hold that stopped the coin shouldn't also toggle the menu
                    if (didHoldCoin.current) return;
                    toggleMenu();
                  }}
                  onLongPress={() => {
                    didHoldCoin.current = true;
                    holdingCoin.current = true;
                  }}
                  delayLongPress={220}
                  onPressOut={() => {
                    holdingCoin.current = false;
                    // Reset after this tap cycle fully settles (onPress fires
                    // after onPressOut on release of a long press)
                    setTimeout(() => {
                      didHoldCoin.current = false;
                    }, 0);
                  }}
                  hitSlop={24}
                  style={styles.centerHit}
                  accessibilityRole="button"
                  accessibilityLabel={
                    menuOpen ? "Hide menu" : "Tap to reveal menu"
                  }
                >
                  {/* Outer ambient glow — this is what the clear ring of the
                      coin reads through, so it carries the light rather than
                      just haloing the edge. */}
                  <View pointerEvents="none" style={styles.globeGlow} />

                  {/* Fake thickness: glass edge flashes when edge-on */}
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.coinEdgeBand,
                      {
                        opacity: Animated.multiply(coinEdge, circleOpacity),
                      },
                    ]}
                  >
                    <View style={styles.coinEdgeHighlight} />
                  </Animated.View>

                  {/* Physics-driven spinning coin. The disc itself is clear
                      glass — a faint fill between two hairline rims — with the
                      logo suspended in the middle as the only opaque part, so
                      the glow behind shows through the ring around it. */}
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.coinGlass,
                      {
                        opacity: circleOpacity,
                        transform: coinTransform,
                      },
                    ]}
                  >
                    <View style={styles.coinLens}>
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
                    </View>
                    {/* Inner bevel — reads as the far wall of the glass */}
                    <View pointerEvents="none" style={styles.coinBevel} />
                  </Animated.View>

                  {/* Fixed light. Deliberately a sibling of (and after) the
                      spinning disc, so it does NOT rotate: a highlight that
                      stays put while the face turns underneath is what makes
                      the coin read as a solid object catching light rather
                      than a picture on a spinning card. */}
                  <View pointerEvents="none" style={styles.coinSpecularClip}>
                    <LinearGradient
                      colors={[
                        "rgba(255,255,255,0)",
                        "rgba(255,255,255,0.22)",
                        "rgba(255,255,255,0)",
                      ]}
                      locations={[0.16, 0.32, 0.52]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    {/* Caustic: light pooling along the lower rim */}
                    <LinearGradient
                      colors={["rgba(255,255,255,0.16)", "rgba(255,255,255,0)"]}
                      start={{ x: 0.5, y: 1 }}
                      end={{ x: 0.5, y: 0.58 }}
                      style={StyleSheet.absoluteFill}
                    />
                  </View>
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
              const x =
                ORBIT_CENTER + ORBIT_RADIUS * Math.cos(angle) - NODE / 2;
              const y =
                ORBIT_CENTER + ORBIT_RADIUS * Math.sin(angle) - NODE / 2;
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
                    <View style={styles.nodeCircleShadow}>
                      {USE_NATIVE_GLASS ? (
                        <GlassView
                          style={[
                            styles.nodeCircleGlass,
                            styles.nodeCircleGlassBorder,
                            active && styles.nodeCircleGlassBorderActive,
                          ]}
                          glassEffectStyle="clear"
                          tintColor={active ? NODE_GLASS_TINT_ACTIVE : NODE_GLASS_TINT_INACTIVE}
                          isInteractive
                        >
                          <SpecularHighlight intensity={0.35} />
                          <Ionicons
                            name={node.icon}
                            size={20}
                            color={active ? "#FFFFFF" : "rgba(255,255,255,0.88)"}
                          />
                        </GlassView>
                      ) : (
                        <View style={styles.nodeCircle}>
                          <BlurView
                            intensity={active ? 45 : 32}
                            tint="dark"
                            style={StyleSheet.absoluteFill}
                          />
                          <LinearGradient
                            pointerEvents="none"
                            // Same gradient regardless of active state — see the
                            // NODE_GLASS_TINT comment above for why.
                            colors={NODE_GLASS_METALLIC_FALLBACK}
                            start={{ x: 0.15, y: 0 }}
                            end={{ x: 0.85, y: 1 }}
                            style={StyleSheet.absoluteFill}
                          />
                          <SpecularHighlight intensity={0.35} />
                          <View
                            pointerEvents="none"
                            style={[styles.nodeCircleRim, active && styles.nodeCircleRimActive]}
                          />
                          <Ionicons
                            name={node.icon}
                            size={20}
                            color={active ? "#FFFFFF" : "rgba(255,255,255,0.88)"}
                          />
                        </View>
                      )}
                      {node.locked && (
                        <View style={styles.nodeLockBadge} pointerEvents="none">
                          <Ionicons name="lock-closed" size={9} color="#000000" />
                        </View>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.nodeLabel,
                        active && styles.nodeLabelActive,
                      ]}
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
    color: "rgba(245,210,107,0.78)",
  },
  aliasDivider: {
    width: 32,
    height: 1,
    marginVertical: 12,
    backgroundColor: "rgba(245,210,107,0.3)",
  },
  aliasTagline: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 5,
    color: "rgba(245,210,107,0.5)",
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
    backgroundColor: "rgba(245,210,107,0.4)",
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
  // Ambient light behind the coin. Kept strong on purpose: the coin's outer
  // ring is clear now, and this glow is the only thing behind it — with
  // nothing to see through, clear glass on a black screen just renders black
  // (the same trap GLASS_SOLID_FILL documents in GoldGradient.tsx).
  globeGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    top: (196 - 260) / 2,
    left: (196 - 260) / 2,
    borderRadius: 130,
    backgroundColor: "rgba(245,210,107,0.09)",
    boxShadow: boxShadow(GOLD, 0.6, 54),
  },
  // Clear glass disc. The gold rim that used to live here is gone: the ring
  // is now a faint fill between two white hairlines (outer border + inner
  // bevel), so the glow behind reads straight through it. Pure RN styling
  // rather than GlassView — there is nothing behind this to refract, so the
  // native effect would render it black and the two platforms would diverge.
  coinGlass: {
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: [
      boxShadow("#FFFFFF", 0.18, 16),
      "inset 0 2px 8px rgba(255,255,255,0.28)",
      "inset 0 -6px 14px rgba(255,255,255,0.10)",
    ].join(", "),
    overflow: "hidden",
  },
  // Far wall of the glass — a second hairline inset from the rim gives the
  // disc thickness from every angle, not just edge-on.
  coinBevel: {
    position: "absolute",
    top: 7,
    left: 7,
    right: 7,
    bottom: 7,
    borderRadius: 88,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  // Fake coin thickness — glass band shown when the coin is edge-on
  coinEdgeBand: {
    position: "absolute",
    width: 16,
    height: 190,
    top: (196 - 190) / 2,
    left: (196 - 16) / 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: [
      boxShadow("#FFFFFF", 0.35, 12),
      "inset 0 0 6px rgba(255,255,255,0.22)",
    ].join(", "),
  },
  coinEdgeHighlight: {
    width: 3,
    height: 172,
    borderRadius: 1.5,
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  // The suspended face — the one opaque part of the coin, ringed by its own
  // hairline so it reads as sitting inside the glass rather than filling it.
  coinLens: {
    width: 158,
    height: 158,
    borderRadius: 79,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coinImage: {
    width: 156,
    height: 156,
    borderRadius: 78,
  },
  coinBlurImage: {
    position: "absolute",
    width: 156,
    height: 156,
    borderRadius: 78,
  },
  coinBlurStreaks: {
    position: "absolute",
    width: 156,
    height: 156,
    borderRadius: 78,
    overflow: "hidden",
  },
  // Clip for the non-rotating highlight layered over the disc
  coinSpecularClip: {
    position: "absolute",
    width: 190,
    height: 190,
    top: (196 - 190) / 2,
    left: (196 - 190) / 2,
    borderRadius: 95,
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
    color: "rgba(245,210,107,0.6)",
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
  nodeCircleShadow: {
    borderRadius: 22,
    boxShadow: boxShadow("#000000", 0.35, 10, 0, 4),
  },
  nodeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    overflow: "hidden",
  },
  // No manual background/border here — GlassView renders its own native
  // blur and refraction (see nodeCircle's comment-equivalent in
  // GlassCallButton.tsx for why layering the fallback's tint underneath
  // would just mute it).
  nodeCircleGlass: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  nodeCircleGlassBorder: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  nodeCircleGlassBorderActive: {
    borderColor: "#FFFFFF",
  },
  nodeCircleRim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  nodeCircleRimActive: {
    borderColor: "rgba(255,255,255,0.6)",
  },
  nodeLockBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#F5D26B",
    borderWidth: 1.5,
    borderColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  nodeLabel: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 2,
    color: "rgba(255,255,255,0.78)",
  },
  nodeLabelActive: { color: "#ffffff" },
});
