import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GhostpadSignal, useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

type Mode = "idle" | "creating" | "joining" | "paired";

// How long after the last keystroke to relay the buffer to the partner —
// keeps it feeling live without sending a WS frame per character.
const SYNC_DEBOUNCE_MS = 250;

/**
 * A live, two-party shared scratchpad. Text and wipe events relay directly
 * between the two paired sockets server-side and are never written to a
 * database — see artifacts/api-server/src/ws/manager.ts. Rendered both as a
 * real feature (pushed from Settings) and, in its default idle state, as the
 * decoy-PIN screen (see app/decoy-home.tsx) — an idle Ghostpad already looks
 * exactly like an empty notes app.
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
  const { sendGhostpadSignal, registerGhostpadListener, wsConnected } = useApp();

  const [mode, setMode] = useState<Mode>("idle");
  const [code, setCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentRef = useRef("");

  useEffect(() => {
    registerGhostpadListener((signal: GhostpadSignal) => {
      switch (signal.type) {
        case "ghostpad-created":
          setCode(signal.code ?? null);
          break;
        case "ghostpad-paired":
          setError("");
          setMode("paired");
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
          setMode("idle");
          setCode(null);
          setText("");
          setError("The other side left");
          break;
        case "ghostpad-error":
          setError(signal.text ?? "Something went wrong");
          setMode("idle");
          break;
      }
    });
    return () => registerGhostpadListener(null);
  }, [registerGhostpadListener]);

  // Read the latest mode at unmount time via a ref — the cleanup closure of
  // a []-deps effect would otherwise see the initial "idle" forever and never
  // send ghostpad-leave for a session paired after mount.
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => {
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      // Leaving the screen ends the session — nothing lingers server-side.
      if (modeRef.current === "paired") sendGhostpadSignal({ type: "ghostpad-leave" });
    };
  }, []);

  const handleCreate = () => {
    setError("");
    setMode("creating");
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
    setMode("idle");
    setCode(null);
    setText("");
    setJoinCode("");
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
      color: colors.foreground,
      fontSize: 16,
      fontWeight: "800" as const,
      letterSpacing: 4,
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
      color: colors.mutedForeground,
      fontSize: 13,
      letterSpacing: 3,
    },
    emptySub: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 1,
      opacity: 0.6,
      textAlign: "center",
    },
    actionBtn: {
      width: "100%",
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    actionBtnPrimary: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    actionBtnText: {
      color: colors.foreground,
      fontSize: 12,
      fontWeight: "800" as const,
      letterSpacing: 2,
    },
    actionBtnTextPrimary: {
      color: colors.primaryForeground,
    },
    codeInput: {
      width: "100%",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      color: colors.foreground,
      fontSize: 22,
      letterSpacing: 8,
      textAlign: "center",
      paddingVertical: 14,
    },
    codeDisplay: {
      color: colors.primary,
      fontSize: 36,
      fontWeight: "800" as const,
      letterSpacing: 10,
    },
    errorText: {
      color: colors.destructive,
      fontSize: 11,
      letterSpacing: 1,
      textAlign: "center",
    },
    pad: {
      flex: 1,
      color: colors.foreground,
      fontSize: 15,
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
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 12,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
    },
    footerBtnText: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 2,
      fontWeight: "700" as const,
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
            <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>CREATE PAD</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, !wsConnected && { opacity: 0.4 }]}
            onPress={() => setMode("joining")}
            disabled={!wsConnected}
          >
            <Text style={styles.actionBtnText}>JOIN PAD</Text>
          </Pressable>
        </View>
      )}

      {mode === "creating" && (
        <View style={styles.centerWrap}>
          {code ? (
            <>
              <Text style={styles.emptySub}>SHARE THIS CODE</Text>
              <Text style={styles.codeDisplay}>{code}</Text>
              <Text style={styles.emptySub}>Waiting for the other side to join…</Text>
              <ActivityIndicator color={colors.primary} />
            </>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
          <Pressable style={styles.actionBtn} onPress={handleLeave}>
            <Text style={styles.actionBtnText}>CANCEL</Text>
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
            <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>CONNECT</Text>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={() => setMode("idle")}>
            <Text style={styles.actionBtnText}>CANCEL</Text>
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
              <Ionicons name="sparkles-outline" size={14} color={colors.mutedForeground} />
              <Text style={styles.footerBtnText}>WIPE</Text>
            </Pressable>
            <Pressable style={styles.footerBtn} onPress={handleLeave}>
              <Ionicons name="exit-outline" size={14} color={colors.mutedForeground} />
              <Text style={styles.footerBtnText}>LEAVE</Text>
            </Pressable>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}
