import { SectionLock } from "@/components/SectionLock";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as LocalAuthentication from "expo-local-authentication";
import * as ScreenCapture from "expo-screen-capture";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";

import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
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
import { GhostLogo } from "@/components/GhostLogo";
import { GOLD_OUTLINE_COLOR, GoldGradient } from "@/components/GoldGradient";
import { PanicButton } from "@/components/PanicButton";
import { SecureBadge } from "@/components/SecureBadge";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { useScrollPersist } from "@/hooks/useScrollPersist";
// Read the version from app.json rather than hardcoding it here — the two had
// already drifted (this screen said 1.0.0 while app.json was on 1.0.2), and a
// stale version string in Settings is exactly what a tester reports back as a
// bug. app.json is the same value EAS builds against, so this can't fall out
// of step again. Imported as JSON (resolveJsonModule is on via
// expo/tsconfig.base) so no new dependency is needed.
import appJson from "../../app.json";

const appVersion = appJson.expo.version;
import {
  DEFAULT_SMS_FALLBACK_MESSAGE,
  MAX_SMS_FALLBACK_MESSAGE_LEN,
  MAX_SMS_FALLBACK_NUMBERS,
  normalizeE164,
} from "@/lib/smsFallback";
import { type } from "@/constants/typography";
import { getContrastText, getProfileColor } from "@/lib/chatColors";

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
      <Text style={{ ...type.micro, color }}>{strength.label}</Text>
    </View>
  );
}

// Single shared treatment for the small status pills scattered across this
// screen (PIN "ACTIVE", SMS fallback "ARMED", subscription "UPGRADE", …) so
// they read as one system instead of three different badge languages.
type PillTone = "secure" | "danger" | "neutral";

function StatusPill({
  label,
  tone,
  colors,
}: {
  label: string;
  tone: PillTone;
  colors: ReturnType<typeof useColors>;
}) {
  // "secure" is the only tone rendered on a real GoldGradient fill (the
  // other tones sit on a plain colors.mutedForeground/destructive View).
  // pillText's white is hardcoded for dark mode's near-black glass; light
  // mode's gold glass needs colors.primaryForeground (black) instead.
  const { themePreference } = useApp();
  const isLight = themePreference === "light";
  if (tone === "secure") {
    return (
      <GoldGradient style={pillStyles.pill}>
        <Text style={[pillStyles.pillText, isLight && { color: colors.primaryForeground }]}>
          {label}
        </Text>
      </GoldGradient>
    );
  }
  return (
    <View
      style={[
        pillStyles.pill,
        { backgroundColor: tone === "danger" ? colors.destructive : colors.mutedForeground },
      ]}
    >
      <Text style={pillStyles.pillText}>{label}</Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },
  pillText: {
    ...type.micro,
    color: "#FFFFFF",
  },
});

