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
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas } from "@shopify/react-native-skia";
import ReAnimated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import {
  GLASS_METALLIC_BLACK,
  GLASS_REFERENCE_SPECULAR,
  GLASS_TINT_BLACK,
  GoldGradient,
  SpecularHighlight,
} from "@/components/GoldGradient";
import { CoinEdge, GlobeCoinMark, GlobeShade } from "@/components/CoinGlobe";
import { PanicButton } from "@/components/PanicButton";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { useApp } from "@/context/AppContext";
import { boxShadow } from "@/lib/shadow";

const BG = "#000";
// Real native Liquid Glass (iOS 26+, via expo-glass-effect) for the radial
// menu nodes where available; older iOS/Android keep the BlurView +
// gradient approximation below. Black tint (same as every other gold-glass
// surface in the app) regardless of active state — gold lives in the rim
// border, not the fill. Active/inactive is distinguished by the rim border
// color and icon brightness instead, below.
const USE_NATIVE_GLASS = isLiquidGlassAvailable();
// This menu's look is the reference the rest of the app matches. It used to
// keep private copies of these values so they couldn't drift when the shared
// button tint was tuned — but the copies were character-identical to the
// shared tokens, so they protected nothing while hiding what actually made
// the menu different: GLASS_REFERENCE_SPECULAR (0.35, against the 0.22
// default) and no `solid` fill. Now shared, so "match the radial menu" is
// one import rather than a number to remember.
const NODE_GLASS_TINT = GLASS_TINT_BLACK;
const NODE_GLASS_TINT_ACTIVE = NODE_GLASS_TINT;
const NODE_GLASS_TINT_INACTIVE = NODE_GLASS_TINT;
const NODE_GLASS_METALLIC_FALLBACK = GLASS_METALLIC_BLACK;

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

