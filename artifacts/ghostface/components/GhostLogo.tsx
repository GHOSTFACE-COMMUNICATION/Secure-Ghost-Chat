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
// A press held longer than this counts as a HOLD (brake the coin) rather than
// a TAP, and `onTap` is suppressed on release. Matches the home screen's
// previous `delayLongPress={220}` exactly, because that screen's onTap toggles
// the radial menu: without this, every attempt to grab the spinning coin and
// stop it would also fling the menu open. Callers whose onTap is harmless
// (onboarding's reward reveal) are unaffected — they simply never hold.
const HOLD_THRESHOLD_MS = 220;

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
  /** Coin mode only. Multiplier on the warm-white halo behind the coin.
   *  1 is the onboarding hero's value and the default. The home screen runs
   *  hotter because the coin sits inside the radial menu, where the halo also
   *  has to lift the surrounding glass buttons off the black — on the
   *  onboarding hero the coin is alone on an empty field and the same
   *  intensity reads as a blown-out bloom. One definition, one number, rather
   *  than two halos that drift apart. */
  glow?: number;
}

/**
 * Warm white, not pure white. The coin's light should read as a warm bulb on
 * silver rather than a cold LED, and the home screen's coin uses the same
 * value so both coins are lit by the same source.
 */
// Module-private: the home screen used to import this, but its coin dropped
// the warm halo for a plain white one and now shares nothing with onboarding.
const COIN_GLOW_WARM_WHITE = "#FFF6E8";

/**
 * The diamond-cut milled edge, shared by the onboarding coin and the home
 * screen's radial coin.
 *
 * It lived inline in the coin below while the home screen had a plain silver
 * ring, which is why the two never matched. Extracted rather than copied: the
 * directional-lighting maths is the whole reason this reads as metal instead
 * of a dashed circle, and a second copy would drift the first time either got
 * tuned.
 *
 * `rim` is the ring thickness the facets sit on — facet height derives from
 * it, so passing the coin's real rim keeps the cuts proportional at any size.
 */
// Module-private for the same reason: the home coin no longer has a milled
// edge, so this is the onboarding coin's alone.
function CoinFacetRing({ size, rim }: { size: number; rim: number }) {
  // Thin sparkling diamond edge: fine high-contrast facets with a brighter
  // glint every few facets — the sparkle carries it, not thickness.
  // More cuts at half the depth: a real diamond-cut edge is a dense band of
  // shallow flats, and 132 x (rim * 2.1) read as a chunky reeded rim rather
  // than a cut edge.
  const facetCount = 168;
  const facetR = size / 2 - rim / 2;
  // Derive facet width from the actual pitch so the cuts nearly touch,
  // separated only by a thin dark line. A fixed width leaves gaps that read
  // as a bead chain rather than milled reeding — at 132 facets on a 180pt
  // coin the pitch is ~4.2pt, so a 1.5pt facet was only ~35% duty cycle.
  const facetPitch = (2 * Math.PI * facetR) / facetCount;
  // Narrower than the old 0.72 duty cycle: at half depth a facet as wide as
  // it is tall stops reading as a cut and starts reading as a bead.
  const facetW = Math.max(0.9, facetPitch * 0.55);
  // Shallower again: was rim * 2.1, then rim * 1.05. A cut edge is a thin
  // bright line, and depth is what made it read as a chunky reeded rim.
  const facetH = rim * 0.55;
  // diamond-cut milled edge
  return (
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
        // Per-facet tilt. Without this every cut faces the same way, the
        // light sweeps them in perfect order, and the result is machined
        // reeding — a silver coin edge, not a diamond cut. Real cut stones
        // sparkle irregularly: neighbours sit at different angles, so one
        // blazes while the one beside it stays dark. Deterministic (a hashed
        // sine of the index) so it does not shimmer between renders.
        const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
        const tilt = (jitter - 0.5) * 1.15;
        const facing = Math.cos(theta - LIGHT + tilt); // -1 (away) .. 1 (toward)
        // Tighter falloff than a matte surface: a cut flat is near-mirror,
        // so it stays dark until it swings close to the light and then comes
        // up fast. That is most of what separates a cut edge from brushed
        // metal.
        const lit = Math.pow(Math.max(0, facing), 2.4);
        // Alternating cut faces: every other facet is the opposing
        // flank of the groove, so it catches noticeably less light.
        const flank = i % 2 === 0 ? 1 : 0.24;
        const shade = lit * flank;
        // Specular: a tight highlight only where a facet points almost
        // straight at the light, so sparkle is localised instead of
        // sprinkled evenly around the circumference.
        const spec = Math.pow(Math.max(0, facing), 40);
        // No `i % 2` gate: which facet catches the light is now decided by its
        // own tilt, not by its parity, which is the whole point.
        const isGlint = spec > 0.16;
        // Blend near-black → warm steel → white with the shade term.
        // True black -> white. The old floor (22,22,30) never let the
        // grooves go properly dark, which flattened the whole band.
        const lo = [5, 6, 10];
        const hi = [255, 255, 255];
        const c = lo.map((v, k) => Math.round(v + (hi[k] - v) * shade));
        // Dispersion: a cut edge splits light, so the flank leading into the
        // source skews warm and the one falling away skews cool. A couple of
        // levels only, but it stops the sparkle reading as grey plastic.
        const disp = Math.sin(theta - LIGHT + tilt) * 34 * shade;
        c[0] = Math.max(0, Math.min(255, Math.round(c[0] + disp)));
        c[2] = Math.max(0, Math.min(255, Math.round(c[2] - disp)));
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              top: size / 2 - facetH / 2,
              left: size / 2 - facetW / 2,
              width: isGlint ? facetW * 1.5 : facetW,
              height: isGlint ? facetH * 1.35 : facetH,
              // Square corners. `borderRadius: facetW` fully rounded a facet
              // this small, turning every cut into a dot — the bead chain the
              // duty-cycle note above warns about. A diamond cut has hard
              // edges; that is what catches the light.
              borderRadius: 0,
              backgroundColor: `rgb(${c[0]}, ${c[1]}, ${c[2]})`,
              opacity: 0.55 + 0.45 * shade,
              // A crisp lit lip along the top of each flat. An inset shadow
              // keeps this at one view per facet; a second view for the
              // highlight would double an already 168-view ring.
              boxShadow: isGlint
                ? [
                    boxShadow(COIN_GLOW_WARM_WHITE, spec, 8),
                    boxShadow(COIN_GLOW_WARM_WHITE, spec * 0.8, 3),
                    `inset 0 ${facetH * 0.22}px 0 rgba(255,255,255,${(0.55 * shade).toFixed(3)})`,
                  ].join(", ")
                : shade > 0.12
                  ? `inset 0 ${facetH * 0.22}px 0 rgba(255,255,255,${(0.4 * shade).toFixed(3)})`
                  : undefined,
              transform: [{ rotate: `${(360 / facetCount) * i}deg` }, { translateY: -facetR }],
            }}
          />
        );
      })}
    </View>
  );
}

