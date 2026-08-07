import React, { useEffect, useMemo } from "react";
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Oval,
  Path,
  RadialGradient,
  RoundedRect,
  Skia,
  vec,
} from "@shopify/react-native-skia";
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { GOLD_METALLIC } from "@/components/GoldGradient";

// Never collapse to a literal zero-width line — reads as "disappeared", not "edge-on".
const MIN_SCALE = 0.06;

/**
 * Faceted/geodesic-sphere gold orb with horizontal energy-band rings that
 * emerge as it spins edge-on — replaces an earlier flat ghost-logo coin
 * that read as "the same coin, slightly different colour" no matter how
 * much visual detail got layered onto it. Deliberately no rainbow/holo
 * tint anywhere: the reference this is built from is consistently warm
 * gold, not iridescent.
 */
export function GhostCoin({
  size = 184,
  spinDurationMs = 9000,
  active = true,
  boosting = false,
}: {
  size?: number;
  spinDurationMs?: number;
  active?: boolean;
  /** True during a tap-triggered speed burst — brightens the core and
   * flashes a ring so the burst reads as an actual event. */
  boosting?: boolean;
}) {
  const progress = useSharedValue(0);
  const boost = useSharedValue(0);

  useEffect(() => {
    if (active) {
      progress.value = withRepeat(
        withTiming(1, { duration: spinDurationMs, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(progress);
    }
    return () => cancelAnimation(progress);
  }, [active, spinDurationMs, progress]);

  useEffect(() => {
    boost.value = withTiming(boosting ? 1 : 0, { duration: 280, easing: Easing.out(Easing.quad) });
  }, [boosting, boost]);

  const angle = useDerivedValue(() => progress.value * Math.PI * 2);
  const scaleMagnitude = useDerivedValue(() =>
    Math.max(Math.abs(Math.cos(angle.value)), MIN_SCALE),
  );
  const edgeOnAmount = useDerivedValue(() => 1 - scaleMagnitude.value);
  const bodyTransform = useDerivedValue(() => [{ scaleX: scaleMagnitude.value }]);

  const burstRingOpacity = useDerivedValue(() => boost.value * 0.7);
  const burstRingScale = useDerivedValue(() => 1 + boost.value * 0.1);
  const burstRingTransform = useDerivedValue(() => [{ scale: burstRingScale.value }]);
  const coreBoostOpacity = useDerivedValue(() => boost.value * 0.5);

  const r = size / 2;
  const origin = { x: r, y: r };
  const circleClip = Skia.RRectXY(Skia.XYWHRect(0, 0, size, size), r, r);

  // Static wireframe (concentric rings + radial spokes) evoking a faceted
  // geodesic sphere — built once, then spins along with the coin via the
  // same transform as everything else, no per-frame recomputation needed.
  const wireframePath = useMemo(() => {
    const path = Skia.Path.Make();
    [0.3, 0.56, 0.8].forEach((f) => path.addCircle(r, r, r * f));
    const spokes = 8;
    for (let i = 0; i < spokes; i++) {
      const theta = (i / spokes) * Math.PI * 2;
      path.moveTo(r, r);
      path.lineTo(r + Math.cos(theta) * r, r + Math.sin(theta) * r);
    }
    return path;
  }, [r]);

  // Horizontal energy-band rings — narrow near the "poles", widest at the
  // "equator", brightest when the coin is edge-on (mid-spin), matching the
  // torpedo/gyroscope look the reference shows during rotation.
  const bands = useMemo(
    () =>
      [
        { dy: -0.42, rx: 0.55, ry: 0.09 },
        { dy: -0.18, rx: 0.82, ry: 0.13 },
        { dy: 0, rx: 0.94, ry: 0.15 },
        { dy: 0.18, rx: 0.82, ry: 0.13 },
        { dy: 0.42, rx: 0.55, ry: 0.09 },
      ].map((b) => ({
        x: r - b.rx * r,
        y: r + b.dy * r - b.ry * r,
        width: b.rx * r * 2,
        height: b.ry * r * 2,
      })),
    [r],
  );
  const bandOpacity = useDerivedValue(() => 0.15 + edgeOnAmount.value * 0.75);

  return (
    <Canvas style={{ width: size, height: size }}>
      {/* Soft outer halo — separate from the clipped group so it isn't cut
          off by the coin's own circle clip. */}
      <Circle cx={r} cy={r} r={r * 1.08} color="rgba(244,226,161,0.12)">
        <BlurMask blur={size * 0.08} style="normal" />
      </Circle>
      {/* Contact shadow underneath, for grounding/depth. */}
      <Circle cx={r} cy={r + size * 0.05} r={r * 0.86} color="rgba(0,0,0,0.35)">
        <BlurMask blur={size * 0.06} style="normal" />
      </Circle>

      <Group clip={circleClip}>
        <Group transform={bodyTransform} origin={origin}>
          {/* Glowing core: bright warm center fading to deep bronze at the
              rim — this is what reads as "an energy core", not a flat coin. */}
          <Circle cx={r} cy={r} r={r}>
            <RadialGradient
              c={vec(r, r)}
              r={r}
              colors={["#fff6dc", "#f4e2a1", GOLD_METALLIC[2], "#4a3a10"]}
              positions={[0, 0.35, 0.75, 1]}
            />
          </Circle>

          {/* Faceted wireframe overlay — the geodesic/faceted-sphere detail. */}
          <Path path={wireframePath} style="stroke" strokeWidth={1} color="rgba(40,28,4,0.4)" />

          {/* Extra brightness pulse on tap-boost. */}
          <Circle cx={r} cy={r} r={r * 0.55} color="#fff8e6" opacity={coreBoostOpacity}>
            <BlurMask blur={size * 0.08} style="normal" />
          </Circle>
        </Group>

        {/* Horizontal energy bands — unsquished; their own dy/rx/ry already
            encode the "torpedo" silhouette, so they don't also need the
            body's scaleX applied on top. */}
        {bands.map((b, i) => (
          <Oval
            key={i}
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            style="stroke"
            strokeWidth={size * 0.012}
            color="#f4e2a1"
            opacity={bandOpacity}
          />
        ))}

        {/* Single specular highlight — one clean sheen, not stacked additive
            layers (which is what was clipping to a blown-out white blob). */}
        <Circle cx={r * 0.62} cy={r * 0.55} r={r * 0.28} color="rgba(255,252,235,0.5)">
          <BlurMask blur={size * 0.09} style="normal" />
        </Circle>
      </Group>

      {/* Burst ring: flashes just inside the coin's own edge on a tap —
          deliberately inset so it can never get clipped by the canvas's
          own bounds regardless of layout. */}
      <Group transform={burstRingTransform} origin={origin} clip={circleClip}>
        <Circle
          cx={r}
          cy={r}
          r={r * 0.88}
          style="stroke"
          strokeWidth={size * 0.025}
          opacity={burstRingOpacity}
          color="#fff6dc"
        >
          <BlurMask blur={size * 0.012} style="normal" />
        </Circle>
      </Group>

      {/* Edge rim: thin metal bezel, unsquished. */}
      <RoundedRect x={0} y={size * 0.02} width={size} height={size * 0.96} r={r} style="stroke" strokeWidth={size * 0.02}>
        <RadialGradient c={vec(r, r)} r={r} colors={["#9a7a24", "#f4e2a1", "#9a7a24"]} />
      </RoundedRect>
    </Canvas>
  );
}
