import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef } from "react";
import { Animated, Easing, Image, PanResponder, Platform, View } from "react-native";

import { boxShadow } from "@/lib/shadow";

// ── Live-coin physics ─────────────────────────────────────────────────────────
// Mirrors the home screen's velocity model (app/(tabs)/index.tsx) so the coin
// feels like the same object in both places: it spins upright forever, taps add
// capped kicks that decay back to the idle rate, and holding brakes it to a
// stop. Values are copied deliberately rather than invented — a coin that spins
// at a different speed in onboarding would read as a different coin.
//
// NOTE: this duplicates the home screen's tuning. The right end state is one
// shared coin component; that is a refactor of the app's signature interaction
// and was deliberately deferred rather than done late in a long session.
const BASE_SPIN_DEG_S = 130;
const TAP_KICK_DEG_S = 900;
const MAX_BOOST_DEG_S = 4000;
const BLUR_START_DEG_S = 1400;
const BLUR_FULL_DEG_S = 3200;
const HAPTIC_START_DEG_S = 700;
const HAPTIC_SLOW_INTERVAL_MS = 220;
const HAPTIC_FAST_INTERVAL_MS = 60;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

interface GhostLogoProps {
  size?: number;
  color?: string;
  /** Render as a metallic coin (silver rim + disc face + edge band that flashes
   *  when edge-on) that you TAP to flip, matching the home-screen radial coin.
   *  When false (default) it's the flat gold trademark mark. */
  coin?: boolean;
  /** Called when the coin is tapped (coin mode) — e.g. to trigger a reward reveal. */
  onTap?: () => void;
  /** Coin mode only. Give the coin the home screen's living motion: a permanent
   *  idle spin, tap kicks that decay, hold-to-brake, motion blur at speed and a
   *  haptic buzz that ramps with velocity. Off by default so the small logo
   *  usages elsewhere stay static and cheap. */
  live?: boolean;
}

