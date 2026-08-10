import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Image as RNImage,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from "react-native";
import { useFocusEffect } from "expo-router";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

export interface GhostCoinParallaxSources {
  shell: ImageSourcePropType;
  core: ImageSourcePropType;
  hologram: ImageSourcePropType;
  glow?: ImageSourcePropType;
}

export interface GhostCoinParallaxProps {
  sources: GhostCoinParallaxSources;
  size?: number;
}

const SHELL_LOOP_MS = 14000;
const CORE_LOOP_MS = 9000;
const HOLOGRAM_LOOP_MS = 5000;
const PULSE_MS = 1600;

// How far each layer drifts sideways at the peak of its rotation, so the
// stack visibly separates instead of just spinning in place.
const SHELL_DRIFT = 3;
const CORE_DRIFT = 6;
const HOLOGRAM_DRIFT = 10;

export function GhostCoinParallax({ sources, size = 184 }: GhostCoinParallaxProps) {
  const shellRotation = useSharedValue(0);
  const coreRotation = useSharedValue(0);
  const hologramRotation = useSharedValue(0);
  const glowOpacity = useSharedValue(0.35);

  const [reduceMotion, setReduceMotion] = useState(false);
  const isFocusedRef = useRef(true);

  const applyMotionState = useCallback(
    (animate: boolean) => {
      if (animate) {
        // Advance from the current value (rather than resetting to 0) so
        // resuming after a pause never snaps.
        shellRotation.value = withRepeat(
          withTiming(shellRotation.value + 360, { duration: SHELL_LOOP_MS, easing: Easing.linear }),
          -1,
          false,
        );
        coreRotation.value = withRepeat(
          withTiming(coreRotation.value + 360, { duration: CORE_LOOP_MS, easing: Easing.linear }),
          -1,
          false,
        );
        hologramRotation.value = withRepeat(
          withTiming(hologramRotation.value + 360, { duration: HOLOGRAM_LOOP_MS, easing: Easing.linear }),
          -1,
          false,
        );
        glowOpacity.value = withRepeat(
          withSequence(
            withTiming(0.85, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
            withTiming(0.3, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
          ),
          -1,
          true,
        );
      } else {
        cancelAnimation(shellRotation);
        cancelAnimation(coreRotation);
        cancelAnimation(hologramRotation);
        cancelAnimation(glowOpacity);
      }
    },
    [shellRotation, coreRotation, hologramRotation, glowOpacity],
  );

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // Reduced-motion can change while this screen is already focused — react
  // to it immediately rather than waiting for the next focus transition.
  useEffect(() => {
    if (isFocusedRef.current) applyMotionState(!reduceMotion);
  }, [reduceMotion, applyMotionState]);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      applyMotionState(!reduceMotion);
      return () => {
        isFocusedRef.current = false;
        applyMotionState(false);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reduceMotion, applyMotionState]),
  );

  const shellWobble = useDerivedValue(() => Math.sin((shellRotation.value * Math.PI) / 180) * SHELL_DRIFT);
  const coreWobble = useDerivedValue(() => Math.sin((coreRotation.value * Math.PI) / 180) * CORE_DRIFT);
  const hologramWobble = useDerivedValue(
    () => Math.sin((hologramRotation.value * Math.PI) / 180) * HOLOGRAM_DRIFT,
  );

  const shellStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shellWobble.value }, { rotate: `${shellRotation.value}deg` }],
  }));
  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: coreWobble.value }, { rotate: `${coreRotation.value}deg` }],
  }));
  const hologramStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: hologramWobble.value }, { rotate: `${hologramRotation.value}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glowOpacity.value }));

  if (reduceMotion) {
    return (
      <View style={{ width: size, height: size }}>
        {sources.glow ? (
          <RNImage
            source={sources.glow}
            style={[StyleSheet.absoluteFill, { opacity: 0.5 }]}
            resizeMode="contain"
          />
        ) : null}
        <RNImage source={sources.shell} style={StyleSheet.absoluteFill} resizeMode="contain" />
        <RNImage source={sources.core} style={StyleSheet.absoluteFill} resizeMode="contain" />
        <RNImage source={sources.hologram} style={StyleSheet.absoluteFill} resizeMode="contain" />
      </View>
    );
  }

  return (
    <View style={{ width: size, height: size }}>
      {sources.glow ? (
        <Animated.Image
          source={sources.glow}
          style={[StyleSheet.absoluteFill, glowStyle]}
          resizeMode="contain"
        />
      ) : null}
      <Animated.Image source={sources.shell} style={[StyleSheet.absoluteFill, shellStyle]} resizeMode="contain" />
      <Animated.Image source={sources.core} style={[StyleSheet.absoluteFill, coreStyle]} resizeMode="contain" />
      <Animated.Image
        source={sources.hologram}
        style={[StyleSheet.absoluteFill, hologramStyle]}
        resizeMode="contain"
      />
    </View>
  );
}
