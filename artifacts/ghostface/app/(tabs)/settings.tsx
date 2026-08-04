import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";

import {
  ActionSheetIOS,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { GhostLogo } from "@/components/GhostLogo";
import { GoldGradient } from "@/components/GoldGradient";
import { PanicButton } from "@/components/PanicButton";
import { SecureBadge } from "@/components/SecureBadge";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { useScrollPersist } from "@/hooks/useScrollPersist";
import {
  DEFAULT_SMS_FALLBACK_MESSAGE,
  MAX_SMS_FALLBACK_MESSAGE_LEN,
  MAX_SMS_FALLBACK_NUMBERS,
  normalizeE164,
} from "@/lib/smsFallback";

function getPinStrength(pin: string): { level: 0 | 1 | 2; label: string } | null {
  if (pin.length === 0) return null;
  if (pin.length < 4) return { level: 0, label: "WEAK" };
  const digits = pin.split("").map(Number);
  // Obvious patterns are always WEAK regardless of length
  const allSame = digits.every((d) => d === digits[0]);
  if (allSame) return { level: 0, label: "WEAK" };
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  if (ascending || descending) return { level: 0, label: "WEAK" };
  const common = [
    "0000","1111","2222","3333","4444","5555","6666","7777","8888","9999",
    "1234","4321","0123","9876","1122","1212","2121","1010","0101",
    "123456","654321","000000","111111","123123","112233",
  ];
  if (common.includes(pin)) return { level: 0, label: "WEAK" };
  // 6+ digit PINs with no obvious pattern are STRONG immediately
  if (pin.length >= 6) return { level: 2, label: "STRONG" };
  // 4–5 digit scoring
  const counts = digits.reduce(
    (acc, d) => { acc[d] = (acc[d] || 0) + 1; return acc; },
    {} as Record<number, number>
  );
  const maxCount = Math.max(...Object.values(counts));
  if (maxCount >= 3) return { level: 1, label: "FAIR" };
  const pairs = Object.values(counts).filter((c) => c === 2).length;
  if (pairs === 2) return { level: 1, label: "FAIR" };
  return { level: 2, label: "STRONG" };
}

function PinStrengthIndicator({
  pin,
  barColor,
  mutedColor,
}: {
  pin: string;
  barColor: (level: number) => string;
  mutedColor: string;
}) {
  const strength = getPinStrength(pin);
  if (!strength) return null;
  const color = barColor(strength.level);
  const fillPct = ((strength.level + 1) / 3) * 100;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: -4, marginBottom: 12 }}>
      <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: mutedColor, overflow: "hidden" }}>
        <View style={{ width: `${fillPct}%`, height: "100%", backgroundColor: color, borderRadius: 2 }} />
      </View>
      <Text style={{ color, fontSize: 9, fontWeight: "800" as const, letterSpacing: 2 }}>{strength.label}</Text>
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    alias,
    biometricEnabled,
    hasDuressPin,
    hasDecoyPin,
    autoLockTimeout,
    duressGracePeriod,
    language,
    lowBandwidthMode,
    lowBandwidthActive,
    linkQuality,
    setLowBandwidthMode,
    smsFallbackNumbers,
    smsFallbackMessage,
    setSmsFallbackNumbers,
    setSmsFallbackMessage,
    setBiometricEnabled,
    setPin,
    checkPin,
    checkDuressPin,
    checkDecoyPin,
    captureCurrentPinForTransition,
    checkPreviousMainPin,
    setDuressPin,
    clearDuressPin,
    setDecoyPin,
    clearDecoyPin,
    setLocked,
    panicWipe,
    setAutoLockTimeout,
    setDuressGracePeriod,
    setLanguage,
  } = useApp();

  const { scrollRef, onScroll } = useScrollPersist<ScrollView>();

  const AUTO_LOCK_OPTIONS: { label: string; value: number | null }[] = [
    { label: "30 SECONDS", value: 30 * 1000 },
    { label: "1 MINUTE", value: 60 * 1000 },
    { label: "5 MINUTES", value: 5 * 60 * 1000 },
    { label: "15 MINUTES", value: 15 * 60 * 1000 },
    { label: "NEVER", value: null },
  ];

  const currentAutoLockLabel =
    AUTO_LOCK_OPTIONS.find((o) => o.value === autoLockTimeout)?.label ?? "5 MINUTES";

  const GRACE_OPTIONS: { label: string; value: number }[] = [
    { label: "1 SECOND", value: 1 },
    { label: "2 SECONDS", value: 2 },
    { label: "3 SECONDS", value: 3 },
    { label: "5 SECONDS", value: 5 },
  ];

  const currentGraceLabel =
    GRACE_OPTIONS.find((o) => o.value === duressGracePeriod)?.label ?? "3 SECONDS";

  const handleGracePeriodPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...GRACE_OPTIONS.map((o) => o.label), "CANCEL"],
          cancelButtonIndex: GRACE_OPTIONS.length,
          title: "DURESS GRACE PERIOD",
        },
        (idx) => {
          if (idx < GRACE_OPTIONS.length) {
            setDuressGracePeriod(GRACE_OPTIONS[idx].value);
          }
        }
      );
    } else {
      setShowGracePeriod(true);
    }
  };

  const handleAutoLockPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...AUTO_LOCK_OPTIONS.map((o) => o.label), "CANCEL"],
          cancelButtonIndex: AUTO_LOCK_OPTIONS.length,
          title: "AUTO-LOCK TIMEOUT",
        },
        (idx) => {
          if (idx < AUTO_LOCK_OPTIONS.length) {
            setAutoLockTimeout(AUTO_LOCK_OPTIONS[idx].value);
          }
        }
      );
    } else {
      setShowAutoLock(true);
    }
  };

  const LANGUAGE_OPTIONS: { label: string; flag: string; code: string }[] = [
    { code: "en", flag: "🇬🇧", label: "ENGLISH" },
    { code: "es", flag: "🇪🇸", label: "ESPAÑOL" },
    { code: "fr", flag: "🇫🇷", label: "FRANÇAIS" },
    { code: "de", flag: "🇩🇪", label: "DEUTSCH" },
    { code: "ja", flag: "🇯🇵", label: "日本語" },
    { code: "zh", flag: "🇨🇳", label: "中文" },
    { code: "ar", flag: "🇸🇦", label: "العربية" },
    { code: "pt", flag: "🇧🇷", label: "PORTUGUÊS" },
    { code: "ru", flag: "🇷🇺", label: "РУССКИЙ" },
    { code: "ko", flag: "🇰🇷", label: "한국어" },
    { code: "hi", flag: "🇮🇳", label: "हिन्दी" },
    { code: "it", flag: "🇮🇹", label: "ITALIANO" },
  ];

  const currentLanguage = LANGUAGE_OPTIONS.find((l) => l.code === language) ?? LANGUAGE_OPTIONS[0];

  const handleLanguagePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...LANGUAGE_OPTIONS.map((l) => `${l.flag}  ${l.label}`), "CANCEL"],
          cancelButtonIndex: LANGUAGE_OPTIONS.length,
          title: "LANGUAGE",
        },
        (idx) => {
          if (idx < LANGUAGE_OPTIONS.length) {
            setLanguage(LANGUAGE_OPTIONS[idx].code);
          }
        }
      );
    } else {
      setShowLanguage(true);
    }
  };

  const [showLanguage, setShowLanguage] = useState(false);
  const [showGracePeriod, setShowGracePeriod] = useState(false);
  const [showAutoLock, setShowAutoLock] = useState(false);
  const [showPinChange, setShowPinChange] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSaved, setPinSaved] = useState(false);
  const [pinSimilar, setPinSimilar] = useState(false);

  useEffect(() => {
    if (newPin.length < 4) {
      setPinSimilar(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      const n = newPin.length;
      const digits = newPin.split("").map(Number);
      const candidates: string[] = [
        newPin,
        ...Array.from({ length: n - 1 }, (_, k) =>
          [...digits.slice(k + 1), ...digits.slice(0, k + 1)].join("")
        ),
        digits.map((d) => (d + 1) % 10).join(""),
        digits.map((d) => (d + 9) % 10).join(""),
      ];
      const results = await Promise.all(candidates.map((c) => checkPin(c)));
      if (!cancelled) setPinSimilar(results.some(Boolean));
    };
    check();
    return () => { cancelled = true; };
  }, [newPin]);

  const [showDuressPin, setShowDuressPin] = useState(false);
  const [duressPin, setDuressPinInput] = useState("");
  const [duressPinConfirm, setDuressPinConfirm] = useState("");
  const [duressPinError, setDuressPinError] = useState("");
  const [duressPinSaved, setDuressPinSaved] = useState(false);
  const [showDecoyPin, setShowDecoyPin] = useState(false);
  const [decoyPin, setDecoyPinInput] = useState("");
  const [decoyPinConfirm, setDecoyPinConfirm] = useState("");
  const [decoyPinError, setDecoyPinError] = useState("");
  const [decoyPinSaved, setDecoyPinSaved] = useState(false);

  // ── Satellite SMS fallback (Task #113) ───────────────────────────────────
  const [showSmsFallback, setShowSmsFallback] = useState(false);
  const [newFallbackNumber, setNewFallbackNumber] = useState("");
  const [fallbackError, setFallbackError] = useState("");
  const [draftFallbackMessage, setDraftFallbackMessage] = useState(smsFallbackMessage);

  const handleOpenSmsFallback = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNewFallbackNumber("");
    setFallbackError("");
    setDraftFallbackMessage(smsFallbackMessage);
    setShowSmsFallback(true);
  };

  const handleAddFallbackNumber = async () => {
    const normalized = normalizeE164(newFallbackNumber);
    if (!normalized) {
      setFallbackError("ENTER E.164 FORMAT, E.G. +14155551234");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (smsFallbackNumbers.includes(normalized)) {
      setFallbackError("NUMBER ALREADY ADDED");
      return;
    }
    if (smsFallbackNumbers.length >= MAX_SMS_FALLBACK_NUMBERS) {
      setFallbackError(`MAXIMUM ${MAX_SMS_FALLBACK_NUMBERS} NUMBERS`);
      return;
    }
    try {
      await setSmsFallbackNumbers([...smsFallbackNumbers, normalized]);
      setNewFallbackNumber("");
      setFallbackError("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setFallbackError("COULD NOT SAVE");
    }
  };

  const handleRemoveFallbackNumber = async (target: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await setSmsFallbackNumbers(smsFallbackNumbers.filter((n) => n !== target));
    } catch {
      setFallbackError("COULD NOT SAVE");
    }
  };

  const handleSaveFallbackMessage = async () => {
    try {
      await setSmsFallbackMessage(draftFallbackMessage);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setFallbackError("COULD NOT SAVE MESSAGE");
    }
  };

  const handleResetFallbackMessage = () => {
    setDraftFallbackMessage(DEFAULT_SMS_FALLBACK_MESSAGE);
  };

  const handleBioToggle = async (val: boolean) => {
    if (val && Platform.OS !== "web") {
      try {
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (!enrolled) {
          Alert.alert(
            "NO BIOMETRIC",
            "Set up Face ID or fingerprint in device settings first.",
            [{ text: "OK" }]
          );
          return;
        }
      } catch (err) {
        console.warn("[Settings] Could not check biometric enrollment:", err);
      }
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await setBiometricEnabled(val);
  };

  const handlePanicWipe = async () => {
    await panicWipe();
    // Navigation handled automatically — panicWipe sets isOnboarded: false
    // which causes RootNavigator to render OnboardingScreen
  };

  const handlePinSave = async () => {
    if (newPin.length < 4) {
      setPinError("Minimum 4 digits");
      return;
    }
    if (newPin !== newPinConfirm) {
      setPinError("PINs do not match");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const matchesDuress = await checkDuressPin(newPin);
    if (matchesDuress) {
      setPinError("MAIN PIN CANNOT MATCH YOUR DURESS PIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const matchesDecoy = await checkDecoyPin(newPin);
    if (matchesDecoy) {
      setPinError("MAIN PIN CANNOT MATCH YOUR DECOY PIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await captureCurrentPinForTransition();
    await setPin(newPin);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPinSaved(true);
    setTimeout(() => {
      setPinSaved(false);
      setShowPinChange(false);
      setNewPin("");
      setNewPinConfirm("");
      setPinError("");
    }, 1500);
  };

  const handleDuressPinSave = async () => {
    if (duressPin.length < 4) {
      setDuressPinError("Minimum 4 digits");
      return;
    }
    if (duressPin !== duressPinConfirm) {
      setDuressPinError("PINs do not match");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const matchesMain = await checkPin(duressPin);
    if (matchesMain) {
      setDuressPinError("DURESS PIN CANNOT MATCH YOUR MAIN PIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const matchesPreviousMain = await checkPreviousMainPin(duressPin);
    if (matchesPreviousMain) {
      setDuressPinError("DURESS PIN CANNOT MATCH YOUR PREVIOUS MAIN PIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const matchesDecoy = await checkDecoyPin(duressPin);
    if (matchesDecoy) {
      setDuressPinError("DURESS PIN CANNOT MATCH YOUR DECOY PIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await setDuressPin(duressPin);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDuressPinSaved(true);
    setTimeout(() => {
      setDuressPinSaved(false);
      setShowDuressPin(false);
      setDuressPinInput("");
      setDuressPinConfirm("");
      setDuressPinError("");
    }, 1500);
  };

  const handleClearDuressPin = async () => {
    await clearDuressPin();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowDuressPin(false);
    setDuressPinInput("");
    setDuressPinConfirm("");
    setDuressPinError("");
  };

  const handleDecoyPinSave = async () => {
    if (decoyPin.length < 4) {
      setDecoyPinError("Minimum 4 digits");
      return;
    }
    if (decoyPin !== decoyPinConfirm) {
      setDecoyPinError("PINs do not match");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const matchesMain = await checkPin(decoyPin);
    if (matchesMain) {
      setDecoyPinError("DECOY PIN CANNOT MATCH YOUR MAIN PIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const matchesPreviousMain = await checkPreviousMainPin(decoyPin);
    if (matchesPreviousMain) {
      setDecoyPinError("DECOY PIN CANNOT MATCH YOUR PREVIOUS MAIN PIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const matchesDuress = await checkDuressPin(decoyPin);
    if (matchesDuress) {
      setDecoyPinError("DECOY PIN CANNOT MATCH YOUR DURESS PIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await setDecoyPin(decoyPin);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDecoyPinSaved(true);
    setTimeout(() => {
      setDecoyPinSaved(false);
      setShowDecoyPin(false);
      setDecoyPinInput("");
      setDecoyPinConfirm("");
      setDecoyPinError("");
    }, 1500);
  };

  const handleClearDecoyPin = async () => {
    await clearDecoyPin();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowDecoyPin(false);
    setDecoyPinInput("");
    setDecoyPinConfirm("");
    setDecoyPinError("");
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
    profileSection: {
      alignItems: "center",
      paddingVertical: 28,
    },
    aliasText: {
      color: colors.foreground,
      fontSize: 20,
      fontWeight: "800" as const,
      letterSpacing: 6,
      marginTop: 12,
    },
    aliasLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 3,
      marginTop: 4,
    },
    sectionLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 3,
      fontWeight: "700" as const,
      paddingHorizontal: 20,
      marginTop: 20,
      marginBottom: 8,
    },
    settingRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 14,
    },
    settingIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    settingLabel: {
      flex: 1,
      color: colors.foreground,
      fontSize: 13,
      letterSpacing: 2,
      fontWeight: "600" as const,
    },
    settingDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: 70,
    },
    panicSection: {
      marginHorizontal: 20,
      marginTop: 32,
      marginBottom: 12,
    },
    versionSection: {
      alignItems: "center",
      paddingVertical: 24,
      gap: 4,
    },
    versionText: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 3,
    },
    padBottom: { height: 120 },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.85)",
      justifyContent: "flex-end",
    },
    modalContent: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderTopWidth: 1,
      borderColor: colors.border,
      padding: 24,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
    },
    modalTitle: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: "800" as const,
      letterSpacing: 4,
      marginBottom: 20,
    },
    input: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: 16,
      letterSpacing: 2,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 12,
    },
    errorText: {
      color: colors.destructive,
      fontSize: 11,
      letterSpacing: 1,
      marginBottom: 12,
    },
    successText: {
      color: colors.success,
      fontSize: 16,
      fontWeight: "800" as const,
      letterSpacing: 3,
      textAlign: "center",
      marginBottom: 8,
    },
    modalBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: "center",
      marginBottom: 8,
    },
    modalBtnGold: {
      borderRadius: colors.radius,
      marginBottom: 8,
      overflow: "hidden",
    },
    modalBtnGoldInner: {
      paddingVertical: 14,
      alignItems: "center",
      borderRadius: colors.radius,
    },
    modalBtnText: {
      color: colors.primaryForeground,
      fontSize: 12,
      fontWeight: "800" as const,
      letterSpacing: 3,
    },
    cancelBtn: {
      alignItems: "center",
      paddingVertical: 12,
    },
    cancelText: {
      color: colors.mutedForeground,
      fontSize: 12,
      letterSpacing: 2,
    },
  });

  return (
    <TabScreenWrapper>
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SETTINGS</Text>
        <SecureBadge type="e2ee" />
      </View>
      <View style={styles.divider} />

      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileSection}>
          <GhostLogo size={140} color={colors.primary} />
          <Text style={styles.aliasText}>{alias ?? "GHOST_00"}</Text>
          <Text style={styles.aliasLabel}>ANONYMOUS IDENTITY</Text>
        </View>

        <Text style={styles.sectionLabel}>SUBSCRIPTION</Text>
        <View style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 10, marginHorizontal: 16, backgroundColor: `${colors.primary}11`, overflow: "hidden" }}>
          <Pressable
            style={styles.settingRow}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push("/paywall"); }}
          >
            <View style={styles.settingIcon}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>CURRENT PLAN</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, letterSpacing: 2, marginTop: 2 }}>GHOST — FREE  ·  ◎ USDC</Text>
            </View>
            <View style={{ backgroundColor: "#8A8A8A", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 2 }}>UPGRADE</Text>
            </View>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>SECURITY</Text>
        <View>
          <Pressable
            style={styles.settingRow}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setLocked(true);
            }}
          >
            <View style={[styles.settingIcon, { borderColor: colors.primary, backgroundColor: `${colors.primary}18` }]}>
              <Ionicons name="lock-closed" size={18} color={colors.primary} />
            </View>
            <Text style={[styles.settingLabel, { color: colors.primary }]}>LOCK SESSION</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </Pressable>
          <View style={styles.settingDivider} />
          <Pressable
            style={styles.settingRow}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/security-audit"); }}
          >
            <View style={styles.settingIcon}>
              <Ionicons name="shield-checkmark" size={18} color={colors.success} />
            </View>
            <Text style={[styles.settingLabel, { color: colors.success }]}>SECURITY AUDIT</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </Pressable>
          <View style={styles.settingDivider} />
          <Pressable
            style={styles.settingRow}
            onPress={() => setShowPinChange(true)}
          >
            <View style={styles.settingIcon}>
              <Ionicons name="keypad" size={18} color={colors.primary} />
            </View>
            <Text style={styles.settingLabel}>CHANGE PIN</Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.mutedForeground}
            />
          </Pressable>
          <View style={styles.settingDivider} />
          <View style={styles.settingRow}>
            <View style={styles.settingIcon}>
              <Ionicons name="finger-print" size={18} color={colors.primary} />
            </View>
            <Text style={styles.settingLabel}>BIOMETRIC LOCK</Text>
            <Switch
              value={biometricEnabled}
              onValueChange={handleBioToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.foreground}
              ios_backgroundColor={colors.border}
              testID="biometric-switch"
            />
          </View>
          <View style={styles.settingDivider} />
          {/* ── Low-bandwidth mode (Task #111) ────────────────────────── */}
          <View style={[styles.settingRow, { flexDirection: "column", alignItems: "stretch", gap: 10, paddingVertical: 14 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={styles.settingIcon}>
                <Ionicons name="cellular-outline" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>LOW-BANDWIDTH MODE</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginTop: 2 }}>
                  {lowBandwidthActive ? "ACTIVE" : "INACTIVE"} · LINK {linkQuality.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(
                [
                  { value: "auto", label: "AUTO" },
                  { value: "forceOn", label: "ON" },
                  { value: "forceOff", label: "OFF" },
                ] as const
              ).map((opt) => {
                const selected = lowBandwidthMode === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setLowBandwidthMode(opt.value).catch((e) =>
                        console.warn("[Settings] Failed to set LBW mode:", e),
                      );
                    }}
                    style={{
                      flex: 1,
                      borderRadius: 8,
                      paddingVertical: 8,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? `${colors.primary}18` : "transparent",
                      alignItems: "center",
                    }}
                    testID={`low-bw-${opt.value}`}
                  >
                    <Text
                      style={{
                        color: selected ? colors.primary : colors.mutedForeground,
                        fontSize: 11,
                        fontWeight: "800",
                        letterSpacing: 2,
                      }}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 1.5, lineHeight: 14 }}>
              FOR SATELLITE LINKS. BLOCKS ATTACHMENT SENDS, DEFERS INCOMING MEDIA, STRETCHES KEEPALIVES.
            </Text>
          </View>
          <View style={styles.settingDivider} />
          {/* ── Satellite SMS fallback (Task #113) ─────────────────────── */}
          <Pressable
            style={styles.settingRow}
            onPress={handleOpenSmsFallback}
            testID="sms-fallback-row"
          >
            <View style={styles.settingIcon}>
              <Ionicons name="paper-plane-outline" size={18} color={colors.destructive} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.destructive }]}>SATELLITE FALLBACK</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginTop: 2 }}>
                {smsFallbackNumbers.length > 0
                  ? `${smsFallbackNumbers.length} / ${MAX_SMS_FALLBACK_NUMBERS} RECIPIENTS ARMED`
                  : "NO RECIPIENTS"}
              </Text>
            </View>
            {smsFallbackNumbers.length > 0 ? (
              <View style={{ backgroundColor: colors.destructive, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 2 }}>ARMED</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            )}
          </Pressable>
          <View style={styles.settingDivider} />
          <Pressable
            style={styles.settingRow}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setDuressPinInput("");
              setDuressPinConfirm("");
              setDuressPinError("");
              setShowDuressPin(true);
            }}
            testID="duress-pin-row"
          >
            <View style={styles.settingIcon}>
              <Ionicons name="skull-outline" size={18} color={colors.destructive} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.destructive }]}>DURESS PIN</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginTop: 2 }}>
                TRIGGERS SILENT WIPE ON ENTRY
              </Text>
            </View>
            {hasDuressPin ? (
              <View style={{ backgroundColor: colors.destructive, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 2 }}>ACTIVE</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            )}
          </Pressable>
          <View style={styles.settingDivider} />
          {!hasDuressPin && (
            <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 1.5, paddingHorizontal: 16, paddingVertical: 8, textAlign: 'center' }}>
              SET A DURESS PIN TO CONFIGURE GRACE PERIOD
            </Text>
          )}
          {hasDuressPin && (
            <>
              <Pressable
                style={styles.settingRow}
                onPress={handleGracePeriodPress}
                testID="grace-period-row"
              >
                <View style={styles.settingIcon}>
                  <Ionicons name="hourglass-outline" size={18} color={colors.destructive} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingLabel, { color: colors.destructive }]}>DURESS GRACE PERIOD</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginTop: 2 }}>
                    {currentGraceLabel} TO CANCEL AFTER ENTRY
                  </Text>
                </View>
                <Text style={{ color: colors.destructive, fontSize: 11, letterSpacing: 2, fontWeight: "700" as const }}>
                  {currentGraceLabel}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
              </Pressable>
              <View style={styles.settingDivider} />
            </>
          )}
          <Pressable
            style={styles.settingRow}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setDecoyPinInput("");
              setDecoyPinConfirm("");
              setDecoyPinError("");
              setShowDecoyPin(true);
            }}
            testID="decoy-pin-row"
          >
            <View style={styles.settingIcon}>
              <Ionicons name="eye-off-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>DECOY PIN</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginTop: 2 }}>
                UNLOCKS TO AN EMPTY, HARMLESS-LOOKING APP
              </Text>
            </View>
            {hasDecoyPin ? (
              <View style={{ backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ color: colors.primaryForeground, fontSize: 9, fontWeight: "800", letterSpacing: 2 }}>ACTIVE</Text>
              </View>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            )}
          </Pressable>
          <View style={styles.settingDivider} />
          <Pressable
            style={styles.settingRow}
            onPress={handleAutoLockPress}
            testID="auto-lock-row"
          >
            <View style={styles.settingIcon}>
              <Ionicons name="timer-outline" size={18} color={colors.primary} />
            </View>
            <Text style={styles.settingLabel}>AUTO-LOCK</Text>
            <Text style={{ color: colors.primary, fontSize: 11, letterSpacing: 2, fontWeight: "700" as const }}>
              {currentAutoLockLabel}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>APPEARANCE</Text>
        <View>
          {(
            [
              { icon: "moon-outline", label: "THEME", value: "DARK" },
              { icon: "glasses-outline", label: "GHOST MODE", value: "ENABLED" },
            ] as Array<{ icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string }>
          ).map((item) => (
            <View key={item.label}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Ionicons name={item.icon} size={18} color={colors.mutedForeground} />
                </View>
                <Text style={styles.settingLabel}>{item.label}</Text>
                <Text
                  style={{
                    color: colors.primary,
                    fontSize: 11,
                    letterSpacing: 2,
                    fontWeight: "700" as const,
                  }}
                >
                  {item.value}
                </Text>
              </View>
              <View style={styles.settingDivider} />
            </View>
          ))}
          <Pressable style={styles.settingRow} onPress={handleLanguagePress}>
            <View style={styles.settingIcon}>
              <Ionicons name="globe-outline" size={18} color={colors.mutedForeground} />
            </View>
            <Text style={styles.settingLabel}>LANGUAGE</Text>
            <Text style={{ color: colors.primary, fontSize: 13, marginRight: 4 }}>{currentLanguage.flag}</Text>
            <Text style={{ color: colors.primary, fontSize: 11, letterSpacing: 2, fontWeight: "700" as const }}>
              {currentLanguage.label}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>PRIVACY</Text>
        <View>
          {(
            [
              { icon: "eye-off-outline", label: "ANONYMOUS MODE", value: "ON" },
              { icon: "lock-closed-outline", label: "E2EE MESSAGING", value: "ON" },
              { icon: "globe-outline", label: "DNS LEAK PROTECTION", value: "ON" },
              { icon: "analytics-outline", label: "TELEMETRY", value: "OFF" },
            ] as Array<{ icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string }>
          ).map((item, idx, arr) => (
            <View key={item.label}>
              <View style={styles.settingRow}>
                <View style={styles.settingIcon}>
                  <Ionicons name={item.icon} size={18} color={colors.mutedForeground} />
                </View>
                <Text style={styles.settingLabel}>{item.label}</Text>
                <Text
                  style={{
                    color:
                      item.value === "ON" ? colors.success : colors.destructive,
                    fontSize: 11,
                    letterSpacing: 2,
                    fontWeight: "700" as const,
                  }}
                >
                  {item.value}
                </Text>
              </View>
              {idx < arr.length - 1 && <View style={styles.settingDivider} />}
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>TOOLS (BETA)</Text>
        <View>
          <Pressable
            style={styles.settingRow}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/ghostpad");
            }}
            testID="ghostpad-row"
          >
            <View style={styles.settingIcon}>
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>GHOSTPAD</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginTop: 2 }}>
                LIVE SHARED NOTEPAD — NEVER SAVED
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View style={styles.panicSection}>
          <PanicButton onWipe={handlePanicWipe} />
        </View>

        <View style={styles.versionSection}>
          <GhostLogo size={50} color={colors.border} />
          <Text style={styles.versionText}>GHOSTFACE v1.0.0</Text>
          <Text style={styles.versionText}>NO FACE. NO TRACE.</Text>
        </View>

        <View style={styles.padBottom} />
      </ScrollView>

      <Modal
        visible={showGracePeriod}
        transparent
        animationType="slide"
        onRequestClose={() => setShowGracePeriod(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowGracePeriod(false)} />
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>DURESS GRACE PERIOD</Text>
              {GRACE_OPTIONS.map((opt) => (
                <Pressable
                  key={String(opt.value)}
                  style={[
                    styles.settingRow,
                    { paddingHorizontal: 0, paddingVertical: 14 },
                  ]}
                  onPress={() => {
                    setDuressGracePeriod(opt.value);
                    setShowGracePeriod(false);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Text style={[styles.settingLabel, { flex: 1, fontSize: 12 }]}>{opt.label}</Text>
                  {opt.value === duressGracePeriod && (
                    <Ionicons name="checkmark" size={18} color={colors.destructive} />
                  )}
                </Pressable>
              ))}
              <Pressable style={styles.cancelBtn} onPress={() => setShowGracePeriod(false)}>
                <Text style={styles.cancelText}>CANCEL</Text>
              </Pressable>
            </View>
        </View>
      </Modal>

      <Modal
        visible={showAutoLock}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAutoLock(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAutoLock(false)} />
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>AUTO-LOCK TIMEOUT</Text>
              {AUTO_LOCK_OPTIONS.map((opt) => (
                <Pressable
                  key={String(opt.value)}
                  style={[
                    styles.settingRow,
                    { paddingHorizontal: 0, paddingVertical: 14 },
                  ]}
                  onPress={() => {
                    setAutoLockTimeout(opt.value);
                    setShowAutoLock(false);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Text style={[styles.settingLabel, { flex: 1, fontSize: 12 }]}>{opt.label}</Text>
                  {opt.value === autoLockTimeout && (
                    <Ionicons name="checkmark" size={18} color={colors.primary} />
                  )}
                </Pressable>
              ))}
              <Pressable style={styles.cancelBtn} onPress={() => setShowAutoLock(false)}>
                <Text style={styles.cancelText}>CANCEL</Text>
              </Pressable>
            </View>
        </View>
      </Modal>

      <Modal
        visible={showPinChange}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setShowPinChange(false);
          setNewPin("");
          setNewPinConfirm("");
          setPinError("");
          setPinSimilar(false);
        }}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => {
            setShowPinChange(false);
            setNewPin("");
            setNewPinConfirm("");
            setPinError("");
            setPinSimilar(false);
          }} />
            <View style={styles.modalContent}>
              {pinSaved ? (
                <Text style={styles.successText}>PIN UPDATED</Text>
              ) : (
                <>
                  <Text style={styles.modalTitle}>CHANGE PIN</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginBottom: 12 }}>
                    4–8 DIGITS
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={newPin}
                    onChangeText={setNewPin}
                    placeholder="NEW PIN"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={8}
                  />
                  <PinStrengthIndicator
                    pin={newPin}
                    barColor={(level) => ["#ef4444", "#bf9b30", "#7dd3fc"][level]}
                    mutedColor={colors.border}
                  />
                  {pinSimilar && (
                    <Text style={{ color: "#bf9b30", fontSize: 9, fontWeight: "800", letterSpacing: 2, marginTop: -8, marginBottom: 10 }}>
                      TOO SIMILAR TO CURRENT PIN
                    </Text>
                  )}
                  <TextInput
                    style={styles.input}
                    value={newPinConfirm}
                    onChangeText={(t) => {
                      setNewPinConfirm(t);
                      setPinError("");
                    }}
                    placeholder="CONFIRM PIN"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={8}
                  />
                  {pinError ? (
                    <Text style={styles.errorText}>{pinError}</Text>
                  ) : null}
                  <Pressable
                    style={[
                      styles.modalBtnGold,
                      newPin.length < 4 && { opacity: 0.4 },
                    ]}
                    onPress={handlePinSave}
                    disabled={newPin.length < 4}
                  >
                    <GoldGradient style={styles.modalBtnGoldInner}>
                      <Text style={styles.modalBtnText}>SAVE PIN</Text>
                    </GoldGradient>
                  </Pressable>
                  <Pressable
                    style={styles.cancelBtn}
                    onPress={() => {
                      setShowPinChange(false);
                      setNewPin("");
                      setNewPinConfirm("");
                      setPinError("");
                      setPinSimilar(false);
                    }}
                  >
                    <Text style={styles.cancelText}>CANCEL</Text>
                  </Pressable>
                </>
              )}
            </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Duress PIN modal */}
      <Modal
        visible={showDuressPin}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDuressPin(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowDuressPin(false)} />
            <View style={styles.modalContent}>
              {duressPinSaved ? (
                <Text style={styles.successText}>DURESS PIN SAVED</Text>
              ) : (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <Ionicons name="skull-outline" size={20} color={colors.destructive} />
                    <Text style={[styles.modalTitle, { color: colors.destructive, marginBottom: 0 }]}>DURESS PIN</Text>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginBottom: 20, lineHeight: 16 }}>
                    ENTERING THIS PIN ON THE LOCK SCREEN WILL SILENTLY WIPE ALL DATA — INDISTINGUISHABLE FROM A NORMAL LOGIN
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={duressPin}
                    onChangeText={(t) => { setDuressPinInput(t); setDuressPinError(""); }}
                    placeholder="DURESS PIN (4–8 DIGITS)"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={8}
                    testID="duress-pin-input"
                  />
                  <PinStrengthIndicator
                    pin={duressPin}
                    barColor={(level) => ["#ef4444", "#bf9b30", "#7dd3fc"][level]}
                    mutedColor={colors.border}
                  />
                  <TextInput
                    style={styles.input}
                    value={duressPinConfirm}
                    onChangeText={(t) => { setDuressPinConfirm(t); setDuressPinError(""); }}
                    placeholder="CONFIRM DURESS PIN"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={8}
                    testID="duress-pin-confirm-input"
                  />
                  {duressPinError ? (
                    <Text style={styles.errorText}>{duressPinError}</Text>
                  ) : null}
                  <Pressable
                    style={[
                      styles.modalBtn,
                      { backgroundColor: colors.destructive },
                      duressPin.length < 4 && { opacity: 0.4 },
                    ]}
                    onPress={handleDuressPinSave}
                    disabled={duressPin.length < 4}
                    testID="duress-pin-save-btn"
                  >
                    <Text style={styles.modalBtnText}>SET DURESS PIN</Text>
                  </Pressable>
                  {hasDuressPin && (
                    <Pressable
                      style={[styles.modalBtn, { backgroundColor: colors.muted, marginBottom: 4 }]}
                      onPress={handleClearDuressPin}
                      testID="duress-pin-clear-btn"
                    >
                      <Text style={[styles.modalBtnText, { color: colors.destructive }]}>REMOVE DURESS PIN</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={styles.cancelBtn}
                    onPress={() => setShowDuressPin(false)}
                  >
                    <Text style={styles.cancelText}>CANCEL</Text>
                  </Pressable>
                </>
              )}
            </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Decoy PIN modal */}
      <Modal
        visible={showDecoyPin}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDecoyPin(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowDecoyPin(false)} />
            <View style={styles.modalContent}>
              {decoyPinSaved ? (
                <Text style={styles.successText}>DECOY PIN SAVED</Text>
              ) : (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <Ionicons name="eye-off-outline" size={20} color={colors.primary} />
                    <Text style={[styles.modalTitle, { marginBottom: 0 }]}>DECOY PIN</Text>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginBottom: 20, lineHeight: 16 }}>
                    ENTERING THIS PIN ON THE LOCK SCREEN OPENS AN EMPTY, FRESH-LOOKING APP — YOUR REAL DATA STAYS HIDDEN, NOT WIPED
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={decoyPin}
                    onChangeText={(t) => { setDecoyPinInput(t); setDecoyPinError(""); }}
                    placeholder="DECOY PIN (4–8 DIGITS)"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={8}
                    testID="decoy-pin-input"
                  />
                  <PinStrengthIndicator
                    pin={decoyPin}
                    barColor={(level) => ["#ef4444", "#bf9b30", "#7dd3fc"][level]}
                    mutedColor={colors.border}
                  />
                  <TextInput
                    style={styles.input}
                    value={decoyPinConfirm}
                    onChangeText={(t) => { setDecoyPinConfirm(t); setDecoyPinError(""); }}
                    placeholder="CONFIRM DECOY PIN"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={8}
                    testID="decoy-pin-confirm-input"
                  />
                  {decoyPinError ? (
                    <Text style={styles.errorText}>{decoyPinError}</Text>
                  ) : null}
                  <Pressable
                    style={[
                      styles.modalBtn,
                      { backgroundColor: colors.primary },
                      decoyPin.length < 4 && { opacity: 0.4 },
                    ]}
                    onPress={handleDecoyPinSave}
                    disabled={decoyPin.length < 4}
                    testID="decoy-pin-save-btn"
                  >
                    <Text style={styles.modalBtnText}>SET DECOY PIN</Text>
                  </Pressable>
                  {hasDecoyPin && (
                    <Pressable
                      style={[styles.modalBtn, { backgroundColor: colors.muted, marginBottom: 4 }]}
                      onPress={handleClearDecoyPin}
                      testID="decoy-pin-clear-btn"
                    >
                      <Text style={[styles.modalBtnText, { color: colors.destructive }]}>REMOVE DECOY PIN</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={styles.cancelBtn}
                    onPress={() => setShowDecoyPin(false)}
                  >
                    <Text style={styles.cancelText}>CANCEL</Text>
                  </Pressable>
                </>
              )}
            </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Language picker modal */}
      <Modal
        visible={showLanguage}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLanguage(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowLanguage(false)} />
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>LANGUAGE</Text>
              {LANGUAGE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.code}
                  style={[styles.settingRow, { paddingHorizontal: 0, paddingVertical: 12 }]}
                  onPress={() => {
                    setLanguage(opt.code);
                    setShowLanguage(false);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <Text style={{ fontSize: 20, marginRight: 12 }}>{opt.flag}</Text>
                  <Text style={[styles.settingLabel, { flex: 1, fontSize: 12 }]}>{opt.label}</Text>
                  {opt.code === language && (
                    <Ionicons name="checkmark" size={18} color={colors.primary} />
                  )}
                </Pressable>
              ))}
              <Pressable style={styles.cancelBtn} onPress={() => setShowLanguage(false)}>
                <Text style={styles.cancelText}>CANCEL</Text>
              </Pressable>
            </View>
        </View>
      </Modal>

      {/* Satellite SMS fallback modal (Task #113) */}
      <Modal
        visible={showSmsFallback}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSmsFallback(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSmsFallback(false)} />
          <View style={styles.modalContent}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <Ionicons name="paper-plane" size={20} color={colors.destructive} />
              <Text style={styles.modalTitle}>SATELLITE FALLBACK</Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, letterSpacing: 1.5, marginBottom: 14, textAlign: "center", lineHeight: 16 }}>
              IF PANIC FIRES AND NETWORK IS DOWN, A ONE-LINE SMS IS HANDED TO YOUR OS (INCLUDING DIRECT-TO-CELL SATELLITE) FOR EACH NUMBER BELOW.
            </Text>

            <Text style={{ color: colors.foreground, fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>
              RECIPIENTS ({smsFallbackNumbers.length} / {MAX_SMS_FALLBACK_NUMBERS})
            </Text>
            {smsFallbackNumbers.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1.5, marginBottom: 12, fontStyle: "italic" }}>
                NONE CONFIGURED
              </Text>
            ) : (
              <View style={{ marginBottom: 12, gap: 6 }}>
                {smsFallbackNumbers.map((num) => (
                  <View
                    key={num}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderWidth: 1,
                      borderColor: `${colors.mutedForeground}40`,
                      borderRadius: 6,
                    }}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 13 }}>
                      {num}
                    </Text>
                    <Pressable
                      onPress={() => handleRemoveFallbackNumber(num)}
                      testID={`fallback-remove-${num}`}
                      hitSlop={10}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.destructive} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {smsFallbackNumbers.length < MAX_SMS_FALLBACK_NUMBERS && (
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  value={newFallbackNumber}
                  onChangeText={(t) => { setNewFallbackNumber(t); setFallbackError(""); }}
                  placeholder="+14155551234"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="phone-pad"
                  autoCorrect={false}
                  testID="fallback-number-input"
                />
                <Pressable
                  style={[styles.modalBtnGold, { marginBottom: 0, alignSelf: "stretch" }]}
                  onPress={handleAddFallbackNumber}
                  testID="fallback-add-btn"
                >
                  <GoldGradient style={[styles.modalBtnGoldInner, { flex: 1, paddingHorizontal: 18, justifyContent: "center" }]}>
                    <Text style={styles.modalBtnText}>ADD</Text>
                  </GoldGradient>
                </Pressable>
              </View>
            )}
            {fallbackError ? (
              <Text style={styles.errorText}>{fallbackError}</Text>
            ) : null}

            <Text style={{ color: colors.foreground, fontSize: 10, letterSpacing: 2, marginTop: 8, marginBottom: 6 }}>
              MESSAGE BODY
            </Text>
            <TextInput
              style={[styles.input, { minHeight: 60, textAlignVertical: "top" }]}
              value={draftFallbackMessage}
              onChangeText={setDraftFallbackMessage}
              maxLength={MAX_SMS_FALLBACK_MESSAGE_LEN}
              multiline
              placeholder={DEFAULT_SMS_FALLBACK_MESSAGE}
              placeholderTextColor={colors.mutedForeground}
              testID="fallback-message-input"
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 1.5 }}>
                {draftFallbackMessage.length} / {MAX_SMS_FALLBACK_MESSAGE_LEN}
              </Text>
              <Pressable onPress={handleResetFallbackMessage} hitSlop={8}>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 1.5, textDecorationLine: "underline" }}>
                  RESET TO DEFAULT
                </Text>
              </Pressable>
            </View>
            <Pressable
              style={[styles.modalBtnGold, draftFallbackMessage === smsFallbackMessage && { opacity: 0.5 }]}
              onPress={handleSaveFallbackMessage}
              disabled={draftFallbackMessage === smsFallbackMessage}
              testID="fallback-save-msg-btn"
            >
              <GoldGradient style={styles.modalBtnGoldInner}>
                <Text style={styles.modalBtnText}>SAVE MESSAGE</Text>
              </GoldGradient>
            </Pressable>

            <View style={{ marginTop: 8, padding: 10, borderWidth: 1, borderColor: `${colors.destructive}60`, borderRadius: 6 }}>
              <Text style={{ color: colors.destructive, fontSize: 9, letterSpacing: 1.5, lineHeight: 14 }}>
                WARNING: SMS IS UNENCRYPTED. YOUR CARRIER AND THE RECIPIENT'S CARRIER WILL SEE YOUR NUMBER, THEIR NUMBER, AND THE MESSAGE BODY. USE ONLY FOR SIGNALING — NEVER FOR CONTENT.
              </Text>
            </View>

            <Pressable style={styles.cancelBtn} onPress={() => setShowSmsFallback(false)}>
              <Text style={styles.cancelText}>CLOSE</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
    </TabScreenWrapper>
  );
}