export function GhostLogo({ size = 64, coin = false, onTap, live = false }: GhostLogoProps) {
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const spin = useRef(new Animated.Value(0)).current;
  // Accumulated rotation in full turns; each tap adds more and eases out.
  const spinTargetRef = useRef(0);

  // ── Live mode: continuous velocity-driven spin ────────────────────────────
  const liveRotY = useRef(new Animated.Value(0)).current;
  const liveEdge = useRef(new Animated.Value(0)).current;
  const liveBlur = useRef(new Animated.Value(0)).current;
  const spinVel = useRef(BASE_SPIN_DEG_S);
  const spinAngle = useRef(0);
  const holding = useRef(false);
  const lastFrameMs = useRef(0);
  const lastHapticMs = useRef(0);
  const rafRef = useRef<number>(0);

  const liveRef = useRef(live);
  liveRef.current = live;

  const kick = useCallback(() => {
    spinVel.current = Math.min(spinVel.current + TAP_KICK_DEG_S, MAX_BOOST_DEG_S);
  }, []);

  useEffect(() => {
    if (!live || !coin) return;
    function frame(now: number) {
      const dt = lastFrameMs.current ? Math.min((now - lastFrameMs.current) / 1000, 0.05) : 0;
      lastFrameMs.current = now;
      const v = spinVel.current;
      if (holding.current) {
        spinVel.current = v < 2 ? 0 : v * Math.pow(0.015, dt);
      } else if (v > BASE_SPIN_DEG_S) {
        spinVel.current = BASE_SPIN_DEG_S + (v - BASE_SPIN_DEG_S) * Math.pow(0.18, dt);
      } else {
        spinVel.current = BASE_SPIN_DEG_S + (v - BASE_SPIN_DEG_S) * Math.pow(0.08, dt);
      }
      spinAngle.current = (spinAngle.current + spinVel.current * dt) % 360;
      liveRotY.setValue(spinAngle.current);
      // Edge band peaks when the face is edge-on.
      liveEdge.setValue(Math.pow(Math.abs(Math.sin((spinAngle.current * Math.PI) / 180)), 3));
      // Motion blur, smoothstep-shaped so it eases in near top speed.
      const t = Math.max(
        0,
        Math.min(1, (spinVel.current - BLUR_START_DEG_S) / (BLUR_FULL_DEG_S - BLUR_START_DEG_S)),
      );
      liveBlur.setValue(t * t * (3 - 2 * t));
      // Haptic buzz — only while a tap boost is active, so the idle spin is
      // silent. No-op on web, where expo-haptics has no implementation.
      if (Platform.OS !== "web" && spinVel.current > HAPTIC_START_DEG_S) {
        const speedT = Math.min(
          (spinVel.current - HAPTIC_START_DEG_S) / (MAX_BOOST_DEG_S - HAPTIC_START_DEG_S),
          1,
        );
        const interval = lerp(HAPTIC_SLOW_INTERVAL_MS, HAPTIC_FAST_INTERVAL_MS, speedT);
        if (now - lastHapticMs.current > interval) {
          lastHapticMs.current = now;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastFrameMs.current = 0;
    };
  }, [live, coin, liveRotY, liveEdge, liveBlur]);

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
        if (coin) {
          // In live mode the press brakes the coin and the tap adds a velocity
          // kick, exactly as on the home screen. The fixed three-turn flip is
          // only for the static coin.
          if (liveRef.current) { holding.current = true; kick(); }
          else { flip(); }
          onTap?.();
        }
        Animated.spring(scale, {
          toValue: 1.06,
          useNativeDriver: true,
          speed: 30,
          bounciness: 8,
        }).start();
      },

      onPanResponderRelease: () => {
        holding.current = false;
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 20,
          bounciness: 4,
        }).start();
      },

      onPanResponderTerminate: () => {
        holding.current = false;
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 0 }).start();
      },
    })
  ).current;

  // extend so accumulated turns keep rotating past 360°
  const flipRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"], extrapolate: "extend" });
  const liveRotate = liveRotY.interpolate({ inputRange: [0, 360], outputRange: ["0deg", "360deg"], extrapolate: "clamp" });
  const rotate = live ? liveRotate : flipRotate;

  if (coin) {
    // Edge band peaks near the edge-on angles (every 90° / 270° of each turn).
    const flipEdgeOpacity = spin.interpolate({
      inputRange: [0, 0.25, 0.5, 0.75, 1],
      outputRange: [0, 1, 0, 1, 0],
      extrapolate: "extend",
    });
    const edgeOpacity = live ? liveEdge : flipEdgeOpacity;
    const rim = size * 0.012;
    const face = size - rim * 2;
    const band = Math.max(8, size * 0.084);
    // Thin sparkling diamond edge: fine high-contrast facets with a brighter
    // glint every few facets — the sparkle carries it, not thickness.
    const facetCount = 132;
    const facetR = size / 2 - rim / 2;
    // Derive facet width from the actual pitch so the cuts nearly touch,
    // separated only by a thin dark line. A fixed width leaves gaps that read
    // as a bead chain rather than milled reeding — at 132 facets on a 180pt
    // coin the pitch is ~4.2pt, so a 1.5pt facet was only ~35% duty cycle.
    const facetPitch = (2 * Math.PI * facetR) / facetCount;
    const facetW = Math.max(1.2, facetPitch * 0.72);
    const facetH = rim * 2.1;

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
        {/* Soft white halo. Deliberately OUTSIDE the rotating element: a glow
            that spun with the coin would squash to a sliver every half turn,
            which reads as flicker rather than light. Kept subtle — it should
            lift the coin off the black, not announce itself. */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            width: size * 0.92,
            height: size * 0.92,
            borderRadius: size,
            backgroundColor: "rgba(255,255,255,0.035)",
            // Fade the halo as the coin turns edge-on. A constant full-circle
            // glow around a coin that collapses to a sliver twice per
            // revolution reads as a strobe, not as light — the silhouette
            // shrinks while the halo does not, so the mismatch pulses at
            // roughly 2Hz at the idle spin rate. Tying opacity to the same
            // edge factor that drives the edge band keeps the light attached
            // to the object making it.
            opacity: edgeOpacity.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 0.28],
              extrapolate: "clamp",
            }),
            boxShadow: [
              // Three stacked layers: a wide soft bloom, a mid falloff, and a
              // tight bright core. Stacking beats a single huge blur, which
              // just goes evenly grey — the layers give the falloff a shape.
              boxShadow("#FFFFFF", 0.13, size * 0.42),
              boxShadow("#FFFFFF", 0.16, size * 0.20),
              boxShadow("#FFFFFF", 0.14, size * 0.08),
            ].join(", "),
          }}
        />

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
          {/* Motion blur: a blurred copy of the face crossfades over the crisp
              one as spin velocity climbs, so a fast whirl reads as motion
              rather than a strobing logo. Only mounted in live mode. */}
          {live && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                width: face,
                height: face,
                borderRadius: face / 2,
                overflow: "hidden",
                opacity: liveBlur,
              }}
            >
              <BlurView intensity={38} tint="dark" style={{ width: face, height: face }}>
                <Image
                  source={require("../assets/images/ghostface-logo.jpeg")}
                  resizeMode="cover"
                  style={{ width: face, height: face, borderRadius: face / 2 }}
                />
              </BlurView>
            </Animated.View>
          )}
          {/* diamond-cut milled edge */}
          <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            {Array.from({ length: facetCount }).map((_, i) => {
              // Directional lighting is what makes milled reeding read as
              // metal rather than a dashed circle. A real diamond-cut edge is
              // lit from one side: facets facing the light blow out to white,
              // facets on the far side fall to near-black, and the two blend
              // through a gradient around the rim. The previous alternating
              // bright/dark pattern was uniform all the way round, which is
              // why it looked printed.
              const theta = (2 * Math.PI * i) / facetCount;
              // Light from upper-left, the convention the rest of the coin's
              // inset highlights already assume.
              const LIGHT = -Math.PI * 0.75;
              const facing = Math.cos(theta - LIGHT); // -1 (away) .. 1 (toward)
              const lit = Math.pow(Math.max(0, facing), 1.6); // 0..1 diffuse
              // Alternating cut faces: every other facet is the opposing
              // flank of the groove, so it catches noticeably less light.
              const flank = i % 2 === 0 ? 1 : 0.42;
              const shade = lit * flank;
              // Specular: a tight highlight only where a facet points almost
              // straight at the light, so sparkle is localised instead of
              // sprinkled evenly around the circumference.
              const spec = Math.pow(Math.max(0, facing), 22);
              const isGlint = spec > 0.35 && i % 2 === 0;
              // Blend near-black → warm steel → white with the shade term.
              const lo = [22, 22, 30];
              const hi = [248, 250, 255];
              const c = lo.map((v, k) => Math.round(v + (hi[k] - v) * shade));
              return (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    top: size / 2 - facetH / 2,
                    left: size / 2 - facetW / 2,
                    width: isGlint ? facetW * 1.5 : facetW,
                    height: isGlint ? facetH * 1.35 : facetH,
                    borderRadius: facetW,
                    backgroundColor: `rgb(${c[0]}, ${c[1]}, ${c[2]})`,
                    opacity: 0.55 + 0.45 * shade,
                    boxShadow: isGlint
                      ? [boxShadow("#FFFFFF", spec, 8), boxShadow("#FFFFFF", spec * 0.8, 3)].join(", ")
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
