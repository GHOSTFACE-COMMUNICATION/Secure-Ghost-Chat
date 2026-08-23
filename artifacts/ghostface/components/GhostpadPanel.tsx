import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GhostpadSignal, useApp } from "@/context/AppContext";
import { GoldGradient } from "@/components/GoldGradient";
import { useColors } from "@/hooks/useColors";
import { type } from "@/constants/typography";

// How long after the last keystroke to relay the buffer to the partner —
// keeps it feeling live without sending a WS frame per character.
const SYNC_DEBOUNCE_MS = 250;

/**
 * A live, two-party shared scratchpad. Text and wipe events relay directly
 * between the two paired sockets server-side and are never written to a
 * database — see artifacts/api-server/src/ws/manager.ts. Rendered both as a
 * real feature (the GHOSTPAD tab, see app/(tabs)/ghostpad.tsx) and, in its
 * default idle state, as the decoy-PIN screen (see app/decoy-home.tsx) — an
 * idle Ghostpad already looks exactly like an empty notes app.
 */
export default function GhostpadScreen({
  embedded = false,
  headerRight,
}: {
  embedded?: boolean;
  /** Custom header-right control — used by the decoy screen for its LOCK button. */
  headerRight?: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    ghostpad,
    sendGhostpadSignal,
    registerGhostpadListener,
    setGhostpadMode,
    resetGhostpad,
    wsConnected,
    themePreference,
  } = useApp();
  const { mode, code } = ghostpad;
  const isLight = themePreference === "light";

  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef("");

  // Mirrors `mode` for the unmount cleanup below — that effect has an empty
  // dep array (it must only run its cleanup on true unmount, not on every
  // mode change), so it can't close over `mode` directly without going stale
  // at the value `mode` held on first mount.
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    registerGhostpadListener((signal: GhostpadSignal) => {
      switch (signal.type) {
        case "ghostpad-paired":
          setError("");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        case "ghostpad-text":
          setText(signal.text ?? "");
          break;
        case "ghostpad-wipe":
          setText("");
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;
        case "ghostpad-ended":
          setText("");
          setError("The other side left");
          break;
        case "ghostpad-error":
          setError(signal.text ?? "Something went wrong");
          break;
      }
    });
    return () => registerGhostpadListener(null);
  }, [registerGhostpadListener]);

  useEffect(() => {
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      // Leaving the screen ends an active pairing — nothing lingers
      // server-side. This is unrelated to connectivity: the socket stays
      // open (we're not locked), so tell the server explicitly and mirror
      // it in our own state immediately, rather than waiting on a ws.onclose
      // that isn't coming. A "creating" (unpaired, still-waiting) session is
      // deliberately left alone here — that's the code the user may be
      // mid-share on, and it's still valid server-side until it expires or
      // the socket actually closes.
      if (modeRef.current === "paired") {
        sendGhostpadSignal({ type: "ghostpad-leave" });
        resetGhostpad();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = () => {
    setError("");
    setGhostpadMode("creating");
    sendGhostpadSignal({ type: "ghostpad-create" });
  };

  const handleJoin = () => {
    if (joinCode.length !== 6) return;
    setError("");
    sendGhostpadSignal({ type: "ghostpad-join", code: joinCode });
  };

  const handleTextChange = (value: string) => {
    setText(value);
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      lastSentRef.current = value;
      sendGhostpadSignal({ type: "ghostpad-text", text: value });
    }, SYNC_DEBOUNCE_MS);
  };

  const handleWipe = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setText("");
    sendGhostpadSignal({ type: "ghostpad-wipe", text: "" });
  };

  const handleLeave = () => {
    sendGhostpadSignal({ type: "ghostpad-leave" });
    resetGhostpad();
    setText("");
    setJoinCode("");
  };

  const handleCopy = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = async () => {
    if (!code) return;
    try {
      await Share.share({ message: `Join my GHOSTPAD: ${code}` });
    } catch {
      // user cancelled or share sheet unavailable
    }
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
      paddingBottom: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerTitle: {
      ...type.heading,
      fontSize: 16,
      letterSpacing: 1.5,
      color: colors.foreground,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
    },
    centerWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
      paddingHorizontal: 40,
    },
    emptyTxt: {
      ...type.heading,
      fontSize: 13,
      letterSpacing: 1.5,
      color: colors.mutedForeground,
    },
    emptySub: {
      ...type.caption,
      fontSize: 11,
      color: colors.mutedForeground,
      opacity: 0.6,
      textAlign: "center",
    },
    actionBtn: {
      width: "100%",
      borderRadius: colors.radius,
      overflow: "hidden",
    },
    actionBtnGlassInner: {
      width: "100%",
      paddingVertical: 14,
      alignItems: "center",
      borderRadius: colors.radius,
    },
    actionBtnPrimary: {
      borderColor: colors.primary,
      padding: 0,
      overflow: "hidden" as const,
    },
    actionBtnPrimaryInner: {
      width: "100%" as const,
      paddingVertical: 14,
      alignItems: "center" as const,
    },
    actionBtnText: {
      ...type.labelStrong,
      fontSize: 12,
      letterSpacing: 1.5,
      color: colors.foreground,
    },
    actionBtnTextPrimary: {
      color: isLight ? colors.primaryForeground : "#FFFFFF",
    },
    codeInput: {
      ...type.mono,
      fontSize: 22,
      letterSpacing: 4,
      width: "100%",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      color: colors.foreground,
      textAlign: "center",
      paddingVertical: 14,
    },
    codeDisplay: {
      ...type.mono,
      fontSize: 36,
      letterSpacing: 5,
      color: colors.primary,
    },
    errorText: {
      ...type.caption,
      fontSize: 11,
      color: colors.destructive,
      textAlign: "center",
    },
    shareRow: {
      flexDirection: "row",
      gap: 10,
      width: "100%",
    },
    pad: {
      ...type.body,
      fontSize: 15,
      flex: 1,
      color: colors.foreground,
      lineHeight: 22,
      padding: 20,
      textAlignVertical: "top",
    },
    footer: {
      flexDirection: "row",
      gap: 10,
      paddingHorizontal: 20,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 16),
      paddingTop: 12,
    },
    footerBtn: {
      flex: 1,
      borderRadius: colors.radius,
      overflow: "hidden",
    },
    footerBtnInner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 12,
      borderRadius: colors.radius,
    },
    footerBtnText: {
      ...type.labelStrong,
      fontSize: 11,
      color: colors.mutedForeground,
    },
  });

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>GHOSTPAD</Text>
        {headerRight ?? (!embedded && (
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>
      <View style={styles.divider} />

      {mode === "idle" && (
        <View style={styles.centerWrap}>
          <Ionicons name="document-text-outline" size={40} color={colors.mutedForeground} />
          <Text style={styles.emptyTxt}>NO CHANNELS</Text>
          <Text style={styles.emptySub}>
            Share a live scratchpad with someone — nothing is ever saved on either end
          </Text>
          {error ? <Text style={styles.errorText}>{error.toUpperCase()}</Text> : null}
          <Pressable
            style={[styles.actionBtn, styles.actionBtnPrimary, !wsConnected && { opacity: 0.4 }]}
            onPress={handleCreate}
            disabled={!wsConnected}
          >
            <GoldGradient style={styles.actionBtnPrimaryInner}>
              <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>CREATE PAD</Text>
            </GoldGradient>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, !wsConnected && { opacity: 0.4 }]}
            onPress={() => setGhostpadMode("joining")}
            disabled={!wsConnected}
          >
            <GoldGradient style={styles.actionBtnGlassInner}>
              <Text style={styles.actionBtnText}>JOIN PAD</Text>
            </GoldGradient>
          </Pressable>
        </View>
      )}

      {mode === "creating" && (
        <View style={styles.centerWrap}>
          {code ? (
            <>
              <Text style={styles.emptySub}>SHARE THIS CODE</Text>
              <Text style={styles.codeDisplay}>{code}</Text>
              <View style={styles.shareRow}>
                <Pressable style={styles.footerBtn} onPress={handleCopy}>
                  <GoldGradient style={styles.footerBtnInner}>
                    <Ionicons
                      name={copied ? "checkmark" : "copy-outline"}
                      size={14}
                      color={copied ? colors.foreground : colors.mutedForeground}
                    />
                    <Text style={styles.footerBtnText}>{copied ? "COPIED" : "COPY"}</Text>
                  </GoldGradient>
                </Pressable>
                <Pressable style={styles.footerBtn} onPress={handleSend}>
                  <GoldGradient style={styles.footerBtnInner}>
                    <Ionicons name="share-outline" size={14} color={colors.mutedForeground} />
                    <Text style={styles.footerBtnText}>SEND</Text>
                  </GoldGradient>
                </Pressable>
              </View>
              <Text style={styles.emptySub}>Waiting for the other side to join…</Text>
              <ActivityIndicator color={colors.primary} />
            </>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
          <Pressable style={styles.actionBtn} onPress={handleLeave}>
            <GoldGradient style={styles.actionBtnGlassInner}>
              <Text style={styles.actionBtnText}>CANCEL</Text>
            </GoldGradient>
          </Pressable>
        </View>
      )}

      {mode === "joining" && (
        <View style={styles.centerWrap}>
          <Text style={styles.emptySub}>ENTER THE 6-DIGIT CODE</Text>
          <TextInput
            style={styles.codeInput}
            value={joinCode}
            onChangeText={(t) => { setJoinCode(t.replace(/\D/g, "")); setError(""); }}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
            placeholderTextColor={colors.mutedForeground}
          />
          {error ? <Text style={styles.errorText}>{error.toUpperCase()}</Text> : null}
          <Pressable
            style={[styles.actionBtn, styles.actionBtnPrimary, joinCode.length !== 6 && { opacity: 0.4 }]}
            onPress={handleJoin}
            disabled={joinCode.length !== 6}
          >
            <GoldGradient style={styles.actionBtnPrimaryInner}>
              <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>CONNECT</Text>
            </GoldGradient>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => setGhostpadMode("idle")}>
            <GoldGradient style={styles.actionBtnGlassInner}>
              <Text style={styles.actionBtnText}>CANCEL</Text>
            </GoldGradient>
          </Pressable>
        </View>
      )}

      {mode === "paired" && (
        <>
          <TextInput
            style={styles.pad}
            value={text}
            onChangeText={handleTextChange}
            multiline
            autoFocus
            placeholder="Start writing…"
            placeholderTextColor={colors.mutedForeground}
          />
          <View style={styles.footer}>
            <Pressable style={styles.footerBtn} onPress={handleWipe}>
              <GoldGradient style={styles.footerBtnInner}>
                <Ionicons name="sparkles-outline" size={14} color={colors.mutedForeground} />
                <Text style={styles.footerBtnText}>WIPE</Text>
              </GoldGradient>
            </Pressable>
            <Pressable style={styles.footerBtn} onPress={handleLeave}>
              <GoldGradient style={styles.footerBtnInner}>
                <Ionicons name="exit-outline" size={14} color={colors.mutedForeground} />
                <Text style={styles.footerBtnText}>LEAVE</Text>
              </GoldGradient>
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