function SettingsScreenInner() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    alias,
    biometricEnabled,
    hasDuressPin,
    hasDecoyPin,
    hasWalletPin,
    lockedSections,
    setSectionLocked,
    autoLockTimeout,
    duressGracePeriod,
    language,
    themePreference,
    setThemePreference,
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
    setWalletPin,
    clearWalletPin,
    getRecoveryPhrase,
    setLocked,
    panicWipe,
    setAutoLockTimeout,
    setDuressGracePeriod,
    setLanguage,
    profileImageUri,
    setProfileImage,
  } = useApp();

  // Light mode's GoldGradient fill is itself gold-tinted, so text/icons that
  // were hardcoded white (or to a color equal in both palettes, e.g.
  // colors.primary) to read against dark mode's near-black glass go
  // gold-on-gold / washed-out in light mode. Those spots branch on this to
  // fall back to colors.primaryForeground (black) in light mode only; dark
  // mode keeps its original value unchanged.
  const isLight = themePreference === "light";

  const { scrollRef, onScroll } = useScrollPersist<ScrollView>();

  // ── Profile photo ──────────────────────────────────────────────────────
  // Same pattern as the chat wallpaper picker (app/chat/[id].tsx): the
  // picker returns a cache URI the OS may clean at any time, so it's
  // copied into the app's own documentDirectory before being persisted.
  const pickProfileImage = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "PHOTOS ACCESS DENIED",
          "Enable photo library access in your device settings to set a profile photo."
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const dir = `${FileSystem.documentDirectory}profile/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const dest = `${dir}avatar-${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: result.assets[0].uri, to: dest });
      await setProfileImage(dest);
    } catch (e) {
      console.warn("[Settings] Profile photo pick failed:", e);
      Alert.alert("PHOTO FAILED", "Could not set that photo. Try another image.");
    }
  };

  const openAvatarMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const options = profileImageUri
      ? ["CHOOSE PHOTO", "REMOVE PHOTO", "CANCEL"]
      : ["CHOOSE PHOTO", "CANCEL"];
    const cancelButtonIndex = options.length - 1;
    const destructiveButtonIndex = profileImageUri ? 1 : undefined;
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex, destructiveButtonIndex, title: "PROFILE PHOTO" },
        (idx) => {
          if (idx === 0) pickProfileImage();
          else if (profileImageUri && idx === 1) setProfileImage(null);
        }
      );
    } else {
      const buttons = [
        { text: "CHOOSE PHOTO", onPress: pickProfileImage },
        ...(profileImageUri
          ? [{ text: "REMOVE PHOTO", onPress: () => setProfileImage(null), style: "destructive" as const }]
          : []),
        { text: "CANCEL", style: "cancel" as const },
      ];
      Alert.alert("PROFILE PHOTO", undefined, buttons);
    }
  };

  const AUTO_LOCK_OPTIONS: { label: string; value: number | null }[] = [
    { label: "IMMEDIATELY", value: 0 },
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

  // Advanced group starts collapsed. Most of these are set once and never
  // touched again (decoy/duress/wallet PINs, grace period, language), so
  // surfacing them all at once was most of what made this screen read as an
  // undifferentiated list.
  const [showAdvanced, setShowAdvanced] = useState(false);

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
  const [showWalletPin, setShowWalletPin] = useState(false);
  const [walletPin, setWalletPinInput] = useState("");
  const [walletPinConfirm, setWalletPinConfirm] = useState("");
  const [walletPinError, setWalletPinError] = useState("");
  const [walletPinSaved, setWalletPinSaved] = useState(false);
  const [showRecoveryPhrase, setShowRecoveryPhrase] = useState(false);
  const [recoveryPhraseStage, setRecoveryPhraseStage] = useState<"pin" | "phrase">("pin");
  const [recoveryPinInput, setRecoveryPinInput] = useState("");
  const [recoveryPinError, setRecoveryPinError] = useState("");
  const [recoveryPhraseValue, setRecoveryPhraseValue] = useState("");

  // The whole app blocks screen capture (usePreventScreenCapture in _layout).
  // That is self-defeating on the ONE screen the user must save — the recovery
  // phrase — so lift the block only while the 24 words are on screen, and
  // restore it the moment the modal closes or leaves the phrase stage.
  useEffect(() => {
    if (showRecoveryPhrase && recoveryPhraseStage === "phrase") {
      ScreenCapture.allowScreenCaptureAsync();
      return () => {
        ScreenCapture.preventScreenCaptureAsync();
      };
    }
  }, [showRecoveryPhrase, recoveryPhraseStage]);

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

  const handleWalletPinSave = async () => {
    if (walletPin.length < 4) {
      setWalletPinError("Minimum 4 digits");
      return;
    }
    if (walletPin !== walletPinConfirm) {
      setWalletPinError("PINs do not match");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    // Not a hard requirement like decoy/duress (which share the main lock
    // screen's entry field and would be genuinely ambiguous) — the wallet
    // PIN has its own dedicated entry screen. But a wallet PIN identical to
    // the main PIN adds no real protection, so still guard against it.
    const matchesMain = await checkPin(walletPin);
    if (matchesMain) {
      setWalletPinError("LOCK PIN CANNOT MATCH YOUR MAIN PIN");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    await setWalletPin(walletPin);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setWalletPinSaved(true);
    setTimeout(() => {
      setWalletPinSaved(false);
      setShowWalletPin(false);
      setWalletPinInput("");
      setWalletPinConfirm("");
      setWalletPinError("");
    }, 1500);
  };

  const handleClearWalletPin = async () => {
    await clearWalletPin();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowWalletPin(false);
    setWalletPinInput("");
    setWalletPinConfirm("");
    setWalletPinError("");
  };

  const handleRecoveryPinSubmit = async () => {
    const correct = await checkPin(recoveryPinInput);
    if (!correct) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setRecoveryPinError("INCORRECT PIN");
      setRecoveryPinInput("");
      return;
    }
    const phrase = await getRecoveryPhrase();
    if (!phrase) {
      setRecoveryPinError("NO IDENTITY KEY FOUND ON THIS DEVICE");
      return;
    }
    setRecoveryPhraseValue(phrase);
    setRecoveryPhraseStage("phrase");
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
    // ── Identity hero ───────────────────────────────────────────────
    hero: {
      alignItems: "center",
      paddingTop: 22,
      paddingBottom: 24,
    },
    heroAvatar: {
      width: 76,
      height: 76,
      borderRadius: 38,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.18)",
    },
    heroAvatarTxt: {
      ...type.title,
      fontSize: 27,
      letterSpacing: 0.5,
    },
    heroBadge: {
      position: "absolute",
      bottom: -1,
      right: -1,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.background,
    },
    heroEditBadge: {
      position: "absolute",
      bottom: -1,
      left: -1,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.background,
    },
    heroAvatarImg: {
      width: 76,
      height: 76,
      borderRadius: 38,
    },
    heroAlias: {
      ...type.title,
      fontSize: 23,
      letterSpacing: 2,
      color: colors.foreground,
      marginTop: 15,
    },
    heroSub: {
      ...type.micro,
      color: colors.mutedForeground,
      marginTop: 6,
    },

    // ── Section headers — deliberately quiet ────────────────────────
    sectionHeader: {
      ...type.micro,
      color: colors.mutedForeground,
      paddingHorizontal: 26,
      marginTop: 28,
      marginBottom: 10,
    },

    // ── Cards ───────────────────────────────────────────────────────
    // Grouped surfaces instead of full-bleed lines. The faint white fill
    // lifts the card off pure black without becoming a visible panel.
    card: {
      marginHorizontal: 16,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: "rgba(255,255,255,0.03)",
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 15,
      gap: 13,
    },
    rowIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: "rgba(255,255,255,0.05)",
      alignItems: "center",
      justifyContent: "center",
    },
    rowLabel: {
      ...type.body,
      fontSize: 14,
      flex: 1,
      color: colors.foreground,
    },
    rowSub: {
      ...type.micro,
      color: colors.mutedForeground,
      marginTop: 3,
    },
    rowValue: {
      ...type.label,
      color: colors.primary,
    },
    rowDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: 59,
    },

    // ── Plan card ───────────────────────────────────────────────────
    planCard: {
      marginHorizontal: 16,
      borderRadius: 16,
      overflow: "hidden",
    },
    planCardInner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingHorizontal: 16,
      paddingVertical: 18,
      borderRadius: 16,
    },
    planIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: `${colors.primary}1A`,
      alignItems: "center",
      justifyContent: "center",
    },
    planLabel: {
      ...type.label,
      color: colors.foreground,
    },
    planValue: {
      ...type.micro,
      color: colors.mutedForeground,
      marginTop: 4,
    },

    // ── Primary action tiles ────────────────────────────────────────
    // Two tap targets rather than two more list rows — the main break
    // from the old line-after-line rhythm.
    actionGrid: {
      flexDirection: "row",
      gap: 12,
      marginHorizontal: 16,
      marginTop: 14,
    },
    actionTile: {
      flex: 1,
      borderRadius: 16,
      overflow: "hidden",
    },
    actionTileInner: {
      alignItems: "center",
      gap: 10,
      paddingVertical: 20,
      paddingHorizontal: 12,
      borderRadius: 16,
    },
    actionTileLabel: {
      ...type.label,
      color: colors.foreground,
      textAlign: "center",
      lineHeight: 15,
    },

    // ── Status grid ─────────────────────────────────────────────────
    statusGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginHorizontal: 16,
      gap: 8,
    },
    statusChip: {
      flexGrow: 1,
      flexBasis: "46%",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: "rgba(255,255,255,0.03)",
    },
    statusChipLabel: {
      ...type.micro,
      color: colors.mutedForeground,
      flex: 1,
    },
    statusChipValue: {
      ...type.micro,
    },

    settingRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 14,
    },
    settingLabel: {
      ...type.subheading,
      fontSize: 13,
      flex: 1,
      color: colors.foreground,
    },
    panicSection: {
      // marginTop was 32 when this followed a bare row list; it now sits
      // under a DANGER ZONE section header, which supplies that space.
      marginHorizontal: 16,
      marginTop: 0,
      marginBottom: 12,
    },
    versionSection: {
      alignItems: "center",
      paddingVertical: 24,
      gap: 4,
    },
    versionText: {
      ...type.micro,
      fontSize: 10,
      color: colors.mutedForeground,
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
      ...type.heading,
      fontSize: 13,
      letterSpacing: 1.5,
      color: colors.foreground,
      marginBottom: 20,
    },
    input: {
      ...type.body,
      fontSize: 16,
      letterSpacing: 0.5,
      backgroundColor: colors.muted,
      color: colors.foreground,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 12,
    },
    errorText: {
      ...type.caption,
      fontSize: 11,
      color: colors.destructive,
      marginBottom: 12,
    },
    successText: {
      ...type.heading,
      fontSize: 16,
      letterSpacing: 1.5,
      color: colors.success,
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
      ...type.labelStrong,
      fontSize: 12,
      letterSpacing: 1.5,
      color: "#FFFFFF",
    },
    cancelBtn: {
      alignItems: "center",
      paddingVertical: 12,
    },
    cancelText: {
      ...type.label,
      fontSize: 12,
      color: colors.mutedForeground,
    },
    settingHelperText: {
      ...type.micro,
      color: colors.mutedForeground,
      lineHeight: 14,
    },
    emptyHintText: {
      ...type.micro,
      color: colors.mutedForeground,
      paddingHorizontal: 16,
      paddingVertical: 8,
      textAlign: "center",
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
        {/* ── Identity ─────────────────────────────────────────────── */}
        <View style={styles.hero}>
          <Pressable onPress={openAvatarMenu}>
            {profileImageUri ? (
              <Image source={{ uri: profileImageUri }} style={styles.heroAvatarImg} />
            ) : (
              <View
                style={[
                  styles.heroAvatar,
                  { backgroundColor: getProfileColor(alias ?? "GHOST_00") },
                ]}
              >
                <Text
                  style={[
                    styles.heroAvatarTxt,
                    { color: getContrastText(getProfileColor(alias ?? "GHOST_00")) },
                  ]}
                >
                  {(alias ?? "GH").slice(0, 2)}
                </Text>
              </View>
            )}
            <View style={styles.heroBadge}>
              <Ionicons name="shield-checkmark" size={11} color={colors.background} />
            </View>
            <View style={styles.heroEditBadge}>
              <Ionicons name="camera" size={11} color={colors.secondaryForeground} />
            </View>
          </Pressable>
          <Text style={styles.heroAlias}>{alias ?? "GHOST_00"}</Text>
          <Text style={styles.heroSub}>ANONYMOUS IDENTITY</Text>
        </View>

        {/* ── Plan ─────────────────────────────────────────────────── */}
        <Pressable
          style={styles.planCard}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push("/paywall"); }}
        >
          <GoldGradient style={styles.planCardInner}>
            <View style={styles.planIcon}>
              <Ionicons
                name="shield-checkmark"
                size={20}
                color={isLight ? colors.primaryForeground : colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planLabel}>CURRENT PLAN</Text>
              <Text style={styles.planValue}>GHOST — FREE  ·  ◎ USDC</Text>
            </View>
            <StatusPill tone="neutral" label="UPGRADE" colors={colors} />
          </GoldGradient>
        </Pressable>

        {/* ── Primary actions ──────────────────────────────────────── */}
        <View style={styles.actionGrid}>
          <Pressable
            style={styles.actionTile}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setLocked(true);
            }}
          >
            <GoldGradient style={styles.actionTileInner}>
              <Ionicons
                name="lock-closed"
                size={22}
                color={isLight ? colors.primaryForeground : colors.primary}
              />
              <Text style={styles.actionTileLabel}>LOCK{"\n"}SESSION</Text>
            </GoldGradient>
          </Pressable>
          <Pressable
            style={styles.actionTile}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/security-audit"); }}
          >
            <GoldGradient style={styles.actionTileInner}>
              <Ionicons name="shield-checkmark" size={22} color={colors.success} />
              <Text style={styles.actionTileLabel}>SECURITY{"\n"}AUDIT</Text>
            </GoldGradient>
          </Pressable>
        </View>

        {/* ── Security ─────────────────────────────────────────────── */}
        <Text style={styles.sectionHeader}>SECURITY</Text>
        <View style={styles.card}>
          <Pressable style={styles.row} onPress={() => setShowPinChange(true)}>
            <View style={styles.rowIcon}>
              <Ionicons name="keypad-outline" size={17} color={colors.primary} />
            </View>
            <Text style={styles.rowLabel}>CHANGE PIN</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
          </Pressable>
          <View style={styles.rowDivider} />

          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons name="finger-print-outline" size={17} color={colors.primary} />
            </View>
            <Text style={styles.rowLabel}>BIOMETRIC LOCK</Text>
            <Switch
              value={biometricEnabled}
              onValueChange={handleBioToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.foreground}
              ios_backgroundColor={colors.border}
              testID="biometric-switch"
            />
          </View>
          <View style={styles.rowDivider} />

          <Pressable style={styles.row} onPress={handleAutoLockPress} testID="auto-lock-row">
            <View style={styles.rowIcon}>
              <Ionicons name="timer-outline" size={17} color={colors.primary} />
            </View>
            <Text style={styles.rowLabel}>AUTO-LOCK</Text>
            <Text style={styles.rowValue}>{currentAutoLockLabel}</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
          </Pressable>
          <View style={styles.rowDivider} />

          <Pressable
            style={styles.row}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setRecoveryPinInput("");
              setRecoveryPinError("");
              setRecoveryPhraseStage("pin");
              setShowRecoveryPhrase(true);
            }}
            testID="recovery-phrase-row"
          >
            <View style={styles.rowIcon}>
              <Ionicons name="key-outline" size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>RECOVERY PHRASE</Text>
              <Text style={styles.rowSub}>VIEW YOUR IDENTITY BACKUP PHRASE</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* ── Status readouts ──────────────────────────────────────────
            Six read-only indicators that were previously six full-width
            rows apiece. They carry no action, so they get the least
            weight on the screen: a compact grid instead of a list. */}
        <Text style={styles.sectionHeader}>STATUS</Text>
        <View style={styles.statusGrid}>
          {(
            [
              { icon: "eye-off-outline", label: "ANONYMOUS", value: "ON" },
              { icon: "lock-closed-outline", label: "E2EE", value: "ON" },
              { icon: "globe-outline", label: "DNS LEAK", value: "ON" },
              { icon: "analytics-outline", label: "TELEMETRY", value: "OFF" },
              { icon: "moon-outline", label: "THEME", value: themePreference.toUpperCase() },
              { icon: "glasses-outline", label: "GHOST MODE", value: "ENABLED" },
            ] as Array<{ icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string }>
          ).map((item) => (
            <View key={item.label} style={styles.statusChip}>
              <Ionicons name={item.icon} size={14} color={colors.mutedForeground} />
              <Text style={styles.statusChipLabel} numberOfLines={1}>{item.label}</Text>
              <Text
                style={[
                  styles.statusChipValue,
                  { color: item.value === "OFF" ? colors.destructive : colors.success },
                ]}
              >
                {item.value}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Advanced (collapsed) ─────────────────────────────────── */}
        <Text style={styles.sectionHeader}>ADVANCED</Text>
        <View style={styles.card}>
          <Pressable
            style={styles.row}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowAdvanced((v) => !v);
            }}
            testID="advanced-toggle"
          >
            <View style={styles.rowIcon}>
              <Ionicons name="options-outline" size={17} color={colors.mutedForeground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>ADVANCED SETTINGS</Text>
              <Text style={styles.rowSub}>DECOY &amp; DURESS, LOCK PIN, LINK, LANGUAGE</Text>
            </View>
            <Ionicons
              name={showAdvanced ? "chevron-up" : "chevron-down"}
              size={15}
              color={colors.mutedForeground}
            />
          </Pressable>

          {showAdvanced && (
            <>
              <View style={styles.rowDivider} />
              <Pressable
                style={styles.row}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDecoyPinInput("");
                  setDecoyPinConfirm("");
                  setDecoyPinError("");
                  setShowDecoyPin(true);
                }}
                testID="decoy-pin-row"
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="eye-off-outline" size={17} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>DECOY PIN</Text>
                  <Text style={styles.rowSub}>UNLOCKS TO AN EMPTY, HARMLESS-LOOKING APP</Text>
                </View>
                {hasDecoyPin ? (
                  <StatusPill tone="secure" label="ACTIVE" colors={colors} />
                ) : (
                  <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
                )}
              </Pressable>
              <View style={styles.rowDivider} />

              <Pressable
                style={styles.row}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDuressPinInput("");
                  setDuressPinConfirm("");
                  setDuressPinError("");
                  setShowDuressPin(true);
                }}
                testID="duress-pin-row"
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="skull-outline" size={17} color={colors.destructive} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.destructive }]}>DURESS PIN</Text>
                  <Text style={styles.rowSub}>TRIGGERS SILENT WIPE ON ENTRY</Text>
                </View>
                {hasDuressPin ? (
                  <StatusPill tone="danger" label="ACTIVE" colors={colors} />
                ) : (
                  <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
                )}
              </Pressable>
              <View style={styles.rowDivider} />

              {!hasDuressPin && (
                <>
                  <Text style={styles.emptyHintText}>
                    SET A DURESS PIN TO CONFIGURE GRACE PERIOD
                  </Text>
                  <View style={styles.rowDivider} />
                </>
              )}
              {hasDuressPin && (
                <>
                  <Pressable
                    style={styles.row}
                    onPress={handleGracePeriodPress}
                    testID="grace-period-row"
                  >
                    <View style={styles.rowIcon}>
                      <Ionicons name="hourglass-outline" size={17} color={colors.destructive} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowLabel, { color: colors.destructive }]}>DURESS GRACE PERIOD</Text>
                      <Text style={styles.rowSub}>{currentGraceLabel} TO CANCEL AFTER ENTRY</Text>
                    </View>
                    <Text style={{ ...type.label, color: colors.destructive }}>
                      {currentGraceLabel}
                    </Text>
                    <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
                  </Pressable>
                  <View style={styles.rowDivider} />
                </>
              )}

              <Pressable
                style={styles.row}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setWalletPinInput("");
                  setWalletPinConfirm("");
                  setWalletPinError("");
                  setShowWalletPin(true);
                }}
                testID="wallet-pin-row"
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="wallet-outline" size={17} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>LOCK PIN</Text>
                  <Text style={styles.rowSub}>SHARED PIN FOR LOCKED CATEGORIES</Text>
                </View>
                {hasWalletPin ? (
                  <StatusPill tone="secure" label="ACTIVE" colors={colors} />
                ) : (
                  <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
                )}
              </Pressable>
              <View style={styles.rowDivider} />

              {/* Category locks — gate individual tools behind the shared lock PIN */}
              <Text style={[styles.sectionHeader, { marginTop: 4 }]}>CATEGORY LOCKS</Text>
              {!hasWalletPin && (
                <Text style={[styles.rowSub, { marginHorizontal: 20, marginBottom: 6 }]}>
                  SET A LOCK PIN ABOVE TO ACTIVATE
                </Text>
              )}
              {[
                { key: "messages", label: "MESSAGES", icon: "chatbubble-ellipses-outline" },
                { key: "calls", label: "CALLS", icon: "call-outline" },
                { key: "vpn", label: "VPN", icon: "shield-outline" },
                { key: "wallet", label: "WALLET", icon: "wallet-outline" },
                { key: "number", label: "GHOST NUMBER", icon: "phone-portrait-outline" },
                { key: "settings", label: "SETTINGS", icon: "settings-outline" },
              ].map((cat) => (
                <View key={cat.key}>
                  <View style={styles.row}>
                    <View style={styles.rowIcon}>
                      <Ionicons name={cat.icon as keyof typeof Ionicons.glyphMap} size={17} color={colors.primary} />
                    </View>
                    <Text style={styles.rowLabel}>{cat.label}</Text>
                    <Switch
                      value={lockedSections.includes(cat.key)}
                      onValueChange={(val) => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSectionLocked(cat.key, val);
                        if (val && !hasWalletPin) setShowWalletPin(true);
                      }}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor={colors.foreground}
                      ios_backgroundColor={colors.border}
                      testID={`lock-switch-${cat.key}`}
                    />
                  </View>
                  <View style={styles.rowDivider} />
                </View>
              ))}

              <Pressable
                style={styles.row}
                onPress={handleOpenSmsFallback}
                testID="sms-fallback-row"
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="paper-plane-outline" size={17} color={colors.destructive} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.destructive }]}>SATELLITE FALLBACK</Text>
                  <Text style={styles.rowSub}>
                    {smsFallbackNumbers.length > 0
                      ? `${smsFallbackNumbers.length} / ${MAX_SMS_FALLBACK_NUMBERS} RECIPIENTS ARMED`
                      : "NO RECIPIENTS"}
                  </Text>
                </View>
                {smsFallbackNumbers.length > 0 ? (
                  <StatusPill tone="danger" label="ARMED" colors={colors} />
                ) : (
                  <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
                )}
              </Pressable>
              <View style={styles.rowDivider} />

              {/* Low-bandwidth mode (Task #111) */}
              <View style={[styles.row, { flexDirection: "column", alignItems: "stretch", gap: 11 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
                  <View style={styles.rowIcon}>
                    <Ionicons name="cellular-outline" size={17} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>LOW-BANDWIDTH MODE</Text>
                    <Text style={styles.rowSub}>
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
                        style={{ flex: 1 }}
                        testID={`low-bw-${opt.value}`}
                      >
                        <GoldGradient
                          style={{
                            borderRadius: 10,
                            paddingVertical: 9,
                            alignItems: "center",
                            ...(selected ? { borderColor: GOLD_OUTLINE_COLOR } : null),
                          }}
                        >
                          <Text
                            style={{
                              ...type.label,
                              color: selected
                                ? (isLight ? colors.primaryForeground : colors.primary)
                                : colors.mutedForeground,
                            }}
                          >
                            {opt.label}
                          </Text>
                        </GoldGradient>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.settingHelperText}>
                  FOR SATELLITE LINKS. BLOCKS ATTACHMENT SENDS, DEFERS INCOMING MEDIA, STRETCHES KEEPALIVES.
                </Text>
              </View>
              <View style={styles.rowDivider} />

              <Pressable style={styles.row} onPress={handleLanguagePress}>
                <View style={styles.rowIcon}>
                  <Ionicons name="globe-outline" size={17} color={colors.mutedForeground} />
                </View>
                <Text style={styles.rowLabel}>LANGUAGE</Text>
                <Text style={{ color: colors.primary, fontSize: 13, marginRight: 2 }}>{currentLanguage.flag}</Text>
                <Text style={styles.rowValue}>{currentLanguage.label}</Text>
                <Ionicons name="chevron-forward" size={15} color={colors.mutedForeground} />
              </Pressable>
              <View style={styles.rowDivider} />

              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="sunny-outline" size={17} color={colors.mutedForeground} />
                </View>
                <Text style={styles.rowLabel}>LIGHT MODE</Text>
                <Switch
                  value={themePreference === "light"}
                  onValueChange={(v) => setThemePreference(v ? "light" : "dark")}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.foreground}
                  ios_backgroundColor={colors.border}
                  testID="theme-switch"
                />
              </View>
            </>
          )}
        </View>

        <Text style={[styles.sectionHeader, { color: colors.destructive }]}>DANGER ZONE</Text>
        <View style={styles.panicSection}>
          <PanicButton onWipe={handlePanicWipe} scale={0.5} />
        </View>

        <View style={styles.versionSection}>
          <GhostLogo size={75} color={colors.border} />
          <Text style={styles.versionText}>GHOSTFACE® v{appVersion}</Text>
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
                    barColor={() => "#FFFFFF"}
                    mutedColor={colors.border}
                  />
                  {pinSimilar && (
                    <Text style={{ ...type.micro, color: "#F5D26B", marginTop: -8, marginBottom: 10 }}>
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
                      <Text style={[styles.modalBtnText, isLight && { color: colors.primaryForeground }]}>SAVE PIN</Text>
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
                    barColor={() => "#FFFFFF"}
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
                    barColor={() => "#FFFFFF"}
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
                      styles.modalBtnGold,
                      decoyPin.length < 4 && { opacity: 0.4 },
                    ]}
                    onPress={handleDecoyPinSave}
                    disabled={decoyPin.length < 4}
                    testID="decoy-pin-save-btn"
                  >
                    <GoldGradient style={styles.modalBtnGoldInner}>
                      <Text style={[styles.modalBtnText, isLight && { color: colors.primaryForeground }]}>SET DECOY PIN</Text>
                    </GoldGradient>
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

      {/* Wallet PIN modal */}
      <Modal
        visible={showWalletPin}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWalletPin(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowWalletPin(false)} />
            <View style={styles.modalContent}>
              {walletPinSaved ? (
                <Text style={styles.successText}>LOCK PIN SAVED</Text>
              ) : (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <Ionicons name="wallet-outline" size={20} color={colors.primary} />
                    <Text style={[styles.modalTitle, { marginBottom: 0 }]}>LOCK PIN</Text>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginBottom: 20, lineHeight: 16 }}>
                    REQUIRES THIS PIN TO OPEN THE WALLET, ON TOP OF YOUR MAIN APP LOCK
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={walletPin}
                    onChangeText={(t) => { setWalletPinInput(t); setWalletPinError(""); }}
                    placeholder="LOCK PIN (4–8 DIGITS)"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={8}
                    testID="wallet-pin-set-input"
                  />
                  <PinStrengthIndicator
                    pin={walletPin}
                    barColor={() => "#FFFFFF"}
                    mutedColor={colors.border}
                  />
                  <TextInput
                    style={styles.input}
                    value={walletPinConfirm}
                    onChangeText={(t) => { setWalletPinConfirm(t); setWalletPinError(""); }}
                    placeholder="CONFIRM LOCK PIN"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={8}
                    testID="wallet-pin-confirm-input"
                  />
                  {walletPinError ? (
                    <Text style={styles.errorText}>{walletPinError}</Text>
                  ) : null}
                  <Pressable
                    style={[
                      styles.modalBtnGold,
                      walletPin.length < 4 && { opacity: 0.4 },
                    ]}
                    onPress={handleWalletPinSave}
                    disabled={walletPin.length < 4}
                    testID="wallet-pin-save-btn"
                  >
                    <GoldGradient style={styles.modalBtnGoldInner}>
                      <Text style={[styles.modalBtnText, isLight && { color: colors.primaryForeground }]}>SET LOCK PIN</Text>
                    </GoldGradient>
                  </Pressable>
                  {hasWalletPin && (
                    <Pressable
                      style={[styles.modalBtn, { backgroundColor: colors.muted, marginBottom: 4 }]}
                      onPress={handleClearWalletPin}
                      testID="wallet-pin-clear-btn"
                    >
                      <Text style={[styles.modalBtnText, { color: colors.destructive }]}>REMOVE LOCK PIN</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={styles.cancelBtn}
                    onPress={() => setShowWalletPin(false)}
                  >
                    <Text style={styles.cancelText}>CANCEL</Text>
                  </Pressable>
                </>
              )}
            </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Recovery Phrase modal */}
      <Modal
        visible={showRecoveryPhrase}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRecoveryPhrase(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowRecoveryPhrase(false)} />
            <View style={styles.modalContent}>
              {recoveryPhraseStage === "pin" ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <Ionicons name="key-outline" size={20} color={colors.primary} />
                    <Text style={[styles.modalTitle, { marginBottom: 0 }]}>CONFIRM YOUR PIN</Text>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginBottom: 20, lineHeight: 16 }}>
                    ANYONE WHO SEES YOUR RECOVERY PHRASE CAN TAKE OVER YOUR IDENTITY — CONFIRM IT'S YOU
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={recoveryPinInput}
                    onChangeText={(t) => { setRecoveryPinInput(t); setRecoveryPinError(""); }}
                    placeholder="MAIN PIN"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={8}
                    testID="recovery-pin-input"
                    autoFocus
                  />
                  {recoveryPinError ? <Text style={styles.errorText}>{recoveryPinError}</Text> : null}
                  <Pressable
                    style={[styles.modalBtnGold, recoveryPinInput.length < 4 && { opacity: 0.4 }]}
                    onPress={handleRecoveryPinSubmit}
                    disabled={recoveryPinInput.length < 4}
                    testID="recovery-pin-submit"
                  >
                    <GoldGradient style={styles.modalBtnGoldInner}>
                      <Text style={[styles.modalBtnText, isLight && { color: colors.primaryForeground }]}>REVEAL PHRASE</Text>
                    </GoldGradient>
                  </Pressable>
                  <Pressable style={styles.cancelBtn} onPress={() => setShowRecoveryPhrase(false)}>
                    <Text style={styles.cancelText}>CANCEL</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <Ionicons name="key-outline" size={20} color={colors.primary} />
                    <Text style={[styles.modalTitle, { marginBottom: 0 }]}>RECOVERY PHRASE</Text>
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginBottom: 16, lineHeight: 16 }}>
                    KEEP THIS PRIVATE. ANYONE WITH THESE WORDS CAN TAKE OVER YOUR IDENTITY.
                  </Text>
                  <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius, padding: 12, marginBottom: 16 }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {recoveryPhraseValue.split(" ").map((word, i) => (
                        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: colors.muted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, minWidth: "30%" }}>
                          <Text style={{ ...type.micro, color: colors.mutedForeground, width: 14 }}>{i + 1}</Text>
                          <Text style={{ ...type.mono, color: colors.foreground }}>{word}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <Pressable
                    style={styles.modalBtnGold}
                    onPress={() => setShowRecoveryPhrase(false)}
                    testID="recovery-phrase-done"
                  >
                    <GoldGradient style={styles.modalBtnGoldInner}>
                      <Text style={[styles.modalBtnText, isLight && { color: colors.primaryForeground }]}>DONE</Text>
                    </GoldGradient>
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
              <Ionicons name="paper-plane-outline" size={20} color={colors.destructive} />
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
                    <Text style={[styles.modalBtnText, isLight && { color: colors.primaryForeground }]}>ADD</Text>
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
                <Text style={[styles.modalBtnText, isLight && { color: colors.primaryForeground }]}>SAVE MESSAGE</Text>
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

export default function SettingsScreen() {
  return (
    <SectionLock sectionKey="settings" label="SETTINGS">
      <SettingsScreenInner />
    </SectionLock>
  );
}
