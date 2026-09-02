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
import {
  GLASS_METALLIC_BLACK,
  GLASS_REFERENCE_SPECULAR,
  GLASS_TINT_BLACK,
  SpecularHighlight,
} from "@/components/GoldGradient";
import { GhostLogo } from "@/components/GhostLogo";
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
// The velocity model, tap-kick, blur and haptic-ramp constants used to be
// duplicated here and in components/GhostLogo.tsx, with a comment in each file
// warning that the two had to be kept in step by hand. They are now defined
// once, in GhostLogo, which owns the coin on both screens. Deleting them here
// is the point of the change: there is no longer a second copy to drift.

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
  // The coin's own animated values (blur mix, globe phase, spin velocity and
  // angle, hold/hold-consumed flags, frame and haptic timestamps, rAF handle)
  // all lived here. Every one of them belonged to the sphere and its loop, and
  // both are gone — GhostLogo holds the equivalents internally now.

  const fade = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;

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

  // The coin's physics rAF loop used to live here. It is GONE, not disabled:
  // the coin is now components/GhostLogo in `live` mode, which runs its own
  // loop with the same constants. Leaving this one would have ticked at 60fps
  // on the JS thread — the thread the app and Metro share — writing values
  // nothing reads and firing haptics for a coin that no longer exists here.
  // That is the exact write-only waste the comments on the removed refs
  // describe. GhostLogo gates its loop on `live && coin`; this screen gates
  // it by not having one.

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
    // The tap-spin kick used to be applied here. It now lives inside
    // GhostLogo, which owns the coin's velocity — applying it from both sides
    // would double every kick.
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
                {/* The centrepiece is now the SHARED coin from
                    components/GhostLogo — the same metallic disc, milled edge
                    and warm halo the user meets on the onboarding hero.
                    Previously this was a glass sphere built from Skia
                    (CoinEdge / GlobeCoinMark / GlobeShade over a GoldGradient
                    face) which matched the radial buttons but shared nothing
                    with onboarding, so the first object a user ever taps and
                    the object they tap every day afterwards were different
                    things. One coin, two screens.

                    GhostLogo owns the gestures and the physics: press brakes
                    and kicks, release taps. This screen no longer runs its own
                    rAF loop — see the physics block removed above. The tap/hold
                    split that used to live in this Pressable now lives in
                    GhostLogo's HOLD_THRESHOLD_MS, so holding to stop the coin
                    still does not open the menu. */}
                <View
                  style={styles.centerHit}
                  accessibilityRole="button"
                  accessibilityLabel={
                    menuOpen ? "Hide menu" : "Tap to reveal menu"
                  }
                >
                  <Animated.View style={{ opacity: circleOpacity }}>
                    <GhostLogo size={COIN_SIZE} coin live glow={1.55} onTap={toggleMenu} />
                  </Animated.View>
                </View>

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
                            color={active ? "#DEB451" : "rgba(255,255,255,0.88)"}
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
                            color={active ? "#DEB451" : "rgba(255,255,255,0.88)"}
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
    color: "rgba(222,180,81,0.78)",
  },
  aliasDivider: {
    width: 32,
    height: 1,
    marginVertical: 12,
    backgroundColor: "rgba(222,180,81,0.3)",
  },
  aliasTagline: {
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 5,
    color: "rgba(222,180,81,0.5)",
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
    backgroundColor: "rgba(222,180,81,0.4)",
  },

  // Central coin
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  // Only the coin is laid out here. The "TAP TO REVEAL" hint is absolutely
  // positioned below (see centerHint) rather than being a second row in this
  // column: as a flow child its height was included in the centring, so the
  // column centred (coin + gap + hint) and pushed the coin about 13px ABOVE
  // the orbit's true centre. The coin is the thing the ring is drawn around,
  // so the coin is what has to be centred.
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
  centerHint: {
    // Absolute, so it hangs below the coin without affecting where the coin
    // lands. `top` reproduces the old 16px gap measured from the bottom of the
    // hit area; left/right + textAlign keep it centred since alignItems does
    // not apply to absolutely-positioned children.
    position: "absolute",
    top: COIN_SIZE + 6 + 16,
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: FONT_MONO,
    fontSize: 9,
    letterSpacing: 4,
    color: "rgba(222,180,81,0.6)",
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
    borderColor: "#DEB451",
  },
  nodeCircleRim: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  nodeCircleRimActive: {
    borderColor: "rgba(222,180,81,0.85)",
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
  nodeLabelActive: { color: "#DEB451" },
});
