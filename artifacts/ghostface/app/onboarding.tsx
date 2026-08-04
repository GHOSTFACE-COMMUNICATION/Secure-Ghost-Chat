import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GhostLogo } from "@/components/GhostLogo";
import { GoldGradient } from "@/components/GoldGradient";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { normalizeAlias } from "@/utils/alias";

const SUGGESTED_ALIASES = [
  "PHANTOM_9",
  "NULL_BYTE",
  "WRAITH_7",
  "CIPHER_X",
  "GHOST_01",
  "VOID_EXE",
];

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { setAlias, setPin } = useApp();
  const [alias, setAliasText] = useState("");
  const [step, setStep] = useState<"alias" | "pin">("alias");
  const [pin, setPinText] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState("");

  const handleAliasConfirm = async () => {
    if (alias.trim().length < 3) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep("pin");
  };

  const handleSkipPin = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await setAlias(normalizeAlias(alias));
    router.replace("/(tabs)");
  };

  const handlePinConfirm = async () => {
    if (pin.length < 4) {
      setPinError("PIN must be at least 4 digits");
      return;
    }
    if (pin !== pinConfirm) {
      setPinError("PINs do not match");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await setAlias(normalizeAlias(alias));
    await setPin(pin);
    router.replace("/(tabs)");
  };

  const pickSuggested = (s: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAliasText(s);
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0),
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0),
      paddingHorizontal: 24,
    },
    header: {
      alignItems: "center",
      marginTop: 32,
      marginBottom: 32,
    },
    tagline: {
      color: colors.primary,
      fontSize: 12,
      letterSpacing: 4,
      fontWeight: "700" as const,
      marginTop: 12,
    },
    appName: {
      color: colors.foreground,
      fontSize: 28,
      fontWeight: "800" as const,
      letterSpacing: 6,
      marginTop: 8,
    },
    sectionTitle: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 3,
      fontWeight: "700" as const,
      marginBottom: 16,
    },
    input: {
      backgroundColor: colors.card,
      color: colors.foreground,
      fontSize: 18,
      fontWeight: "700" as const,
      letterSpacing: 3,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 12,
    },
    suggestions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 20,
    },
    suggestionChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    suggestionText: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 2,
      fontWeight: "600" as const,
    },
    confirmBtn: {
      borderRadius: colors.radius,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: "#ffffff",
      overflow: "hidden",
    },
    confirmBtnInner: {
      borderRadius: colors.radius,
      paddingVertical: 16,
      alignItems: "center",
    },
    confirmBtnDisabled: {
      opacity: 0.3,
    },
    confirmBtnText: {
      color: colors.primaryForeground,
      fontSize: 13,
      fontWeight: "800" as const,
      letterSpacing: 3,
    },
    skipBtn: {
      alignItems: "center",
      paddingVertical: 12,
      marginBottom: 8,
    },
    skipText: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 2,
    },
    disclaimerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 8,
      gap: 6,
    },
    disclaimerText: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 0.5,
    },
    errorText: {
      color: colors.destructive,
      fontSize: 12,
      letterSpacing: 1,
      marginBottom: 8,
    },
    backBtn: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 24,
      gap: 6,
    },
    backText: {
      color: colors.mutedForeground,
      fontSize: 13,
      letterSpacing: 1,
    },
    pinOptionalLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 2,
      textAlign: "center",
      marginBottom: 16,
    },
    promoBanner: {
      borderWidth: 1,
      borderColor: "#ef4444",
      borderRadius: colors.radius,
      backgroundColor: "rgba(239,68,68,0.07)",
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 20,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    promoIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(239,68,68,0.15)",
      alignItems: "center",
      justifyContent: "center",
    },
    promoTextWrap: {
      flex: 1,
    },
    promoLabel: {
      color: "#ef4444",
      fontSize: 10,
      fontWeight: "800" as const,
      letterSpacing: 3,
      marginBottom: 2,
    },
    promoHeadline: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: "700" as const,
      letterSpacing: 1,
    },
    promoSub: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 0.5,
      marginTop: 2,
    },
    promoBadge: {
      backgroundColor: "#ef4444",
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      alignSelf: "flex-start",
      marginTop: 6,
    },
    promoBadgeText: {
      color: "#ffffff",
      fontSize: 9,
      fontWeight: "800" as const,
      letterSpacing: 2,
    },
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <GhostLogo size={320} color={colors.foreground} />
          <Text style={styles.tagline}>NO FACE. NO TRACE.</Text>
          <Text style={styles.appName}>GHOSTFACE</Text>
        </View>

        {step === "alias" ? (
          <>
            <Text style={styles.sectionTitle}>CHOOSE YOUR ALIAS</Text>
            <TextInput
              style={styles.input}
              value={alias}
              onChangeText={(t) => setAliasText(t.toUpperCase())}
              placeholder="GHOST_00"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              maxLength={16}
              autoCorrect={false}
              testID="alias-input"
            />

            <View style={styles.suggestions}>
              {SUGGESTED_ALIASES.map((s) => (
                <Pressable
                  key={s}
                  style={styles.suggestionChip}
                  onPress={() => pickSuggested(s)}
                >
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))}
            </View>

            {/* First Login Special — Free Ghost Number */}
            <View style={styles.promoBanner}>
              <View style={styles.promoIconWrap}>
                <Ionicons name="call" size={18} color="#ef4444" />
              </View>
              <View style={styles.promoTextWrap}>
                <Text style={styles.promoLabel}>FIRST LOGIN SPECIAL</Text>
                <Text style={styles.promoHeadline}>FREE Ghost Number</Text>
                <Text style={styles.promoSub}>
                  Claim a real virtual phone number — receive calls & SMS anonymously.
                </Text>
                <View style={styles.promoBadge}>
                  <Text style={styles.promoBadgeText}>CLAIM AFTER SETUP →</Text>
                </View>
              </View>
            </View>

            <Pressable
              style={[
                styles.confirmBtn,
                alias.trim().length < 3 && styles.confirmBtnDisabled,
              ]}
              onPress={handleAliasConfirm}
              disabled={alias.trim().length < 3}
              testID="alias-confirm"
            >
              <GoldGradient style={styles.confirmBtnInner}>
                <Text style={styles.confirmBtnText}>CONFIRM ALIAS</Text>
              </GoldGradient>
            </Pressable>

            <View style={styles.disclaimerRow}>
              <Ionicons
                name="shield-checkmark"
                size={12}
                color={colors.mutedForeground}
              />
              <Text style={styles.disclaimerText}>
                No phone number or email required
              </Text>
            </View>
          </>
        ) : (
          <>
            <Pressable style={styles.backBtn} onPress={() => setStep("alias")}>
              <Ionicons
                name="arrow-back"
                size={16}
                color={colors.mutedForeground}
              />
              <Text style={styles.backText}>BACK</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>SECURE WITH PIN</Text>
            <Text style={styles.pinOptionalLabel}>
              OPTIONAL — YOU CAN SKIP
            </Text>
            <TextInput
              style={styles.input}
              value={pin}
              onChangeText={setPinText}
              placeholder="••••"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              secureTextEntry
              maxLength={4}
              testID="pin-input"
            />
            <TextInput
              style={[styles.input, { marginBottom: pinError ? 8 : 16 }]}
              value={pinConfirm}
              onChangeText={(t) => {
                setPinConfirm(t);
                setPinError("");
              }}
              placeholder="CONFIRM PIN"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              secureTextEntry
              maxLength={4}
              testID="pin-confirm-input"
            />
            {pinError ? (
              <Text style={styles.errorText}>{pinError}</Text>
            ) : null}

            <Pressable
              style={[
                styles.confirmBtn,
                pin.length < 4 && styles.confirmBtnDisabled,
              ]}
              onPress={handlePinConfirm}
              disabled={pin.length < 4}
              testID="pin-confirm-btn"
            >
              <GoldGradient style={styles.confirmBtnInner}>
                <Text style={styles.confirmBtnText}>SET PIN & ENTER</Text>
              </GoldGradient>
            </Pressable>

            <Pressable
              style={styles.skipBtn}
              onPress={handleSkipPin}
              testID="skip-pin-btn"
            >
              <Text style={styles.skipText}>SKIP — ENTER WITHOUT PIN</Text>
            </Pressable>

            <View style={styles.disclaimerRow}>
              <Ionicons
                name="lock-closed"
                size={12}
                color={colors.mutedForeground}
              />
              <Text style={styles.disclaimerText}>
                PIN stored locally, never transmitted
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
