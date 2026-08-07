import React, { useEffect } from "react";
import { View } from "react-native";
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Image as SkiaImage,
  LinearGradient,
  Rect,
  RoundedRect,
  Skia,
  SweepGradient,
  useImage,
  vec,
} from "@shopify/react-native-skia";
import {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { GOLD_METALLIC, GOLD_METALLIC_LOCATIONS } from "@/components/GoldGradient";

const GHOST_MARK = require("@/assets/images/ghostlogo.png");

// Never collapse to a literal zero-width line — reads as "disappeared", not "edge-on".
const MIN_SCALE = 0.06;

// Holographic sweep palette — gold anchors it to the brand, the rest gives
// the iridescent/CD-sheen "mind blowing" quality a flat gold coin can't have.
const HOLO_COLORS = ["#f4e2a1", "#ff9ecb", "#9ad8ff", "#c9a8ff", "#f4e2a1"] as const;

export function GhostCoin({
  size = 184,
  spinDurationMs = 9000,
  active = true,
  boosting = false,
}: {
  size?: number;
  spinDurationMs?: number;
  active?: boolean;
  /** True during a tap-triggered speed burst — intensifies the holographic
   * sheen and flashes an outer ring so the burst actually reads as an event,
   * not just "spinning a bit faster". */
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
  // Past 90° the ghost gives way to the plain gold back (not a mirrored ghost).
  const frontOpacity = useDerivedValue(() => (Math.cos(angle.value) >= 0 ? 1 : 0));
  const backOpacity = useDerivedValue(() => 1 - frontOpacity.value);
  const rimWidth = useDerivedValue(() =>
    interpolate(scaleMagnitude.value, [MIN_SCALE, 1], [size * 0.1, 0], Extrapolation.CLAMP),
  );
  const bodyTransform = useDerivedValue(() => [{ scaleX: scaleMagnitude.value }]);
  const rimX = useDerivedValue(() => size / 2 - rimWidth.value / 2);
  const rimR = useDerivedValue(() => rimWidth.value / 2);

  // Holographic film spins faster than the coin itself (and faster still
  // while boosting) so its colors visibly cycle rather than just riding
  // along with the coin's own rotation.
  const holoTransform = useDerivedValue(() => [
    { rotate: angle.value * (2.2 + boost.value * 1.8) },
  ]);
  const holoOpacity = useDerivedValue(() => interpolate(boost.value, [0, 1], [0.3, 0.72]));
  const burstRingOpacity = useDerivedValue(() => boost.value * 0.65);
  const burstRingScale = useDerivedValue(() => 1 + boost.value * 0.1);
  const burstRingTransform = useDerivedValue(() => [{ scale: burstRingScale.value }]);

  const r = size / 2;
  const origin = { x: r, y: r };
  const circleClip = Skia.RRectXY(Skia.XYWHRect(0, 0, size, size), r, r);
  const faceInset = size * 0.16;

  if (!image) {
    return <View style={{ width: size, height: size }} />;
  }

  return (
    <Canvas style={{ width: size, height: size }}>
      {/* Soft contact shadow underneath — separate from the clipped group so
          it isn't cut off by the coin's own circle clip. */}
      <Circle cx={r} cy={r + size * 0.05} r={r * 0.86} color="rgba(0,0,0,0.35)">
        <BlurMask blur={size * 0.06} style="normal" />
      </Circle>

      <Group clip={circleClip}>
        {/* Body and face squish together so the whole coin thins, not just the face. */}
        <Group transform={bodyTransform} origin={origin}>
          {/* Glass body: translucent gold-tinted fill (not solid metal) so the
              coin reads as glass with a gold cast, rather than opaque metal. */}
          <Circle cx={r} cy={r} r={r} opacity={0.28}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(size, size)}
              colors={[...GOLD_METALLIC]}
              positions={[...GOLD_METALLIC_LOCATIONS]}
            />
          </Circle>
          {/* Frosted diffusion layer underneath the face — this is what gives
              the "seen through glass" softness rather than a crisp decal. */}
          <Circle cx={r} cy={r} r={r} color="rgba(255,255,255,0.05)">
            <BlurMask blur={size * 0.05} style="normal" />
          </Circle>

          {/* Ghost mark: dimmer + softer-blurred than a printed logo would be,
              since it's reading through translucent glass, not sitting on top. */}
          <Group opacity={frontOpacity} layer>
            <SkiaImage
              image={image}
              x={faceInset}
              y={faceInset}
              width={size - faceInset * 2}
              height={size - faceInset * 2}
              fit="contain"
              opacity={0.38}
            >
              <BlurMask blur={3.5} style="normal" />
            </SkiaImage>
            <Circle cx={r} cy={r} r={r} blendMode="colorDodge" opacity={0.14}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(size, size)}
                colors={["#f4e2a1", "#9a7a24"]}
              />
            </Circle>
          </Group>

          {/* Back of coin: dimmer gold glass, embossed with concentric rings. */}
          <Group opacity={backOpacity}>
            <Circle cx={r} cy={r} r={r} opacity={0.22}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(size, size)}
                colors={[...GOLD_METALLIC]}
                positions={[...GOLD_METALLIC_LOCATIONS]}
              />
            </Circle>
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

        {/* Holographic film: a rainbow-tinted sweep gradient that spins
            independently of the coin (faster still while boosting), so the
            colors visibly cycle across the surface rather than just riding
            along with the coin's own rotation. This is the "mind blowing"
            layer — flat gold alone can't do this. */}
        <Group transform={holoTransform} origin={origin}>
          <Circle cx={r} cy={r} r={r} blendMode="plus" opacity={holoOpacity}>
            <SweepGradient c={vec(r, r)} colors={[...HOLO_COLORS]} />
          </Circle>
        </Group>

        {/* Fresnel-style edge brightening — glass reads brightest right at its
            rim, where light grazes the surface at a steep angle. A plain flat
            fill has none of this, which is what read as "metal" not "glass". */}
        <Circle cx={r} cy={r} r={r} style="stroke" strokeWidth={size * 0.05} opacity={0.5}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(size, size)}
            colors={["rgba(255,255,255,0.05)", "rgba(255,250,230,0.65)", "rgba(255,255,255,0.05)"]}
          />
        </Circle>

        {/* Two crossed specular streaks instead of one flat diagonal band —
            a single sheen reads as brushed metal, two crossing ones read as
            curved-glass reflections of two separate light sources. */}
        <Rect x={0} y={0} width={size} height={size} blendMode="plus" opacity={0.5}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(size, size)}
            colors={["rgba(255,255,255,0)", "rgba(255,246,214,0.7)", "rgba(255,255,255,0)"]}
            positions={[0.12, 0.38, 0.62]}
          />
        </Rect>
        <Rect x={0} y={0} width={size} height={size} blendMode="plus" opacity={0.22}>
          <LinearGradient
            start={vec(size, 0)}
            end={vec(0, size)}
            colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.5)", "rgba(255,255,255,0)"]}
            positions={[0.55, 0.72, 0.86]}
          />
        </Rect>

        {/* Edge rim: unsquished, widens as the body's scaleX shrinks. Kept as
            solid gold metal (not glass) — a glass coin with a metal bezel is
            more physically believable than glass all the way to the edge,
            and keeps the gold trademark color anchored somewhere solid. */}
        <RoundedRect
          x={rimX}
          y={size * 0.02}
          width={rimWidth}
          height={size * 0.96}
          r={rimR}
        >
          <LinearGradient
            start={vec(0, 0)}
            end={vec(size, 0)}
            colors={["#9a7a24", "#f4e2a1", "#d9b84a", "#9a7a24"]}
            positions={[0, 0.4, 0.6, 1]}
          />
        </RoundedRect>

        {/* Burst ring: flashes just inside the coin's own edge on a tap.
            Deliberately inset (not protruding past the coin) so it can
            never get clipped by the canvas's own bounds — this is what
            makes a tap read as an actual event, not just a speed change
            you have to notice on your own. */}
        <Group transform={burstRingTransform} origin={origin}>
          <Circle
            cx={r}
            cy={r}
            r={r * 0.88}
            style="stroke"
            strokeWidth={size * 0.025}
            opacity={burstRingOpacity}
            color="#ffe9b8"
          >
            <BlurMask blur={size * 0.012} style="normal" />
          </Circle>
        </Group>
      </Group>
    </Canvas>
  );
}
