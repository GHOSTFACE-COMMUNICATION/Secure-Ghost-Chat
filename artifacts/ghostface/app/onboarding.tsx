import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GhostLogo } from "@/components/GhostLogo";
import { GoldGradient } from "@/components/GoldGradient";
import { getApiBase, useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { normalizeAlias } from "@/utils/alias";
import { recoveryPhraseToKey } from "@/lib/recoveryPhrase";
import { type } from "@/constants/typography";

// Larger pool than we ever show at once — the suggestion row rotates through
// a random slice of this every few seconds so returning users don't see the
// same six every time.
const ALIAS_POOL = [
  "PHANTOM_9", "NULL_BYTE", "WRAITH_7", "CIPHER_X", "GHOST_01", "VOID_EXE",
  "SHADE_11", "ECHO_ZERO", "STATIC_Q", "NOMAD_88", "RELIC_X9", "DRIFTER_3",
  "MASK_404", "HOLLOW_7", "CINDER_Q", "SIGNAL_0", "REDACT_9", "GHOST_X1",
  "OBLIVION4", "SPECTRE_2", "UNKNOWN_7", "GLITCH_99", "VAPOR_ID", "NIGHT_OPS",
];
const SUGGESTIONS_SHOWN = 6;
const ROTATE_INTERVAL_MS = 4500;

function sampleAliases(count: number): string[] {
  const pool = [...ALIAS_POOL];
  const picked: string[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

/** Checks the same identity_keys-backed lookup used to route messages
 * (GET /api/users/exists/:alias) — a hit means the alias is already
 * registered, not just "someone else typed it once." */
async function checkAliasTaken(alias: string): Promise<boolean | null> {
  const apiBase = getApiBase();
  if (!apiBase) return null;
  try {
    const res = await fetch(`${apiBase}/users/exists/${encodeURIComponent(alias)}`);
    if (res.status === 404) return false;
    if (!res.ok) return null;
    return true;
  } catch {
    return null;
  }
}

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { setAlias, setPin, recoverIdentity, getRecoveryPhrase, themePreference } = useApp();
  const isLight = themePreference === "light";
  const [alias, setAliasText] = useState("");
  const [step, setStep] = useState<"alias" | "pin" | "recovery" | "restore">("alias");
  const [pin, setPinText] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [restoreAlias, setRestoreAlias] = useState("");
  const [restorePhrase, setRestorePhrase] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>(() => sampleAliases(SUGGESTIONS_SHOWN));
  const [aliasStatus, setAliasStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "unknown"
  >("idle");
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkSeq = useRef(0);

  // Rotate the suggestion chips through the wider pool every few seconds.
  useEffect(() => {
    const id = setInterval(() => {
      setSuggestions(sampleAliases(SUGGESTIONS_SHOWN));
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Debounced "is this alias already registered" check against the same
  // lookup messages.ts uses to route to an existing identity.
  useEffect(() => {
    const normalized = normalizeAlias(alias);
    if (checkTimer.current) clearTimeout(checkTimer.current);
    if (!normalized) {
      setAliasStatus("idle");
      return;
    }
    setAliasStatus("checking");
    const seq = ++checkSeq.current;
    checkTimer.current = setTimeout(async () => {
      const taken = await checkAliasTaken(normalized);
      if (checkSeq.current !== seq) return; // alias changed since this fired
      setAliasStatus(taken === null ? "unknown" : taken ? "taken" : "available");
    }, 450);
    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, [alias]);

  const handleAliasConfirm = async () => {
    if (!normalizeAlias(alias) || aliasStatus === "taken" || aliasStatus === "checking") return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep("pin");
  };

  // Both paths land on the recovery-phrase step before finishing onboarding
  // — the identity key was just generated inside setAlias, and this is the
  // one and only time it's ever shown.
  const goToRecoveryStep = async () => {
    const phrase = await getRecoveryPhrase();
    setRecoveryPhrase(phrase ?? "");
    setStep("recovery");
  };

  const handleSkipPin = async () => {
    // Defensive — handleAliasConfirm already gates entry to this step on a
    // valid normalized alias, so this should never actually be null here.
    const normalized = normalizeAlias(alias);
    if (!normalized) { setStep("alias"); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await setAlias(normalized);
    await goToRecoveryStep();
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
    const normalized = normalizeAlias(alias);
    if (!normalized) { setStep("alias"); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await setAlias(normalized);
    await setPin(pin);
    await goToRecoveryStep();
  };

  const handleRecoveryContinue = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.replace("/(tabs)");
  };

  const handleRestoreSubmit = async () => {
    const normalizedRestoreAlias = normalizeAlias(restoreAlias);
    if (!normalizedRestoreAlias) {
      setRestoreError("Enter the alias you originally registered");
      return;
    }
    if (!recoveryPhraseToKey(restorePhrase)) {
      setRestoreError("That doesn't look like a valid 24-word recovery phrase");
      return;
    }
    setRestoreError("");
    setRestoring(true);
    const result = await recoverIdentity(normalizedRestoreAlias, restorePhrase);
    setRestoring(false);
    if (!result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setRestoreError(
        result.error === "not_found"
          ? "No identity found for that alias"
          : result.error === "proof_failed"
          ? "That phrase doesn't match this alias"
          : result.error === "invalid_phrase"
          ? "That doesn't look like a valid 24-word recovery phrase"
          : "Couldn't reach the server — check your connection and try again",
      );
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      // Shifted up 10mm (~38px @ 96dpi) — CONFIRM ALIAS was sitting low
      // enough to need an awkward reach/tilt to tap.
      marginTop: 32 - 38,
      marginBottom: 32,
    },
    tagline: {
      ...type.labelStrong,
      fontSize: 12,
      letterSpacing: 1.5,
      color: colors.primary,
      marginTop: 12,
    },
    appName: {
      ...type.display,
      fontSize: 28,
      letterSpacing: 1,
      color: colors.foreground,
      marginTop: 8,
    },
    sectionTitle: {
      ...type.label,
      fontSize: 11,
      color: colors.mutedForeground,
      marginBottom: 16,
    },
    input: {
      ...type.title,
      fontSize: 18,
      letterSpacing: 1.5,
      backgroundColor: colors.card,
      color: colors.foreground,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 12,
    },
    aliasStatusText: {
      ...type.label,
      fontSize: 10,
      marginTop: -6,
      marginBottom: 10,
    },
    suggestions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 20,
    },
    suggestionChip: { borderRadius: colors.radius, overflow: "hidden" },
    suggestionChipInner: {
      borderRadius: colors.radius,
      paddingHorizontal: 12,
      paddingVertical: 6,
      alignItems: "center",
      justifyContent: "center",
    },
    suggestionText: {
      ...type.label,
      fontSize: 11,
      color: colors.mutedForeground,
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
      ...type.labelStrong,
      fontSize: 13,
      letterSpacing: 1.5,
      // Dark mode's glass fill is near-black, so white text reads fine
      // there. Light mode's glass fill is a saturated gold, so white (or
      // gold) text on it is nearly illegible — use the token that's
      // defined as "correct text on a gold surface" instead.
      color: isLight ? colors.primaryForeground : "#FFFFFF",
    },
    skipBtn: {
      alignItems: "center",
      paddingVertical: 12,
      marginBottom: 8,
    },
    skipText: {
      ...type.label,
      fontSize: 11,
      color: colors.mutedForeground,
    },
    disclaimerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 8,
      gap: 6,
    },
    disclaimerText: {
      ...type.caption,
      fontSize: 11,
      color: colors.mutedForeground,
    },
    errorText: {
      ...type.caption,
      fontSize: 12,
      color: colors.destructive,
      marginBottom: 8,
    },
    restoreLink: {
      alignItems: "center",
      paddingVertical: 14,
    },
    restoreLinkText: {
      ...type.label,
      fontSize: 10,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    phraseBox: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      padding: 12,
      marginBottom: 16,
    },
    phraseGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    phraseWordChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: colors.muted,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      minWidth: "30%",
    },
    phraseWordIndex: {
      ...type.micro,
      fontSize: 9,
      color: colors.mutedForeground,
      width: 14,
    },
    phraseWordText: {
      ...type.mono,
      fontSize: 13,
      color: colors.foreground,
    },
    recoveryCheckRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 16,
    },
    recoveryCheckText: {
      ...type.caption,
      fontSize: 12,
      color: colors.foreground,
      flex: 1,
    },
    phraseInput: {
      ...type.mono,
      fontSize: 14,
      minHeight: 90,
      textAlignVertical: "top",
      textTransform: "none" as const,
    },
    backBtn: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 24,
      gap: 6,
    },
    backText: {
      ...type.label,
      fontSize: 13,
      color: colors.mutedForeground,
    },
    pinOptionalLabel: {
      ...type.micro,
      fontSize: 10,
      color: colors.mutedForeground,
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
      ...type.labelStrong,
      fontSize: 10,
      color: "#ef4444",
      marginBottom: 2,
    },
    promoHeadline: {
      ...type.subheading,
      fontSize: 13,
      color: colors.foreground,
    },
    promoSub: {
      ...type.caption,
      fontSize: 11,
      color: colors.mutedForeground,
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
      ...type.micro,
      color: "#ffffff",
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
          <GhostLogo size={120} color={colors.foreground} />
          <Text style={styles.tagline}>NO FACE. NO TRACE.</Text>
          <Text style={styles.appName}>GHOSTFACE®</Text>
        </View>

        {step === "alias" ? (
          <>
            <Text style={styles.sectionTitle}>CHOOSE YOUR ALIAS</Text>
            <TextInput
              style={styles.input}
              value={alias}
              // Filter every keystroke (and paste) to the same allowlist the
              // server enforces — A-Z, 0-9, underscore only — so a decorated
              // or Unicode "fancy font" alias can never be entered in the
              // first place. What's shown here is always exactly what will
              // be registered; nothing gets silently transformed later.
              onChangeText={(t) => setAliasText(t.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              placeholder="GHOST_00"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              maxLength={16}
              autoCorrect={false}
              testID="alias-input"
            />

            {aliasStatus !== "idle" && (
              <Text
                style={[
                  styles.aliasStatusText,
                  {
                    color:
                      aliasStatus === "taken"
                        ? colors.destructive
                        : aliasStatus === "available"
                        ? colors.primary
                        : colors.mutedForeground,
                  },
                ]}
                testID="alias-status"
              >
                {aliasStatus === "checking" && "CHECKING AVAILABILITY…"}
                {aliasStatus === "available" && "AVAILABLE"}
                {aliasStatus === "taken" && "ALREADY TAKEN — TRY ANOTHER"}
                {aliasStatus === "unknown" && "COULDN'T VERIFY — YOU CAN STILL CONTINUE"}
              </Text>
            )}

            <View style={styles.suggestions}>
              {suggestions.map((s) => (
                <Pressable
                  key={s}
                  style={styles.suggestionChip}
                  onPress={() => pickSuggested(s)}
                >
                  <GoldGradient style={styles.suggestionChipInner}>
                    <Text style={styles.suggestionText}>{s}</Text>
                  </GoldGradient>
                </Pressable>
              ))}
              <Pressable
                style={styles.suggestionChip}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSuggestions(sampleAliases(SUGGESTIONS_SHOWN));
                }}
                testID="shuffle-suggestions"
              >
                <GoldGradient style={styles.suggestionChipInner}>
                  <Ionicons
                  name="shuffle"
                  size={14}
                  color={isLight ? colors.primaryForeground : colors.primary}
                />
                </GoldGradient>
              </Pressable>
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
                (alias.trim().length < 3 ||
                  aliasStatus === "taken" ||
                  aliasStatus === "checking") &&
                  styles.confirmBtnDisabled,
              ]}
              onPress={handleAliasConfirm}
              disabled={
                alias.trim().length < 3 ||
                aliasStatus === "taken" ||
                aliasStatus === "checking"
              }
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

            <Pressable
              style={styles.restoreLink}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setRestoreError("");
                setStep("restore");
              }}
              testID="go-to-restore"
            >
              <Text style={styles.restoreLinkText}>ALREADY HAVE AN IDENTITY? RESTORE FROM RECOVERY PHRASE</Text>
            </Pressable>
          </>
        ) : step === "pin" ? (
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
        ) : step === "recovery" ? (
          <>
            <Text style={styles.sectionTitle}>YOUR RECOVERY PHRASE</Text>
            <Text style={styles.pinOptionalLabel}>
              WRITE THIS DOWN — IT'S THE ONLY WAY TO RECOVER YOUR IDENTITY IF YOU LOSE THIS DEVICE. WE NEVER STORE IT AND CANNOT SHOW IT TO YOU AGAIN.
            </Text>

            <View style={styles.phraseBox}>
              <View style={styles.phraseGrid}>
                {recoveryPhrase.split(" ").map((word, i) => (
                  <View key={i} style={styles.phraseWordChip}>
                    <Text style={styles.phraseWordIndex}>{i + 1}</Text>
                    <Text style={styles.phraseWordText}>{word}</Text>
                  </View>
                ))}
              </View>
            </View>

            <Pressable
              style={styles.recoveryCheckRow}
              onPress={() => setRecoverySaved((s) => !s)}
              testID="recovery-saved-checkbox"
            >
              <Ionicons
                name={recoverySaved ? "checkbox" : "square-outline"}
                size={20}
                color={recoverySaved ? colors.primary : colors.mutedForeground}
              />
              <Text style={styles.recoveryCheckText}>I've written down my recovery phrase</Text>
            </Pressable>

            <Pressable
              style={[styles.confirmBtn, !recoverySaved && styles.confirmBtnDisabled]}
              onPress={handleRecoveryContinue}
              disabled={!recoverySaved}
              testID="recovery-continue"
            >
              <GoldGradient style={styles.confirmBtnInner}>
                <Text style={styles.confirmBtnText}>ENTER GHOSTFACE</Text>
              </GoldGradient>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable style={styles.backBtn} onPress={() => { setRestoreError(""); setStep("alias"); }}>
              <Ionicons name="arrow-back" size={16} color={colors.mutedForeground} />
              <Text style={styles.backText}>BACK</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>RESTORE YOUR IDENTITY</Text>
            <Text style={styles.pinOptionalLabel}>
              ENTER THE ALIAS YOU ORIGINALLY REGISTERED AND YOUR 24-WORD RECOVERY PHRASE
            </Text>

            <TextInput
              style={styles.input}
              value={restoreAlias}
              onChangeText={(t) => setRestoreAlias(t.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              placeholder="YOUR ORIGINAL ALIAS"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              maxLength={16}
              autoCorrect={false}
              testID="restore-alias-input"
            />

            <TextInput
              style={[styles.input, styles.phraseInput]}
              value={restorePhrase}
              onChangeText={(t) => { setRestorePhrase(t); setRestoreError(""); }}
              placeholder="24-word recovery phrase, separated by spaces"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              testID="restore-phrase-input"
            />

            {restoreError ? <Text style={styles.errorText}>{restoreError}</Text> : null}

            <Pressable
              style={[
                styles.confirmBtn,
                (restoring || restoreAlias.trim().length < 3 || !restorePhrase.trim()) && styles.confirmBtnDisabled,
              ]}
              onPress={handleRestoreSubmit}
              disabled={restoring || restoreAlias.trim().length < 3 || !restorePhrase.trim()}
              testID="restore-submit"
            >
              <GoldGradient style={styles.confirmBtnInner}>
                <Text style={styles.confirmBtnText}>{restoring ? "RESTORING…" : "RESTORE IDENTITY"}</Text>
              </GoldGradient>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
