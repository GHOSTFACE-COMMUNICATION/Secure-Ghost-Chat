import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
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
import * as ScreenCapture from "expo-screen-capture";
import { recoveryPhraseToKey } from "@/lib/recoveryPhrase";
import { formatInviteCodeInput, redeemInvite } from "@/lib/invites";
import { claimWelcomeGift } from "@/lib/welcomeGift";
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
// The welcome gift. One fixed offer, not a draw:
//  - The coin is tappable BEFORE an identity exists, so a client-side pick
//    could never be authoritative about what the server actually grants.
//  - A guaranteed gift is not a prize draw, so it carries none of Apple's
//    sweepstakes requirements or NZ promotional-competition rules — which
//    would otherwise apply in every territory the app ships to.
//  - SPECTER is software, so marginal cost is zero: this is an acquisition
//    trial, not a liability. PHANTOM stays the paid upgrade, and GHOST
//    NUMBER is excluded — it is the only offer with a real recurring cash
//    cost, and whether numbers may be assigned to end users at all is still
//    an open question with the supplier.
const WELCOME_GIFT = {
  eyebrow: "YOUR WELCOME GIFT",
  title: "1 MONTH OF SPECTER FREE",
} as const;

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
  const {
    setAlias,
    setPin,
    recoverIdentity,
    getRecoveryPhrase,
    storeRecoveryPinVerifier,
    checkRecoveryPin,
    markSignupPendingPhrase,
    completeOnboarding,
    addConversation,
    signupPendingAlias,
    themePreference,
  } = useApp();
  const isLight = themePreference === "light";
  const [alias, setAliasText] = useState("");
  // ⚠️ TEMPORARY PREVIEW, DO NOT COMMIT — jump straight to a later step so the
  // screens can be reviewed without registering a real identity.
  const PREVIEW_STEP = "recovery" as const;
  const [step, setStep] = useState<"alias" | "pin" | "recoveryPin" | "recovery" | "restore" | "resume">(
    PREVIEW_STEP ?? (signupPendingAlias ? "resume" : "alias"),
  );
  // If an interrupted signup is detected after this screen has already mounted
  // (load finished a beat later), jump to the resume step.
  useEffect(() => {
    if (signupPendingAlias && step === "alias") setStep("resume");
  }, [signupPendingAlias, step]);

  // Hidden refer-a-friend perk: a cryptic Pig-Latin nudge next to the coin.
  // Tapping it reveals a chance to earn a free month by inviting a friend.
  // Presentation only — the actual referral tracking + grant is server-side.
  const [gift, setGift] = useState<"idle" | "revealing" | "won">("idle");
  const giftAnim = useRef(new Animated.Value(0)).current;

  // Both the coin and the Pig-Latin nudge beside it run this — the nudge is
  // the hint, the coin is the thing it points at, and either should work.
  const handleCoinTap = () => {
    if (gift !== "idle") return;
    setGift("revealing");
    // Reveal as the coin flip settles.
    setTimeout(() => {
      setGift("won");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Animated.spring(giftAnim, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 10 }).start();
    }, 1400);
  };

  // Recovery phrase is the one thing the user MUST save — lift the app-wide
  // screen-capture block while it's shown so they can screenshot it, then
  // restore the block when they leave the step.
  useEffect(() => {
    if (step === "recovery") {
      ScreenCapture.allowScreenCaptureAsync();
      return () => {
        ScreenCapture.preventScreenCaptureAsync();
      };
    }
  }, [step]);
  const [pin, setPinText] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [recoverySaved, setRecoverySaved] = useState(false);
  // Optional invite code captured at the end of sign-up. With no contact
  // discovery by design, an invite is the only route to a first
  // conversation — so this is the moment to ask, while the invitee still has
  // the code they were sent in hand.
  const [inviteCode, setInviteCode] = useState("");
  const [inviteNote, setInviteNote] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  // Recovery PIN — the second factor that blinds the recovery phrase. Set once
  // here, never stored; required again to restore on a new device.
  const [recoveryPin, setRecoveryPin] = useState("");
  const [recoveryPinConfirm, setRecoveryPinConfirm] = useState("");
  const [recoveryPinError, setRecoveryPinError] = useState("");
  const [generatingPhrase, setGeneratingPhrase] = useState(false);
  const [restoreAlias, setRestoreAlias] = useState("");
  const [restorePhrase, setRestorePhrase] = useState("");
  const [restoreRecoveryPin, setRestoreRecoveryPin] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [restoring, setRestoring] = useState(false);
  // Resume-interrupted-signup step state.
  const [resumePin, setResumePin] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [resuming, setResuming] = useState(false);
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

  // Login PIN skipped. The identity is NOT registered until the recovery PIN
  // is set (handleRecoveryPinConfirm), so there's nothing to persist here.
  const handleSkipPin = () => {
    if (!normalizeAlias(alias)) { setStep("alias"); return; }
    setPinText("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep("recoveryPin");
  };

  const handlePinConfirm = () => {
    if (pin.length < 4) {
      setPinError("PIN must be at least 4 digits");
      return;
    }
    if (pin !== pinConfirm) {
      setPinError("PINs do not match");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (!normalizeAlias(alias)) { setStep("alias"); return; }
    // Keep the login PIN in state; it's applied once the identity is actually
    // registered in handleRecoveryPinConfirm.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setStep("recoveryPin");
  };

  // The recovery phrase encodes the identity key BLINDED with the recovery PIN
  // (lib/recoveryPin.ts). We set the PIN, THEN register the identity (so the
  // key exists to derive the phrase), THEN show the phrase. Onboarding is only
  // marked complete at "ENTER GHOSTFACE" (handleRecoveryContinue), so the user
  // can never skip past seeing their phrase.
  const handleRecoveryPinConfirm = async () => {
    if (!/^\d{6}$/.test(recoveryPin)) {
      setRecoveryPinError("Recovery PIN must be 6 digits");
      return;
    }
    if (recoveryPin !== recoveryPinConfirm) {
      setRecoveryPinError("Recovery PINs do not match");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    const normalized = normalizeAlias(alias);
    if (!normalized) { setStep("alias"); return; }
    setRecoveryPinError("");
    setGeneratingPhrase(true);
    try {
      // Store the PIN check value BEFORE registering, so an interrupted signup
      // can validate the PIN on resume (setAlias deliberately no longer clears it).
      await storeRecoveryPinVerifier(recoveryPin, normalized);
      // Register now (deferred from the alias/PIN steps).
      const result = await setAlias(normalized);
      if (!result.ok) {
        setGeneratingPhrase(false);
        if (result.error === "conflict") {
          setAliasStatus("taken");
          setStep("alias");
        } else {
          setRecoveryPinError("Couldn't register — check your connection and try again");
        }
        return;
      }
      // Registered: anchor the resume point, apply the login PIN if one was set.
      await markSignupPendingPhrase(normalized);
      if (pin.length >= 4) await setPin(pin);
      const phrase = await getRecoveryPhrase(recoveryPin, normalized);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setRecoveryPhrase(phrase ?? "");
      setStep("recovery");
    } catch {
      setRecoveryPinError("Couldn't generate your recovery phrase — try again");
    } finally {
      setGeneratingPhrase(false);
    }
  };

  // Resume an interrupted signup: identity already registered, but the phrase
  // was never confirmed saved. Validate the recovery PIN and re-show the phrase.
  const handleResumeSubmit = async () => {
    const a = signupPendingAlias;
    if (!a) { setStep("alias"); return; }
    if (!/^\d{6}$/.test(resumePin)) { setResumeError("Enter your 6-digit recovery PIN"); return; }
    setResumeError("");
    setResuming(true);
    try {
      const ok = await checkRecoveryPin(resumePin, a);
      if (!ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setResumeError("Incorrect recovery PIN");
        setResuming(false);
        return;
      }
      const phrase = await getRecoveryPhrase(resumePin, a);
      setRecoveryPhrase(phrase ?? "");
      setStep("recovery");
    } catch {
      setResumeError("Something went wrong — try again");
    } finally {
      setResuming(false);
    }
  };

  const handleRecoveryContinue = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await completeOnboarding();

    // An invite is a bonus, never a gate. A code that is expired, already
    // used, or simply mistyped must not strand someone on the last screen of
    // sign-up with a finished identity. So on failure the code is CLEARED
    // and the reason shown: the next press of the same button walks straight
    // into the app, with a pointer to where the invite can be retried. The
    // one thing that must never happen is a bad code from someone else
    // blocking an account that already exists.
    // Claim the welcome gift now that an identity exists. Fire-and-forget by
    // design: it is idempotent server-side, and a promotional grant must
    // never be able to hold up the end of sign-up. If it fails the user still
    // gets into the app; the grant can be retried on a later launch.
    void claimWelcomeGift();

    if (inviteCode) {
      setInviteBusy(true);
      const result = await redeemInvite(inviteCode, addConversation);
      setInviteBusy(false);
      if (!result.ok) {
        setInviteNote(
          result.reason === "used"
            ? "That invite has already been used. You can add a contact from MESSAGES."
            : result.reason === "expired"
            ? "That invite has expired. Ask for a new one, then add it from MESSAGES."
            : result.reason === "bad_format"
            ? "That doesn't look like an invite code. You can add one from MESSAGES."
            : "Couldn't redeem that invite. You can try again from MESSAGES.",
        );
        setInviteCode("");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

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
    if (!/^\d{6}$/.test(restoreRecoveryPin)) {
      setRestoreError("Enter your 6-digit recovery PIN");
      return;
    }
    setRestoreError("");
    setRestoring(true);
    const result = await recoverIdentity(normalizedRestoreAlias, restorePhrase, restoreRecoveryPin);
    setRestoring(false);
    if (!result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setRestoreError(
        result.error === "not_found"
          ? "No identity found for that alias"
          : result.error === "proof_failed"
          ? "That phrase and recovery PIN don't match this alias"
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
      // flexGrow, NOT flex. On a ScrollView's contentContainerStyle, flex: 1
      // pins the content to exactly the viewport height — contentSize equals
      // the visible area, the scroll range collapses to zero, and anything
      // taller than the screen is rendered but unreachable. That is what hid
      // the ENTER GHOSTFACE button on the recovery step, which is the tallest
      // screen in the flow: severe warning + 24 phrase chips + checkbox +
      // invite field. flexGrow: 1 still fills a short screen but lets a tall
      // one scroll.
      flexGrow: 1,
      backgroundColor: colors.background,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0),
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0),
      paddingHorizontal: 24,
    },
    header: {
      alignItems: "center",
      marginTop: 8,
      marginBottom: 30,
    },
    pigLatinNudge: {
      position: "absolute",
      right: 8,
      top: 64,
      paddingVertical: 4,
      paddingHorizontal: 6,
    },
    pigLatinText: {
      fontFamily: "ShareTechMono_400Regular",
      fontSize: 11,
      lineHeight: 15,
      letterSpacing: 1,
      color: "rgba(201,154,60,0.8)",
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
      fontFamily: "Cinzel_700Bold",
      fontSize: 27,
      letterSpacing: 1.5,
      color: colors.primary,
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
      backgroundColor: "rgba(255,255,255,0.06)",
      color: colors.foreground,
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.85)",
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
    giftCard: {
      borderRadius: colors.radius,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.9)",
    },
    giftCardInner: {
      borderRadius: colors.radius,
      paddingHorizontal: 18,
      paddingVertical: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    suggestionChip: { borderRadius: colors.radius, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.9)" },
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
      borderColor: "rgba(255,255,255,0.85)",
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
    inviteBlock: {
      marginBottom: 18,
    },
    inviteLabel: {
      ...type.caption,
      fontSize: 11,
      letterSpacing: 1.6,
      color: colors.mutedForeground,
      marginBottom: 6,
    },
    inviteHint: {
      ...type.caption,
      fontSize: 11,
      color: colors.mutedForeground,
      marginBottom: 10,
      lineHeight: 16,
    },
    inviteInput: {
      ...type.mono,
      fontSize: 15,
      textTransform: "none" as const,
    },
    inviteNote: {
      ...type.caption,
      fontSize: 11,
      color: "#E5A23D",
      marginTop: 8,
      lineHeight: 16,
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
    recoveryWarning: {
      flexDirection: "row",
      gap: 10,
      alignItems: "flex-start",
      borderWidth: 1,
      borderColor: "rgba(229,72,77,0.55)",
      backgroundColor: "rgba(229,72,77,0.10)",
      borderRadius: colors.radius,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 16,
    },
    recoveryWarningTitle: {
      ...type.labelStrong,
      fontSize: 11,
      letterSpacing: 0.8,
      color: "#F0787C",
      marginBottom: 4,
    },
    recoveryWarningText: {
      ...type.caption,
      fontSize: 12,
      lineHeight: 17,
      color: colors.foreground,
    },
    promoBanner: {
      borderWidth: 1,
      borderColor: "rgba(201,154,60,0.45)",
      borderRadius: colors.radius,
      backgroundColor: "rgba(201,154,60,0.08)",
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
      backgroundColor: "rgba(201,154,60,0.16)",
      alignItems: "center",
      justifyContent: "center",
    },
    promoTextWrap: {
      flex: 1,
    },
    promoLabel: {
      ...type.labelStrong,
      fontSize: 10,
      color: "#C99A3C",
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
      backgroundColor: "#C99A3C",
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
          <View style={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
            <GhostLogo size={180} coin live onTap={handleCoinTap} />
            {/* Cryptic Pig-Latin nudge tucked beside the coin — "psst, tap
                here". It points at the coin, so it runs the same handler:
                whichever the eye lands on first should work. */}
            {gift === "idle" && (
              <Pressable onPress={handleCoinTap} hitSlop={12} style={styles.pigLatinNudge}>
                <Text style={styles.pigLatinText}>sst…{"\n"}apTay{"\n"}erehay</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.tagline}>NO FACE. NO TRACE.</Text>
          <Text style={styles.appName}>GHOSTFACE®</Text>
        </View>

        {gift === "won" ? (
          <Animated.View
            style={{
              alignItems: "center",
              marginBottom: 20,
              opacity: giftAnim,
              transform: [{ scale: giftAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
            }}
          >
            {/* Same glass treatment as the alias chips: a GoldGradient surface
                inside a thin white rim. Was a flat rgba(201,154,60) fill, which
                read as brown against the black backdrop and matched nothing
                else in the app. */}
            <View style={styles.giftCard}>
              <GoldGradient style={styles.giftCardInner}>
                <Text style={{ ...type.labelStrong, fontSize: 9, color: "#F5D26B", letterSpacing: 1.5 }}>
                  {WELCOME_GIFT.eyebrow}
                </Text>
                <Text style={{ ...type.subheading, fontSize: 13, color: colors.foreground, marginTop: 2 }}>
                  {WELCOME_GIFT.title}
                </Text>
              </GoldGradient>
            </View>
            <Text style={{ ...type.caption, fontSize: 10, color: colors.mutedForeground, marginTop: 6, textAlign: "center" }}>
              Applied automatically once you finish setup.
            </Text>
          </Animated.View>
        ) : (
          <Pressable onPress={handleCoinTap} style={{ alignItems: "center", marginBottom: 20 }}>
            <Text
              style={{ ...type.labelStrong, fontSize: 11, color: colors.primary, letterSpacing: 1, textAlign: "center" }}
            >
              {gift === "revealing" ? "OPENING…" : "REFER A FRIEND — TAP THE COIN FOR YOUR WELCOME GIFT"}
            </Text>
          </Pressable>
        )}

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
        ) : step === "recoveryPin" ? (
          <>
            <Pressable style={styles.backBtn} onPress={() => setStep("pin")}>
              <Ionicons name="arrow-back" size={16} color={colors.mutedForeground} />
              <Text style={styles.backText}>BACK</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>SET YOUR RECOVERY PIN</Text>
            <Text style={styles.pinOptionalLabel}>
              A 6-DIGIT SECOND FACTOR. TO RESTORE ON A NEW DEVICE YOU'LL NEED THIS PIN AND YOUR RECOVERY PHRASE — THE PHRASE ALONE ISN'T ENOUGH. WE NEVER STORE IT, SO DON'T FORGET IT.
            </Text>
            <TextInput
              style={styles.input}
              value={recoveryPin}
              onChangeText={(t) => { setRecoveryPin(t.replace(/\D/g, "")); setRecoveryPinError(""); }}
              placeholder="••••••"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              secureTextEntry
              maxLength={6}
              testID="recovery-pin-input"
            />
            <TextInput
              style={[styles.input, { marginBottom: recoveryPinError ? 8 : 16 }]}
              value={recoveryPinConfirm}
              onChangeText={(t) => { setRecoveryPinConfirm(t.replace(/\D/g, "")); setRecoveryPinError(""); }}
              placeholder="CONFIRM RECOVERY PIN"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              secureTextEntry
              maxLength={6}
              testID="recovery-pin-confirm-input"
            />
            {recoveryPinError ? (
              <Text style={styles.errorText}>{recoveryPinError}</Text>
            ) : null}

            <Pressable
              style={[
                styles.confirmBtn,
                (recoveryPin.length < 6 || generatingPhrase) && styles.confirmBtnDisabled,
              ]}
              onPress={handleRecoveryPinConfirm}
              disabled={recoveryPin.length < 6 || generatingPhrase}
              testID="recovery-pin-confirm-btn"
            >
              <GoldGradient style={styles.confirmBtnInner}>
                <Text style={styles.confirmBtnText}>
                  {generatingPhrase ? "GENERATING…" : "SET RECOVERY PIN"}
                </Text>
              </GoldGradient>
            </Pressable>

            <View style={styles.disclaimerRow}>
              <Ionicons name="lock-closed" size={12} color={colors.mutedForeground} />
              <Text style={styles.disclaimerText}>
                Required — your only second factor for recovery
              </Text>
            </View>
          </>
        ) : step === "recovery" ? (
          <>
            <Text style={styles.sectionTitle}>YOUR RECOVERY PHRASE</Text>
            <View style={styles.recoveryWarning}>
              <Ionicons name="warning" size={18} color="#E5484D" style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.recoveryWarningTitle}>
                  THIS IS THE ONLY WAY TO RECOVER YOUR ACCOUNT
                </Text>
                <Text style={styles.recoveryWarningText}>
                  Write down these 24 words and keep them safe. To restore on a new device you'll need them together with your 6-digit recovery PIN — neither one works without the other. We never store either, so if you lose the phrase and this device, your alias is gone for good. No reset, no support recovery.
                </Text>
              </View>
            </View>

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

            <View style={styles.inviteBlock}>
              <Text style={styles.inviteLabel}>HAVE AN INVITE CODE?</Text>
              <Text style={styles.inviteHint}>
                Optional. Paste the code you were sent and we'll add them as your
                first contact.
              </Text>
              <TextInput
                style={[styles.input, styles.inviteInput]}
                value={inviteCode}
                onChangeText={(t) => {
                  setInviteNote("");
                  setInviteCode(formatInviteCodeInput(t));
                }}
                placeholder="GF-XXXX-XXXX"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                editable={!inviteBusy}
                testID="onboarding-invite-code"
              />
              {inviteNote ? <Text style={styles.inviteNote}>{inviteNote}</Text> : null}
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
        ) : step === "resume" ? (
          <>
            <Text style={styles.sectionTitle}>FINISH SETTING UP</Text>
            <View style={styles.recoveryWarning}>
              <Ionicons name="warning" size={18} color="#E5484D" style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.recoveryWarningTitle}>
                  YOU HAVEN'T SAVED YOUR RECOVERY PHRASE YET
                </Text>
                <Text style={styles.recoveryWarningText}>
                  Your sign-up was interrupted before you saved your recovery phrase. Enter your 6-digit recovery PIN to see it and finish — without it you can't recover this account.
                </Text>
              </View>
            </View>
            <TextInput
              style={styles.input}
              value={resumePin}
              onChangeText={(t) => { setResumePin(t.replace(/\D/g, "")); setResumeError(""); }}
              placeholder="6-DIGIT RECOVERY PIN"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              secureTextEntry
              maxLength={6}
              testID="resume-recovery-pin-input"
              autoFocus
            />
            {resumeError ? <Text style={styles.errorText}>{resumeError}</Text> : null}
            <Pressable
              style={[styles.confirmBtn, (resuming || resumePin.length < 6) && styles.confirmBtnDisabled]}
              onPress={handleResumeSubmit}
              disabled={resuming || resumePin.length < 6}
              testID="resume-submit"
            >
              <GoldGradient style={styles.confirmBtnInner}>
                <Text style={styles.confirmBtnText}>{resuming ? "CHECKING…" : "SHOW MY RECOVERY PHRASE"}</Text>
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
              ENTER YOUR ORIGINAL ALIAS, YOUR 24-WORD RECOVERY PHRASE, AND YOUR 6-DIGIT RECOVERY PIN
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

            <TextInput
              style={styles.input}
              value={restoreRecoveryPin}
              onChangeText={(t) => { setRestoreRecoveryPin(t.replace(/\D/g, "")); setRestoreError(""); }}
              placeholder="6-DIGIT RECOVERY PIN"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="numeric"
              secureTextEntry
              maxLength={6}
              testID="restore-recovery-pin-input"
            />

            {restoreError ? <Text style={styles.errorText}>{restoreError}</Text> : null}

            <Pressable
              style={[
                styles.confirmBtn,
                (restoring || restoreAlias.trim().length < 3 || !restorePhrase.trim() || restoreRecoveryPin.length < 6) && styles.confirmBtnDisabled,
              ]}
              onPress={handleRestoreSubmit}
              disabled={restoring || restoreAlias.trim().length < 3 || !restorePhrase.trim() || restoreRecoveryPin.length < 6}
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
