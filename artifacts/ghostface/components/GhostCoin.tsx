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

export function GhostCoin({
  size = 184,
  spinDurationMs = 9000,
  active = true,
}: {
  size?: number;
  spinDurationMs?: number;
  active?: boolean;
}) {
  const image = useImage(GHOST_MARK);
  const progress = useSharedValue(0);

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

  const r = size / 2;
  const origin = { x: r, y: r };
  const circleClip = Skia.RRectXY(Skia.XYWHRect(0, 0, size, size), r, r);
  const faceInset = size * 0.16;

  if (!image) {
    return <View style={{ width: size, height: size }} />;
  }

  return (
    <Canvas style={{ width: size, height: size }}>
      <Group clip={circleClip}>
        {/* Body and face squish together so the whole coin thins, not just the face. */}
        <Group transform={bodyTransform} origin={origin}>
          <Circle cx={r} cy={r} r={r}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(size, size)}
              colors={[...GOLD_METALLIC]}
              positions={[...GOLD_METALLIC_LOCATIONS]}
            />
          </Circle>

          {/* Smoky front face: blur + reduced opacity + gold tint. */}
          <Group opacity={frontOpacity} layer>
            <SkiaImage
              image={image}
              x={faceInset}
              y={faceInset}
              width={size - faceInset * 2}
              height={size - faceInset * 2}
              fit="contain"
              opacity={0.5}
            >
              <BlurMask blur={2.5} style="normal" />
            </SkiaImage>
            <Circle cx={r} cy={r} r={r} blendMode="colorDodge" opacity={0.16}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(size, size)}
                colors={["#f4e2a1", "#9a7a24"]}
              />
            </Circle>
          </Group>

          {/* Back of coin: plain gold, embossed with concentric rings. */}
          <Group opacity={backOpacity}>
            <Circle
              cx={r}
              cy={r}
              r={r * 0.74}
              style="stroke"
              strokeWidth={2}
              color="rgba(0,0,0,0.35)"
            />
            <Circle
              cx={r}
              cy={r}
              r={r * 0.5}
              style="stroke"
              strokeWidth={1.5}
              color="rgba(0,0,0,0.25)"
            />
          </Group>
        </Group>

        {/* Fixed diagonal highlight — outside the squish so it's never lost edge-on. */}
        <Rect x={0} y={0} width={size} height={size} blendMode="plus" opacity={0.4}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(size, size)}
            colors={["rgba(255,255,255,0)", "rgba(255,246,214,0.55)", "rgba(255,255,255,0)"]}
            positions={[0.15, 0.42, 0.68]}
          />
        </Rect>

        {/* Edge rim: unsquished, widens as the body's scaleX shrinks. */}
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
      </Group>
    </Canvas>
  );
}
