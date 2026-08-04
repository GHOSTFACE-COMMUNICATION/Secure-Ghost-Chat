import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Image as SkiaImage,
  Path,
  Skia,
  useImage,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const GHOST_MARK = require("@/assets/images/ghostface-mark-gold.webp");

// How long the mark stays scratched away before it starts fading back in,
// and how long that fade-in takes. Randomised min/max so it doesn't feel
// mechanical on repeat.
const RESTORE_DELAY_MIN = 10000;
const RESTORE_DELAY_MAX = 20000;
const RESTORE_FADE_MS = 1800;
const ERASE_STROKE_WIDTH = 80;
const ERASE_EDGE_BLUR = 10;
const RIM_STROKE_WIDTH = ERASE_STROKE_WIDTH + 28;
const RIM_BLUR = 22;
const GLINT_RADIUS = 42;
const GLINT_BLUR = 26;

/**
 * The gold GHOSTFACE mark, wiped away by touch like a scratch card — the
 * mark disappears wherever a finger drags across it (Skia dstOut blend
 * erasing pixels from the image layer beneath), then fades back in on its
 * own after a delay, as if the ghost is re-materialising.
 *
 * Uses react-native-gesture-handler rather than raw View touch props:
 * Skia's Canvas is a specialised native view, not a plain RN View, and
 * onTouchStart/onTouchMove don't reliably fire on it — Gesture.Pan() is
 * the pairing Skia's own docs use for drawing/erasing interactions.
 */
export function GhostRevealMark({ size }: { size: number }) {
  const image = useImage(GHOST_MARK);
  const path = useSharedValue(Skia.Path.Make());
  const eraseOpacity = useSharedValue(1);
  const glintOpacity = useSharedValue(0);
  const glintX = useSharedValue(-999);
  const glintY = useSharedValue(-999);
  const hasTouchedRef = useRef(false);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearScratch = useCallback(() => {
    path.value = Skia.Path.Make();
    eraseOpacity.value = 1;
    hasTouchedRef.current = false;
  }, [path, eraseOpacity]);

  const scheduleRestore = useCallback(() => {
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    const delay = RESTORE_DELAY_MIN + Math.random() * (RESTORE_DELAY_MAX - RESTORE_DELAY_MIN);
    restoreTimerRef.current = setTimeout(() => {
      eraseOpacity.value = withTiming(
        0,
        { duration: RESTORE_FADE_MS, easing: Easing.inOut(Easing.quad) },
        (finished) => {
          if (finished) runOnJS(clearScratch)();
        },
      );
    }, delay);
  }, [eraseOpacity, clearScratch]);

  const fireHapticOnce = useCallback(() => {
    if (!hasTouchedRef.current) {
      hasTouchedRef.current = true;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    };
  }, []);

  const addPoint = useCallback(
    (x: number, y: number, isStart: boolean) => {
      "worklet";
      eraseOpacity.value = 1;
      const next = path.value.copy();
      if (isStart) {
        next.moveTo(x, y);
      } else {
        next.lineTo(x, y);
      }
      path.value = next;
      glintX.value = x;
      glintY.value = y;
    },
    [path, eraseOpacity, glintX, glintY],
  );

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      runOnJS(fireHapticOnce)();
      addPoint(e.x, e.y, true);
      glintOpacity.value = withTiming(1, { duration: 120 });
      runOnJS(scheduleRestore)();
    })
    .onUpdate((e) => {
      addPoint(e.x, e.y, false);
      runOnJS(scheduleRestore)();
    })
    .onFinalize(() => {
      glintOpacity.value = withTiming(0, { duration: 450 });
    });

  // Rim halo tracks the same path as the erase — the "light catching a
  // melted edge" look. Glint fades in on touch and out on release, riding
  // along on top of whatever's left of the mark.
  const rimOpacity = useDerivedValue(() => eraseOpacity.value * 0.32);
  const glintCombinedOpacity = useDerivedValue(
    () => glintOpacity.value * eraseOpacity.value * 0.55,
  );

  if (!image) {
    return <View style={{ width: size, height: size }} />;
  }

  return (
    <GestureDetector gesture={pan}>
      <Canvas style={{ width: size, height: size, backgroundColor: "transparent" }}>
        <Group layer>
          <SkiaImage image={image} x={0} y={0} width={size} height={size} fit="contain" />

          {/* Refractive rim glow along the scratch path, drawn before the
              erase so it gets carved out with it — leaves a soft lit edge. */}
          <Path
            path={path}
            style="stroke"
            strokeWidth={RIM_STROKE_WIDTH}
            strokeCap="round"
            strokeJoin="round"
            blendMode="plus"
            color="white"
            opacity={rimOpacity}
          >
            <BlurMask blur={RIM_BLUR} style="normal" />
          </Path>

          {/* The erase itself — blurred mask instead of a hard-edged
              scratch, so pixels melt away rather than being cut out. */}
          <Path
            path={path}
            style="stroke"
            strokeWidth={ERASE_STROKE_WIDTH}
            strokeCap="round"
            strokeJoin="round"
            blendMode="dstOut"
            opacity={eraseOpacity}
            color="black"
          >
            <BlurMask blur={ERASE_EDGE_BLUR} style="normal" />
          </Path>

          {/* Specular glint trailing the finger, like light moving across
              wet glass. */}
          <Circle
            cx={glintX}
            cy={glintY}
            r={GLINT_RADIUS}
            color="white"
            blendMode="plus"
            opacity={glintCombinedOpacity}
          >
            <BlurMask blur={GLINT_BLUR} style="normal" />
          </Circle>
        </Group>
      </Canvas>
    </GestureDetector>
  );
}
