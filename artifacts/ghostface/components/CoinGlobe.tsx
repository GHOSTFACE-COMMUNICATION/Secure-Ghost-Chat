import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  RoundedRect,
  Image as SkiaImage,
  RadialGradient,
  useImage,
  vec,
} from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

const GHOST_MARK = require("@/assets/images/ghostface-mark-gold.webp");

/**
 * The coin: sphere shading over the glass body, and the trademark flipping on
 * top.
 *
 * This file previously also carried a triangulated wireframe, a 46-mark
 * lattice, scanlines and chromatic fringing. All removed — the effects stacked
 * up busier than the object they were decorating. What earns its place:
 *
 *   GlobeShade    — the LIGHT. Specular and limb darkening. View-space, so it
 *                   must never rotate: a ball lit from the upper left keeps its
 *                   highlight upper left however fast it turns. This is the
 *                   thing that makes a flat disc read as round.
 *   GlobeCoinMark — the trademark, flipping like a coin.
 */

/**
 * Specular highlight and limb darkening. Drawn over the glass body and NOT
 * rotated — see above.
 */
export function GlobeShade({ size }: { size: number }) {
  const R = size / 2;
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      {/* Limb darkening: the edge of a sphere turns away from the viewer, so it
          falls off hard. Without this the disc has no roundness at all. */}
      <Circle cx={R} cy={R} r={R}>
        <RadialGradient
          c={vec(R, R)}
          r={R}
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0)", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.85)"]}
          positions={[0, 0.62, 0.9, 1]}
        />
      </Circle>
      {/* Specular: tight, offset up-left, the same light the halo behind the
          coin already assumes. */}
      <Circle cx={R} cy={R} r={R}>
        <RadialGradient
          c={vec(R * 0.62, R * 0.5)}
          r={R * 0.95}
          colors={["rgba(255,247,232,0.46)", "rgba(255,247,232,0.12)", "rgba(255,247,232,0)"]}
          positions={[0, 0.42, 1]}
        />
      </Circle>
      {/* A thin bright rim on the lit side only. A full ring would read as a
          drawn outline rather than a lit body. */}
      <Group>
        <Circle cx={R} cy={R} r={R - 1.1} style="stroke" strokeWidth={2.8}>
          <RadialGradient
            c={vec(R * 0.5, R * 0.35)}
            r={R * 1.6}
            colors={["rgba(255,250,240,0.72)", "rgba(255,250,240,0.1)"]}
            positions={[0, 1]}
          />
        </Circle>
      </Group>
    </Canvas>
  );
}

/**
 * The coin's edge — its thickness, seen as it turns.
 *
 * Geometry of a rotating disc: the face is squashed to D*|cos| while the rim
 * presents t*|sin|, so the edge is widest exactly when the faces have
 * vanished. Driving both from the same angle is what makes the flip read as a
 * solid object rather than an image being scaled.
 */
export function CoinEdge({
  size,
  phase,
  thickness = 15,
}: {
  size: number;
  phase: SharedValue<number>;
  thickness?: number;
}) {
  const R = size / 2;
  const transform = useDerivedValue(() => {
    "worklet";
    const sn = Math.abs(Math.sin((phase.value * Math.PI) / 180));
    return [{ translateX: R }, { scaleX: Math.max(0.001, sn) }, { translateX: -thickness / 2 }];
  }, [size, thickness]);

  return (
    <Group transform={transform}>
      {/* Slightly shorter than the diameter so the rim meets the face inside
          the silhouette rather than poking past it at the poles. */}
      <RoundedRect x={0} y={size * 0.035} width={thickness} height={size * 0.93} r={thickness / 2}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(thickness, 0)}
          colors={["#1a1a1e", "#8a8a92", "#f2f2f5", "#8a8a92", "#1a1a1e"]}
          positions={[0, 0.22, 0.5, 0.78, 1]}
        />
      </RoundedRect>
    </Group>
  );
}

/**
 * A two-sided coin: the trademark struck on both faces, handing over at
 * edge-on.
 *
 * scaleX = cos(angle) alone does flip, but past 90 degrees it goes negative and
 * shows the SAME artwork mirrored — a reflection, not a reverse. A struck coin
 * has its own die on the back, correctly oriented. So there are two faces here:
 * the front is drawn while cos is positive, the back while it is negative with
 * the sign taken out, and each is hidden while the other is showing. They swap
 * exactly at cos = 0, which is the instant the coin is edge-on and infinitely
 * thin, so the handover is invisible.
 *
 * Drawn in Skia off the same shared value the coin physics writes, rather than
 * as an RN Animated.Image. Animated drives from the JS thread, competing with
 * the 60fps physics loop, while Skia runs on the UI thread — the same angle
 * delivered by two schedulers showed up as the mark drifting against its own
 * coin. One value, one thread, so they cannot drift by construction.
 */
export function GlobeCoinMark({
  size,
  phase,
  // Bounded by the circle, not by taste. The mark is taller than it is wide
  // (952x1232), so the box diagonal is what binds: sqrt(1 + 0.773^2) = 1.264,
  // meaning a box taller than D/1.264 has its widest content clipped by the
  // rim. At 1.18 that clipped the N and its arcs, which sit furthest right in
  // the artwork — they were being cut off every revolution.
  scale = 0.79,
  opacity = 0.95,
}: {
  size: number;
  phase: SharedValue<number>;
  scale?: number;
  opacity?: number;
}) {
  const img = useImage(GHOST_MARK);
  const R = size / 2;
  const h = size * scale;
  const w = h * (952 / 1232);

  const frontTransform = useDerivedValue(() => {
    "worklet";
    const c = Math.cos((phase.value * Math.PI) / 180);
    return [
      { translateX: R },
      { translateY: R },
      { scaleX: Math.max(0, c) },
      { translateX: -w / 2 },
      { translateY: -h / 2 },
    ];
  }, [size, scale]);

  // Sign removed, so the reverse die reads the right way round rather than as
  // a mirror of the obverse.
  const backTransform = useDerivedValue(() => {
    "worklet";
    const c = Math.cos((phase.value * Math.PI) / 180);
    return [
      { translateX: R },
      { translateY: R },
      { scaleX: Math.max(0, -c) },
      { translateX: -w / 2 },
      { translateY: -h / 2 },
    ];
  }, [size, scale]);

  const frontOpacity = useDerivedValue(() => {
    "worklet";
    return Math.cos((phase.value * Math.PI) / 180) >= 0 ? opacity : 0;
  }, [opacity]);

  const backOpacity = useDerivedValue(() => {
    "worklet";
    return Math.cos((phase.value * Math.PI) / 180) < 0 ? opacity : 0;
  }, [opacity]);

  if (!img) return null;
  return (
    <>
      <Group transform={frontTransform} opacity={frontOpacity}>
        <SkiaImage image={img} x={0} y={0} width={w} height={h} fit="contain" />
      </Group>
      <Group transform={backTransform} opacity={backOpacity}>
        <SkiaImage image={img} x={0} y={0} width={w} height={h} fit="contain" />
      </Group>
    </>
  );
}
