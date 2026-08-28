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
import { Cinzel_700Bold } from "@expo-google-fonts/cinzel";
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
import { AppProvider, getApiBase, useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { notifyCallEnded, usePushNotifications } from "@/hooks/usePushNotifications";
import { emitLockTimestamp } from "@/lib/phantomHooks";
import { boxShadow } from "@/lib/shadow";
import LockScreen from "@/app/lock";
import OnboardingScreen from "@/app/onboarding";
import DecoyHomeScreen from "@/app/decoy-home";
import { type } from "@/constants/typography";

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
  const { incomingCall, dismissIncomingCall, sendCallSignal, logCall } = useApp();
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

  // ── Local ring-timeout backstop ───────────────────────────────────────────
  // Independent of any network signal: if nothing else has ended this call
  // within 45s of the banner appearing, end it locally. Covers the caller's
  // hangup signal getting lost or badly delayed — without this, the banner
  // would otherwise sit here indefinitely with no fallback (CallKit's native
  // ~60s timeout only applies to the backgrounded/VoIP-push path, not this
  // in-app overlay). Re-keyed per callId; cleanup fires whenever
  // `incomingCall` changes — which accept, decline, and a remote call-hangup
  // (handled in AppContext) all already do by setting it to null — so all
  // three required cancellation paths fall out of that without extra wiring.
  useEffect(() => {
    if (!incomingCall) return;
    const { callId, from, mode } = incomingCall;
    const timeout = setTimeout(() => {
      notifyCallEnded(callId, "unanswered");
      dismissIncomingCall();
      logCall({ alias: from, direction: "incoming", mode, outcome: "missed", timestamp: Date.now() });
    }, 45_000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall?.callId]);

  if (!incomingCall) return null;

  const handleAccept = () => {
    const { callId, from, mode } = incomingCall;
    dismissIncomingCall();
    router.push({ pathname: "/call", params: { alias: from, mode, role: "callee", callId } });
  };

  const handleDecline = () => {
    sendCallSignal({ type: "call-hangup", to: incomingCall.from, callId: incomingCall.callId });
    notifyCallEnded(incomingCall.callId, "decline");
    logCall({
      alias: incomingCall.from,
      direction: "incoming",
      mode: incomingCall.mode,
      outcome: "declined",
      timestamp: Date.now(),
    });
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
    label: { ...type.micro, color: colors.mutedForeground },
    alias: { ...type.heading, color: colors.foreground, fontSize: 18, marginTop: 2 },
    subLabel: { ...type.micro, color: colors.primary, fontSize: 10, marginTop: 2 },
    actions: { flexDirection: "row", gap: 10, marginTop: 14, justifyContent: "flex-end" as const },
    declineBtn: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: `${colors.destructive}20`,
      borderRadius: 24, paddingVertical: 10, paddingHorizontal: 18,
      borderWidth: 1, borderColor: colors.destructive,
    },
    declineTxt: { ...type.labelStrong, color: colors.destructive },
    acceptBtn: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: colors.success,
      borderRadius: 24, paddingVertical: 10, paddingHorizontal: 18,
    },
    acceptTxt: { ...type.labelStrong, color: "#000" },
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
  const {
    isOnboarded,
    isLocked,
    loaded,
    setLocked,
    autoLockTimeout,
    incomingCall,
    decoyMode,
    alias,
    deviceToken,
    forceReconnect,
  } = useApp();
  const appState = useRef(AppState.currentState);
  const backgroundedAtRef = useRef<number | null>(null);
  const [privacyCoverVisible, setPrivacyCoverVisible] = useState(false);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  // Registers for push once the user is actually past onboarding — no point
  // prompting for permission on the onboarding screens themselves. Must NOT
  // also gate on `!isLocked`: the WS connection is deliberately closed while
  // locked (see AppContext's connect effect), which makes push the only wake
  // channel for incoming calls/messages while locked — tearing down
  // CallKeep/VoIP listeners on every lock would silently break incoming-call
  // wake for exactly the state the app spends most of its time in. The
  // tokens themselves aren't sent anywhere by the hook; the effect below
  // POSTs them to the server whenever they change.
  const { expoPushToken, voipPushToken } = usePushNotifications(loaded && isOnboarded, forceReconnect);

  useEffect(() => {
    if (!alias || !deviceToken) return;
    if (!expoPushToken && !voipPushToken) return;
    const apiBase = getApiBase();
    if (!apiBase) return;
    // expoPushToken and voipPushToken resolve independently (separate async
    // registrations) and this effect re-fires on either one changing — so it
    // commonly runs once with only one of the two populated. The server
    // treats an explicit `null` as "clear this field" (vs. `undefined` =
    // "leave unchanged"), and JSON.stringify keeps `null` keys but drops
    // `undefined` ones. Sending the still-null token verbatim used to wipe
    // out whatever was already stored for it server-side — e.g. a fast
    // VoIP-token registration would clear a previously-registered
    // expoPushToken, silently killing new-message push wake. Only include a
    // token in the body once it's actually known.
    const body: { expoPushToken?: string; voipPushToken?: string } = {};
    if (expoPushToken) body.expoPushToken = expoPushToken;
    if (voipPushToken) body.voipPushToken = voipPushToken;
    fetch(`${apiBase}/push/${encodeURIComponent(alias)}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify(body),
    }).catch((err) => console.warn("[Push] Failed to register push tokens:", err));
  }, [alias, deviceToken, expoPushToken, voipPushToken]);

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
      emitLockTimestamp();
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

  // Privacy blur mounts the instant the app leaves "active" (covers both
  // the app-switcher snapshot and the brief gap before a real lock
  // decision below), and only unmounts again once that lock decision has
  // been applied — so a still-eligible-to-lock session never shows real
  // content for a frame on the way back to active.
  useEffect(() => {
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

        // Lock on a real backgrounding only, and only once the user's
        // configured auto-lock timeout has actually elapsed. `"inactive"`
        // also fires for transient loss of focus that never actually leaves
        // the app — the native share sheet, an image/file picker, a Face ID
        // prompt, an incoming call banner — and treating those as background
        // used to slam the whole navigator into <LockScreen/>, unmounting
        // whatever screen was open and destroying its local state
        // mid-interaction. The lock decision is deferred until we're back to
        // "active" so a backgrounding shorter than the configured timeout
        // (including "NEVER") never locks at all.
        const enteredBackground = nextAppState === "background";
        if (wasActive && enteredBackground) {
          backgroundedAtRef.current = Date.now();
        } else if (!wasActive && nextAppState === "active") {
          if (loaded && isOnboarded && !isLocked) {
            const elapsed =
              backgroundedAtRef.current === null ? 0 : Date.now() - backgroundedAtRef.current;
            if (typeof autoLockTimeout === "number" && elapsed >= autoLockTimeout) {
              setLocked(true);
              emitLockTimestamp();
            }
          }
          backgroundedAtRef.current = null;
        }

        appState.current = nextAppState;
      }
    );

    return () => subscription.remove();
  }, [loaded, isOnboarded, isLocked, autoLockTimeout, setLocked]);

  // Content varies by app state, but the privacy overlay below must sit
  // above whichever branch is active — including the lock screen itself,
  // since backgrounding while already locked should still blur it.
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
    Cinzel_700Bold,
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