// Coin diameter. Everything about the coin derives from this — rim, edge band,
// blur streaks, halo and tap target — so it is one number to change.
const COIN_SIZE = 174;
// Mark height as a fraction of the coin. Over 1, so the mark is TALLER than
// the disc and deliberately overflows it — the coin is now plain glass and the
// trademark is the subject, not a badge on a face. Note ~0.79 is the largest
// that fits fully inside the circle (the mark is taller than it is wide, so
// the diagonal binds), which is why this one is drawn over the glass rather
// than inside it.

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
  const { alias, vpnConnected, panicWipe, hasWalletPin, isSectionLocked } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  // Decorative ring spin
  const spin = useRef(new Animated.Value(0)).current;
  // Coin physics values — driven by rAF, not Animated.timing.
  //
  // coinRotY and coinEdge used to live here too. Both became write-only when
  // the coin became a sphere: coinRotY's only reader was the flat rotateY
  // (the mark now reads globePhase on the UI thread), and coinEdge drove the
  // fake edge band and the halo, neither of which exists any more. They were
  // still being computed and set 60 times a second on the JS thread, which is
  // the same thread the physics loop and Metro share.
  // 0..1 — motion-blur mix; crossfades a pre-blurred face over the crisp one
  const coinBlur = useRef(new Animated.Value(0)).current;
  // Spin angle for the globe mesh. Deliberately a reanimated shared value and
  // not the Animated.Value above: the mesh is rebuilt inside a Skia worklet on
  // the UI thread, and an Animated.Value cannot be read from there.
  const globePhase = useSharedValue(0);
  // The disc's own foreshortening. A coin's FACE narrows to D*|cos| as it
  // turns — without this only the mark flipped and the glass stayed a full
  // circle, which reads as a picture spinning inside a window. Reanimated, not
  // RN Animated, so it runs on the UI thread alongside the Skia faces and
  // cannot drift from them.
  const coinFaceStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.abs(Math.cos((globePhase.value * Math.PI) / 180)) }],
  }));
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
        // Direction is applied HERE, not by negating spinVel: the velocity is
        // compared against positive thresholds all through this loop (haptic
        // start, blur ramp, brake floor), and a negative value would silently
        // disable every one of them. The extra +360 keeps the angle in 0..360
        // — JS % returns a negative for a negative left operand, and the
        // cos/sin the coin faces are built from would then jump at the wrap.
        spinAngle.current =
          ((spinAngle.current - spinVel.current * dt) % 360 + 360) % 360;
        const totalRotY = spinAngle.current;
        globePhase.value = totalRotY;
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
      locked: isSectionLocked("messages"),
    },
    {
      icon: "call-outline",
      label: "CALL",
      onPress: go(() => router.push("/(tabs)/calls")),
      locked: isSectionLocked("calls"),
    },
    {
      icon: "shield-outline",
      label: vpnConnected ? "VPN ON" : "VPN",
      activeKey: "vpn",
      onPress: go(() => router.push("/(tabs)/vpn")),
      locked: isSectionLocked("vpn"),
    },
    {
      icon: "wallet-outline",
      label: "WALLET",
      onPress: go(() => router.push("/(tabs)/wallet")),
      locked: isSectionLocked("wallet"),
    },
    {
      icon: "phone-portrait-outline",
      label: "NUMBER",
      onPress: go(() => router.push("/(tabs)/ghostnumber")),
      locked: isSectionLocked("number"),
    },
    {
      icon: "settings-outline",
      label: "SETTINGS",
      onPress: go(() => router.push("/(tabs)/settings")),
      locked: isSectionLocked("settings"),
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
                  {/* The coin's fake edge band is gone with the disc. A sphere
                      has no edge-on state — its outline is a circle from every
                      angle — so a flashing thickness band was the one thing
                      that would have given the globe away as a flat plate.
                      coinEdge went with it — see the physics values. */}

                  {/* Physics-driven spinning coin. The face is the SAME
                      GoldGradient glass as every radial button around it —
                      same tint, same reference specular, same rim — so the
                      coin reads as the centre of one set rather than a metal
                      object dropped into a glass menu. The trademark is the
                      subject; the disc is just its surface. */}
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.coinBall, { opacity: circleOpacity }]}
                  >
                    {/* The glass body. Same GoldGradient as every button, and
                        it does NOT rotate — a sphere's outline never changes,
                        so the silhouette stays a circle while the surface
                        turns inside it. */}
                    {/* Same specular as every button — the globe's override is
                        gone and the shared constant carries the brighter value
                        instead, so one number drives the whole set. */}
                    <ReAnimated.View style={[styles.coinFace, coinFaceStyle]}>
                      <GoldGradient
                        specularIntensity={GLASS_REFERENCE_SPECULAR}
                        style={styles.coinFace}
                      />
                    </ReAnimated.View>
                    {/* The wireframe. Static: the grid is drawn as a full
                        globe already, so turning it with a flat rotateY would
                        squash the whole cage rather than move meridians across
                        the surface. The rotation you read is the mark
                        travelling over it. */}
                    {/* Glass body + the flipping trademark. The wireframe,
                        mark field, scanlines and chromatic fringe are gone —
                        they stacked up busier than the coin itself. */}
                    <View style={styles.coinSurface} pointerEvents="none">
                      <Canvas style={styles.coinFace}>
                        <CoinEdge size={COIN_SIZE} phase={globePhase} />
                        <GlobeCoinMark size={COIN_SIZE} phase={globePhase} />
                      </Canvas>
                    </View>

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

                    {/* Light, LAST and un-rotated. A ball lit from the upper
                        left keeps its highlight in the upper left however fast
                        it turns; rotating the shading is exactly what makes a
                        sphere look like a painted plate. Limb darkening here is
                        what gives the outline its roundness. */}
                    <ReAnimated.View style={[styles.coinShade, coinFaceStyle]} pointerEvents="none">
                      <GlobeShade size={COIN_SIZE} />
                    </ReAnimated.View>

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
                          <SpecularHighlight intensity={GLASS_REFERENCE_SPECULAR} />
                          <Ionicons
                            name={node.icon}
                            size={20}
                            color={active ? "#F5D26B" : "rgba(255,255,255,0.88)"}
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
                          <SpecularHighlight intensity={GLASS_REFERENCE_SPECULAR} />
                          <View
                            pointerEvents="none"
                            style={[styles.nodeCircleRim, active && styles.nodeCircleRimActive]}
                          />
                          <Ionicons
                            name={node.icon}
                            size={20}
                            color={active ? "#F5D26B" : "rgba(255,255,255,0.88)"}
                          />
                        </View>
                      )}
                      {node.locked && (
                        <View style={styles.nodeLockBadge} pointerEvents="none">
                          <Ionicons name="lock-closed" size={9} color="#E7C765" />
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
    width: COIN_SIZE + 6,
    height: COIN_SIZE + 6,
    alignItems: "center",
    justifyContent: "center",
  },
  // The globe. Static and circular: a sphere's silhouette never changes, so
  // this does NOT carry the rotation — the surface inside it does. overflow
  // hidden is what keeps the turning surface inside the limb.
  coinBall: {
    width: COIN_SIZE,
    height: COIN_SIZE,
    borderRadius: COIN_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  // The rotating surface: grid + mark. Carries coinTransform.
  coinSurface: {
    position: "absolute",
    width: COIN_SIZE,
    height: COIN_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  // View-space lighting, drawn over everything and never rotated.
  coinShade: {
    position: "absolute",
    width: COIN_SIZE,
    height: COIN_SIZE,
  },
  // Fake coin thickness — the band shown when the coin turns edge-on.
  coinFace: {
    width: COIN_SIZE,
    height: COIN_SIZE,
    borderRadius: COIN_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  coinBlurStreaks: {
    position: "absolute",
    width: COIN_SIZE,
    height: COIN_SIZE,
    borderRadius: COIN_SIZE / 2,
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
    borderColor: "#F5D26B",
  },
  nodeCircleRim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  nodeCircleRimActive: {
    borderColor: "rgba(245,210,107,0.85)",
  },
  nodeLockBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#141418",
    borderWidth: 1.5,
    borderColor: "#C9A64C",
    alignItems: "center",
    justifyContent: "center",
  },
  nodeLabel: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 2,
    color: "rgba(255,255,255,0.78)",
  },
  nodeLabelActive: { color: "#F5D26B" },
});
