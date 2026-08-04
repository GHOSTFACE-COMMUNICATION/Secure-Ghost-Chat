import "react-native-get-random-values";
import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_500Medium,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  ShareTechMono_400Regular,
} from "@expo-google-fonts/share-tech-mono";
import { Feather, Ionicons } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router, Stack, usePathname } from "expo-router";
import { usePreventScreenCapture } from "expo-screen-capture";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, AppStateStatus, Platform, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppProvider, useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { boxShadow } from "@/lib/shadow";
import LockScreen from "@/app/lock";
import OnboardingScreen from "@/app/onboarding";
import DecoyHomeScreen from "@/app/decoy-home";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

// Disabled in dev so you can capture screenshots for testing & store listings.
function ScreenCaptureBlocker() {
  usePreventScreenCapture();
  return null;
}
const blockScreenCapture = Platform.OS !== "web" && !__DEV__;

// ── Incoming call overlay ─────────────────────────────────────────────────────
function IncomingCallOverlay() {
  const { incomingCall, dismissIncomingCall, sendCallSignal } = useApp();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-200)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (incomingCall) {
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 70, friction: 11 }).start();
      const pulse = Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ]));
      pulse.start();
      return () => pulse.stop();
    } else {
      Animated.timing(slideAnim, { toValue: -200, duration: 250, useNativeDriver: true }).start();
    }
  }, [incomingCall, slideAnim, pulseAnim]);

  if (!incomingCall) return null;

  const handleAccept = () => {
    const { callId, from, mode } = incomingCall;
    dismissIncomingCall();
    router.push({ pathname: "/call", params: { alias: from, mode, role: "callee", callId } });
  };

  const handleDecline = () => {
    sendCallSignal({ type: "call-hangup", to: incomingCall.from, callId: incomingCall.callId });
    dismissIncomingCall();
  };

  const styles = StyleSheet.create({
    wrapper: {
      position: "absolute",
      top: 0, left: 0, right: 0,
      zIndex: 9999,
      paddingTop: insets.top + 8,
      paddingHorizontal: 12,
    },
    card: {
      backgroundColor: "#0D0D0D",
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.primary,
      padding: 16,
      boxShadow: boxShadow(colors.primary, 0.3, 20, 0, 4),
    },
    row: { flexDirection: "row", alignItems: "center", gap: 14 },
    avatarWrap: {
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: `${colors.primary}22`,
      borderWidth: 2, borderColor: colors.primary,
      alignItems: "center", justifyContent: "center",
    },
    info: { flex: 1 },
    label: { color: colors.mutedForeground, fontSize: 9, letterSpacing: 3, fontWeight: "700" as const },
    alias: { color: colors.foreground, fontSize: 18, fontWeight: "800" as const, letterSpacing: 3, marginTop: 2 },
    subLabel: { color: colors.primary, fontSize: 10, letterSpacing: 2, marginTop: 2 },
    actions: { flexDirection: "row", gap: 10, marginTop: 14, justifyContent: "flex-end" as const },
    declineBtn: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: `${colors.destructive}20`,
      borderRadius: 24, paddingVertical: 10, paddingHorizontal: 18,
      borderWidth: 1, borderColor: colors.destructive,
    },
    declineTxt: { color: colors.destructive, fontSize: 11, fontWeight: "800" as const, letterSpacing: 2 },
    acceptBtn: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: colors.success,
      borderRadius: 24, paddingVertical: 10, paddingHorizontal: 18,
    },
    acceptTxt: { color: "#000", fontSize: 11, fontWeight: "800" as const, letterSpacing: 2 },
  });

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.card}>
        <View style={styles.row}>
          <Animated.View style={[styles.avatarWrap, { transform: [{ scale: pulseAnim }] }]}>
            <Ionicons
              name={incomingCall.mode === "video" ? "videocam" : "call"}
              size={22}
              color={colors.primary}
            />
          </Animated.View>
          <View style={styles.info}>
            <Text style={styles.label}>INCOMING {incomingCall.mode === "video" ? "VIDEO" : "VOICE"} CALL</Text>
            <Text style={styles.alias}>{incomingCall.from}</Text>
            <Text style={styles.subLabel}>ENCRYPTED · ZRTP</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable style={({ pressed }) => [styles.declineBtn, pressed && { opacity: 0.7 }]} onPress={handleDecline}>
            <Ionicons name="call" size={14} color={colors.destructive} style={{ transform: [{ rotate: "135deg" }] }} />
            <Text style={styles.declineTxt}>DECLINE</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.85 }]} onPress={handleAccept}>
            <Ionicons name="call" size={14} color="#000" />
            <Text style={styles.acceptTxt}>ACCEPT</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

// ── App-switcher snapshot cover ───────────────────────────────────────────────
// Solid, not blurred: a BlurView has to capture/render whatever is behind it
// first, which risks a frame of real content before the blur "catches up".
// A plain opaque view has nothing to wait on — it's just there or it isn't.
function PrivacySnapshotCover() {
  const colors = useColors();
  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        { backgroundColor: colors.background, zIndex: 999999 },
      ]}
    />
  );
}

