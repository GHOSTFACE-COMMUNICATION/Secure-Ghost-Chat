import React, { forwardRef, useEffect, useImperativeHandle } from "react";
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
import { cancelAnimation, useDerivedValue, useSharedValue, withDecay } from "react-native-reanimated";
import { GOLD_METALLIC } from "@/components/GoldGradient";

// Same real designed artwork the lock screen's GhostRevealMark uses. A
// React Three Fiber / real-3D-glass version of this component was tried
// (physically-lit meshPhysicalMaterial, WebGL cylinder) but crashed on
// device reaching this screen, twice, with no way to get a crash log to
// diagnose precisely — reverted to this Skia 2D canvas, which has been
// stable all along. The flat in-plane spin (rotate, not the old scaleX
// "edge-on flip" squish) is the fix that was actually needed: the squish
// animated correctly but never read as "spinning" to a viewer.
const GHOST_MARK = require("@/assets/images/ghostface-mark-gold.webp");

// Tuned for withDecay's per-second velocity convention — a full turn is
// 2π rad, so ~10 rad/s starts around 1.5 turns/s before friction takes over.
const FLICK_VELOCITY = 10;
const DECELERATION = 0.997;

export interface GhostCoinHandle {
  /** Impart a spin — call on tap. Physics-based (friction decay), not a
   * fixed-duration tween — matches an actually-flicked object rather than
   * a canned "speed up for N seconds" animation. */
  flick: () => void;
}

export const GhostCoin = forwardRef<
  GhostCoinHandle,
  { size?: number; held?: boolean; active?: boolean }
>(function GhostCoin({ size = 184, held = false, active = true }, ref) {
  const image = useImage(GHOST_MARK);
  const angle = useSharedValue(0);

  useImperativeHandle(ref, () => ({
    flick: () => {
      angle.value = withDecay({ velocity: FLICK_VELOCITY, deceleration: DECELERATION });
    },
  }));

  // Holding stops it dead where it is (matches "hold to stop"); losing
  // focus/going inactive does the same, for the same reason the old
  // version paused its loop off-screen — nothing to animate if no one's
  // looking.
  useEffect(() => {
    if (held || !active) cancelAnimation(angle);
  }, [held, active, angle]);

  const r = size / 2;
  const origin = { x: r, y: r };
  const circleClip = Skia.RRectXY(Skia.XYWHRect(0, 0, size, size), r, r);
  const markInset = size * 0.12;
  // Flat, in-plane rotation — like a fidget spinner, not a coin flipping
  // to show its edge. No front/back flip needed: a flat-spinning disk
  // always shows its face, so the mark stays visible through the whole turn.
  const bodyTransform = useDerivedValue(() => [{ rotate: angle.value }]);

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
              out bright, so the real mark artwork on top stays legible. */}
          <Circle cx={r} cy={r} r={r}>
            <RadialGradient
              c={vec(r, r)}
              r={r}
              colors={["#e8c874", GOLD_METALLIC[2], "#5c4713"]}
              positions={[0, 0.6, 1]}
            />
          </Circle>

          {/* The real mark — full opacity, no blur. Trust the artwork. */}
          <SkiaImage
            image={image}
            x={markInset}
            y={markInset}
            width={size - markInset * 2}
            height={size - markInset * 2}
            fit="contain"
          />
        </Group>

        {/* Single specular highlight — one clean sheen, not stacked
            additive layers (which is what caused an earlier version to
            blow out to a white blob in photos). */}
        <Circle cx={r * 0.62} cy={r * 0.55} r={r * 0.28} color="rgba(255,252,235,0.35)">
          <BlurMask blur={size * 0.09} style="normal" />
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
});
