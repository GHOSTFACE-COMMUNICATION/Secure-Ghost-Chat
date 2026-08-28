import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
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

import { GoldGradient } from "@/components/GoldGradient";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { type } from "@/constants/typography";

/**
 * Wraps a category screen and gates it behind the shared lock PIN when the
 * user has locked that category (Settings → Category Locks). Once the correct
 * PIN is entered, `walletUnlocked` flips true for the whole session, so every
 * locked category opens until the app re-locks — one shared PIN, entered once.
 */
export function SectionLock({
  sectionKey,
  label,
  children,
}: {
  sectionKey: string;
  label: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSectionLocked, walletUnlocked, checkWalletPin, themePreference } = useApp();
  const isLight = themePreference === "light";

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const gated = isSectionLocked(sectionKey) && !walletUnlocked;

  const handleUnlock = async () => {
    if (pin.length < 4 || checking) return;
    setChecking(true);
    const ok = await checkWalletPin(pin);
    setChecking(false);
    if (!ok) {
      setError("Incorrect PIN");
      setPin("");
      return;
    }
    // Success flips walletUnlocked in context → this component re-renders and
    // shows children; no local state needed.
  };

  if (!gated) return <>{children}</>;

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 32,
      paddingTop: insets.top + 40,
      gap: 12,
    },
    title: { ...type.heading, fontSize: 20, color: colors.foreground, marginTop: 8 },
    sub: { ...type.caption, color: colors.mutedForeground, textAlign: "center" },
    input: {
      ...type.title,
      width: "100%",
      fontSize: 20,
      letterSpacing: 4,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: "rgba(201,154,60,0.35)",
      backgroundColor: colors.card,
      color: colors.foreground,
      paddingHorizontal: 16,
      paddingVertical: 14,
      textAlign: "center",
      marginTop: 10,
    },
    error: { ...type.labelStrong, color: colors.destructive },
    unlockBtn: { width: "100%", borderRadius: colors.radius, overflow: "hidden", marginTop: 4 },
    unlockBtnInner: { paddingVertical: 14, alignItems: "center" },
    unlockBtnTxt: {
      ...type.labelStrong,
      color: isLight ? colors.primaryForeground : "#FFFFFF",
      fontSize: 12,
    },
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
    <View style={styles.container}>
      <Ionicons name="lock-closed" size={40} color={colors.primary} />
      <Text style={styles.title}>{label} LOCKED</Text>
      <Text style={styles.sub}>Enter your lock PIN to continue</Text>
      <TextInput
        style={styles.input}
        value={pin}
        onChangeText={(t) => { setPin(t.replace(/[^0-9]/g, "")); setError(""); }}
        placeholder="LOCK PIN"
        placeholderTextColor={colors.mutedForeground}
        keyboardType="numeric"
        secureTextEntry
        maxLength={8}
        autoFocus
        onSubmitEditing={handleUnlock}
        testID={`section-pin-${sectionKey}`}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[styles.unlockBtn, (pin.length < 4 || checking) && { opacity: 0.4 }]}
        onPress={handleUnlock}
        disabled={pin.length < 4 || checking}
        testID={`section-unlock-${sectionKey}`}
      >
        <GoldGradient style={styles.unlockBtnInner}>
          {checking ? (
            <ActivityIndicator color={isLight ? colors.primaryForeground : "#FFFFFF"} />
          ) : (
            <Text style={styles.unlockBtnTxt}>UNLOCK</Text>
          )}
        </GoldGradient>
      </Pressable>
    </View>
    </KeyboardAvoidingView>
  );
}