// ── Root navigator ────────────────────────────────────────────────────────────
function RootNavigator() {
  const { isOnboarded, isLocked, loaded, setLocked, autoLockTimeout, incomingCall, decoyMode } = useApp();
  const appState = useRef(AppState.currentState);
  const [privacyCoverVisible, setPrivacyCoverVisible] = useState(false);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) {
      clearTimeout(inactivityTimer.current);
      inactivityTimer.current = null;
    }
  }, []);

  const resetInactivityTimer = useCallback(() => {
    clearInactivityTimer();
    if (typeof autoLockTimeout !== "number" || isLocked) return;
    inactivityTimer.current = setTimeout(() => {
      setLocked(true);
    }, autoLockTimeout);
  }, [autoLockTimeout, isLocked, clearInactivityTimer, setLocked]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponderCapture: () => {
          resetInactivityTimer();
          return false;
        },
        onMoveShouldSetPanResponderCapture: () => {
          resetInactivityTimer();
          return false;
        },
      }),
    [resetInactivityTimer]
  );

  useEffect(() => {
    if (!loaded || !isOnboarded) return;
    if (isLocked) {
      clearInactivityTimer();
      return;
    }
    resetInactivityTimer();
    return () => clearInactivityTimer();
  }, [loaded, isOnboarded, isLocked, autoLockTimeout, resetInactivityTimer, clearInactivityTimer]);

  useEffect(() => {
    if (!isLocked && loaded && isOnboarded) {
      resetInactivityTimer();
    }
  }, [pathname]);

  useEffect(() => {
    if (!loaded || !isOnboarded) return;

    const subscription = AppState.addEventListener(
      "change",
      (nextAppState: AppStateStatus) => {
        const wasActive = appState.current === "active";

        // Privacy cover: goes up the instant we leave "active" for ANY
        // reason — share sheet, Face ID prompt, picker, an incoming-call
        // banner, or a genuine backgrounding all pass through "inactive"
        // first, and iOS takes the app-switcher snapshot around that same
        // transition. This is a pure visual overlay (see PrivacySnapshotCover
        // below/its render site) — it never touches isLocked and never
        // unmounts whatever screen is under it, so it doesn't regress the
        // "don't tear down the screen on inactive" fix below.
        if (wasActive && nextAppState === "inactive") {
          setPrivacyCoverVisible(true);
        }
        if (nextAppState === "active") {
          setPrivacyCoverVisible(false);
        }

        // Lock on a real backgrounding only. `"inactive"` also fires for
        // transient loss of focus that never actually leaves the app — the
        // native share sheet, an image/file picker, a Face ID prompt, an
        // incoming call banner — and treating those as background used to
        // slam the whole navigator into <LockScreen/>, unmounting whatever
        // screen was open and destroying its local state mid-interaction.
        const enteredBackground = nextAppState === "background";
        if (wasActive && enteredBackground) {
          setLocked(true);
        }
        appState.current = nextAppState;
      }
    );

    return () => subscription.remove();
  }, [loaded, isOnboarded, setLocked]);

  let mainContent: React.ReactNode;

  if (!loaded) {
    mainContent = <View style={{ flex: 1, backgroundColor: "#000000" }} />;
  } else if (isLocked) {
    mainContent = <LockScreen />;
  } else if (decoyMode) {
    // Decoy PIN was entered — render a self-contained, fresh-install-looking
    // screen instead of the real tab navigator. This never mounts (tabs),
    // messages, wallet, or vpn screens, so real conversation/wallet state
    // can never be reached from here, even by accident.
    mainContent = <DecoyHomeScreen />;
  } else if (!isOnboarded) {
    mainContent = <OnboardingScreen />;
  } else {
    mainContent = (
      <View style={{ flex: 1 }} {...panResponder.panHandlers}>
        <Stack screenOptions={{ headerShown: false, animation: "none" }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="call" />
          <Stack.Screen name="paywall" />
          {/* Solana/USDC crypto paywall — Apple Guideline 3.1.1 forbids in-app
              crypto payments on iOS. Stack.Protected genuinely drops this
              screen from the navigator's route table when guard is false;
              a bare conditional <Stack.Screen> does NOT do this — expo-router
              silently re-appends any undeclared file route (see
              useScreens.js:getSortedChildren "add remaining children"), so
              the previous version of this guard never actually blocked the
              route or the ghostface://paywall-crypto deep link. Android/web
              keep it. */}
          <Stack.Protected guard={Platform.OS !== "ios"}>
            <Stack.Screen name="paywall-crypto" />
          </Stack.Protected>
        </Stack>
        {/* Incoming call overlay sits on top of everything when authenticated */}
        {incomingCall && <IncomingCallOverlay />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {mainContent}
      {/* Layered on top of mainContent, never replacing it — mainContent's
          mount state (and everything's local state inside it) is completely
          untouched by this toggling on and off. */}
      {privacyCoverVisible && <PrivacySnapshotCover />}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ShareTechMono_400Regular,
    ...Ionicons.font,
    ...Feather.font,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      {blockScreenCapture && <ScreenCaptureBlocker />}
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AppProvider>
                <RootNavigator />
              </AppProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