export function GhostLogo({ size = 64, coin = false, onTap, live = false, glow = 1 }: GhostLogoProps) {
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
  // When the current press began, for the tap-vs-hold decision on release.
  const pressStartMs = useRef(0);

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
        pressStartMs.current = Date.now();
        if (coin) {
          // In live mode the press brakes the coin and the tap adds a velocity
          // kick, exactly as on the home screen. The fixed three-turn flip is
          // only for the static coin.
          if (liveRef.current) { holding.current = true; kick(); }
          else { flip(); }
          // NOTE: onTap deliberately does NOT fire here. It fires on RELEASE,
          // and only if the press was short enough to be a tap — see
          // HOLD_THRESHOLD_MS. Firing on press-down made it impossible to hold
          // the coin without also triggering the tap action.
        }
        Animated.spring(scale, {
          toValue: 1.06,
          useNativeDriver: true,
          speed: 30,
          bounciness: 8,
        }).start();
      },

      onPanResponderRelease: () => {
        const heldMs = Date.now() - pressStartMs.current;
        holding.current = false;
        // A tap acts; a hold only brakes. The kick and the brake already
        // happened on press-down, so a hold still feels immediate — it just
        // doesn't fire the caller's action on the way out.
        if (coin && heldMs < HOLD_THRESHOLD_MS) onTap?.();
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 20,
          bounciness: 4,
        }).start();
      },

      onPanResponderTerminate: () => {
        // Terminated, not released — the gesture was taken over (a scroll, a
        // navigation). Never fire onTap on this path: the user did not
        // complete the tap.
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
            backgroundColor: `rgba(255,246,232,${Math.min(0.035 * glow, 1)})`,
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
              // `glow` scales all three together so the falloff keeps its
              // shape; scaling only the core would just add a hard disc.
              // Clamped at 1 — an alpha above 1 is invalid, not brighter.
              boxShadow(COIN_GLOW_WARM_WHITE, Math.min(0.13 * glow, 1), size * 0.42),
              boxShadow(COIN_GLOW_WARM_WHITE, Math.min(0.16 * glow, 1), size * 0.20),
              boxShadow(COIN_GLOW_WARM_WHITE, Math.min(0.14 * glow, 1), size * 0.08),
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
            boxShadow: [boxShadow(COIN_GLOW_WARM_WHITE, 0.5, 14), "inset 0 0 4px rgba(20,20,24,0.7)"].join(", "),
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
              boxShadow(COIN_GLOW_WARM_WHITE, 0.5, 20),
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
          <CoinFacetRing size={size} rim={rim} />
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
