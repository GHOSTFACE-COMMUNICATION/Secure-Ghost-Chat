import React, { useEffect } from "react";
import { View } from "react-native";
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Image as SkiaImage,
  RadialGradient,
  RoundedRect,
  Skia,
  useImage,
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

// The real designed mark (hooded ghost, faceted geodesic face, NFC glyph) —
// same asset the lock screen's GhostRevealMark uses. Everything before this
// was trying to hand-draw an approximation of this artwork from primitive
// shapes (gradients, wireframe paths, ovals) instead of just using it, which
// is why every earlier version read as vague/washed-out no matter how much
// detail got layered on: no amount of procedural shading beats real art.
const GHOST_MARK = require("@/assets/images/ghostface-mark-gold.webp");

// Never collapse to a literal zero-width line — reads as "disappeared", not "edge-on".
const MIN_SCALE = 0.06;

export function GhostCoin({
  size = 184,
  spinDurationMs = 9000,
  active = true,
  boosting = false,
}: {
  size?: number;
  spinDurationMs?: number;
  active?: boolean;
  /** True during a tap-triggered speed burst — flashes a ring so the burst
   * reads as an actual event, not just a subtle rate change. */
  boosting?: boolean;
}) {
  const image = useImage(GHOST_MARK);
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
  // Past 90° the mark gives way to the plain gold back (not a mirrored mark).
  const frontOpacity = useDerivedValue(() => (Math.cos(angle.value) >= 0 ? 1 : 0));
  const backOpacity = useDerivedValue(() => 1 - frontOpacity.value);
  const bodyTransform = useDerivedValue(() => [{ scaleX: scaleMagnitude.value }]);

  const burstRingOpacity = useDerivedValue(() => boost.value * 0.7);
  const burstRingScale = useDerivedValue(() => 1 + boost.value * 0.1);
  const burstRingTransform = useDerivedValue(() => [{ scale: burstRingScale.value }]);

  const r = size / 2;
  const origin = { x: r, y: r };
  const circleClip = Skia.RRectXY(Skia.XYWHRect(0, 0, size, size), r, r);
  const markInset = size * 0.12;

  if (!image) {
    return <View style={{ width: size, height: size }} />;
  }

  return (
    <Canvas style={{ width: size, height: size }}>
      {/* Soft outer halo — separate from the clipped group so it isn't cut
          off by the coin's own circle clip. */}
      <Circle cx={r} cy={r} r={r * 1.08} color="rgba(244,226,161,0.14)">
        <BlurMask blur={size * 0.08} style="normal" />
      </Circle>
      {/* Contact shadow underneath, for grounding/depth. */}
      <Circle cx={r} cy={r + size * 0.05} r={r * 0.86} color="rgba(0,0,0,0.35)">
        <BlurMask blur={size * 0.06} style="normal" />
      </Circle>

      <Group clip={circleClip}>
        <Group transform={bodyTransform} origin={origin}>
          {/* Coin body — a moderate gold gradient, deliberately not blown
              out bright, so the real mark artwork on top stays legible
              instead of getting washed out by an overpowering glow. */}
          <Circle cx={r} cy={r} r={r}>
            <RadialGradient
              c={vec(r, r)}
              r={r}
              colors={["#e8c874", GOLD_METALLIC[2], "#5c4713"]}
              positions={[0, 0.6, 1]}
            />
          </Circle>

          {/* The real mark — full opacity, no blur. Trust the artwork. */}
          <Group opacity={frontOpacity}>
            <SkiaImage
              image={image}
              x={markInset}
              y={markInset}
              width={size - markInset * 2}
              height={size - markInset * 2}
              fit="contain"
            />
          </Group>

          {/* Back of coin: plain gold, embossed with concentric rings. */}
          <Group opacity={backOpacity}>
            <Circle
              cx={r}
              cy={r}
              r={r * 0.74}
              style="stroke"
              strokeWidth={2}
              color="rgba(0,0,0,0.3)"
            />
            <Circle
              cx={r}
              cy={r}
              r={r * 0.5}
              style="stroke"
              strokeWidth={1.5}
              color="rgba(0,0,0,0.22)"
            />
          </Group>
        </Group>

        {/* Single specular highlight — one clean sheen, not stacked additive
            layers (which is what caused earlier versions to blow out to a
            white blob in photos). */}
        <Circle cx={r * 0.62} cy={r * 0.55} r={r * 0.28} color="rgba(255,252,235,0.35)">
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
      <RoundedRect
        x={0}
        y={size * 0.02}
        width={size}
        height={size * 0.96}
        r={r}
        style="stroke"
        strokeWidth={size * 0.02}
      >
        <RadialGradient c={vec(r, r)} r={r} colors={["#9a7a24", "#f4e2a1", "#9a7a24"]} />
      </RoundedRect>
    </Canvas>
  );
}
