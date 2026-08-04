import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { QRScanner, encodeContactQR, encodeInviteQR } from "@/components/QRScanner";
import { GoldGradient } from "@/components/GoldGradient";
import { CODE_REGEX, type RedeemFailReason, type RedeemResult, lookupInviteCode, consumeInviteCode } from "@/lib/invites";

const TIMER_OPTIONS = [
  { label: "10 MIN", ms: 10 * 60 * 1000 },
  { label: "1 HR",   ms: 60 * 60 * 1000 },
  { label: "24 HR",  ms: 24 * 60 * 60 * 1000 },
  { label: "7 DAY",  ms: 7 * 24 * 60 * 60 * 1000 },
];

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    if (__DEV__) console.error("[ghostface] EXPO_PUBLIC_DOMAIN is not set — invite API calls will be skipped. Set it in .env or eas.json.");
    return "";
  }
  return `https://${domain}/api`;
}

function genCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "GF-";
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  c += "-";
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "EXPIRED";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}D ${h % 24}H ${m % 60}M`;
  if (h > 0) return `${h}H ${m % 60}M ${s % 60}S`;
  return `${m}M ${s % 60}S`;
}

/**
 * POST the invite code to the server so it maps to the owner's real alias.
 * If the server is unreachable we skip silently — typed codes won't work
 * offline, but QR scanning (which uses the owner's alias directly) still will.
 */
async function registerInviteOnServer(
  code: string,
  ownerAlias: string,
  expiresAt: number,
): Promise<void> {
  const apiBase = getApiBase();
  if (!apiBase || !ownerAlias) return;
  try {
    await fetch(`${apiBase}/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.toUpperCase(), ownerAlias, expiresAt }),
    });
  } catch {
    // Non-critical
  }
}

type RedeemState = "idle" | "success" | RedeemFailReason;

export default function GhostInvite() {
  const colors = useColors();
  const { addConversation, alias: myAlias } = useApp();
  const [showScanner, setShowScanner] = useState(false);
  const [code, setCode] = useState(genCode);
  const [timerIdx, setTimerIdx] = useState(0);
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + TIMER_OPTIONS[0].ms);
  const [remaining, setRemaining] = useState(TIMER_OPTIONS[0].ms);
  const [copied, setCopied] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemState, setRedeemState] = useState<RedeemState>("idle");
  const [redeemAlias, setRedeemAlias] = useState("");

  // Register the initial code with the server when we first have an alias
  const registeredRef = useRef<string>("");
  useEffect(() => {
    if (myAlias && code && registeredRef.current !== code) {
      registeredRef.current = code;
      void registerInviteOnServer(code, myAlias, expiresAt);
    }
  }, [myAlias, code, expiresAt]);

  const handleRedeemChange = (text: string) => {
    setRedeemState("idle");
    const upper = text.toUpperCase().replace(/[^A-Z2-9-]/g, "");
    let formatted: string;
    const raw = upper.replace(/-/g, "");
    if (raw.length <= 2) {
      formatted = raw;
    } else if (raw.length <= 6) {
      formatted = `GF-${raw.slice(2)}`;
    } else {
      formatted = `GF-${raw.slice(2, 6)}-${raw.slice(6, 10)}`;
    }
    setRedeemInput(formatted);
  };

  const handleRedeem = async () => {
    if (!CODE_REGEX.test(redeemInput)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setRedeemState("bad_format");
      setTimeout(() => setRedeemState("idle"), 4000);
      return;
    }

    const lookup = await lookupInviteCode(redeemInput);
    if (!lookup.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setRedeemState(lookup.reason);
      setTimeout(() => setRedeemState("idle"), 4000);
      return;
    }

    const added = await addConversation(lookup.ownerAlias);
    if (!added.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setRedeemState("connection_failed");
      setTimeout(() => setRedeemState("idle"), 4000);
      return;
    }

    // Handshake confirmed — now atomically consume the code
    const consume = await consumeInviteCode(redeemInput);
    if (!consume.ok && !consume.alreadyUsed) {
      console.warn("[invite] consume failed after successful redeem");
    }

    setRedeemAlias(lookup.ownerAlias);
    setRedeemInput("");
    setRedeemState("success");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setRedeemState("idle"), 4000);
  };

  const reset = useCallback(
    (idx?: number) => {
      const i = idx ?? timerIdx;
      const newCode = genCode();
      const exp = Date.now() + TIMER_OPTIONS[i].ms;
      setCode(newCode);
      setExpiresAt(exp);
      setRemaining(TIMER_OPTIONS[i].ms);
      setCopied(false);
      registeredRef.current = newCode;
      void registerInviteOnServer(newCode, myAlias ?? "", exp);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [timerIdx, myAlias],
  );

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const r = expiresAt - Date.now();
      setRemaining(r > 0 ? r : 0);
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [expiresAt]);

  const expired = remaining <= 0;
  // QR encodes the invite code so scanners can look it up server-side
  const qrValue = encodeInviteQR(code);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2500);
  };

  const buildInviteShareText = (c: string) =>
    `Join me on GHOSTFACE 👻\nMy invite code: ${c}\n\niOS: https://apps.apple.com/app/id6781518828\nAndroid: https://play.google.com/store/apps/details?id=com.ghostface.app`;

  const handleCopyShare = async () => {
    await Clipboard.setStringAsync(buildInviteShareText(code));
    setCopiedShare(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopiedShare(false), 2000);
  };

  const handleSend = async () => {
    try {
      await Share.share({ message: buildInviteShareText(code) });
    } catch {
      // user cancelled or share sheet unavailable
    }
  };

  const handleTimer = (idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimerIdx(idx);
    const exp = Date.now() + TIMER_OPTIONS[idx].ms;
    setExpiresAt(exp);
    setRemaining(TIMER_OPTIONS[idx].ms);
  };

  /**
   * Called by QRScanner after decodeContactQR runs.
   * The scanned value is either:
   *  - an invite code (GF-XXXX-XXXX) — look it up server-side, then start conversation
   *  - a plain alias — start conversation directly
   */
  const handleQRScan = async (decoded: string) => {
    if (CODE_REGEX.test(decoded)) {
      // Scanned an invite code QR — lookup → add → consume
      const lookup = await lookupInviteCode(decoded);
      if (!lookup.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setRedeemState(lookup.reason);
        setTimeout(() => setRedeemState("idle"), 4000);
        return;
      }
      const added = await addConversation(lookup.ownerAlias);
      if (!added.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setRedeemState("connection_failed");
        setTimeout(() => setRedeemState("idle"), 4000);
        return;
      }
      const consume = await consumeInviteCode(decoded);
      if (!consume.ok && !consume.alreadyUsed) {
        console.warn("[invite] QR consume failed after successful add");
      }
      setRedeemAlias(lookup.ownerAlias);
      setRedeemState("success");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setRedeemState("idle"), 4000);
    } else {
      // Scanned a contact QR (ghostface://add/<alias>)
      const added = await addConversation(decoded);
      if (added.ok) {
        setRedeemAlias(decoded);
        setRedeemState("success");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setRedeemState("not_found");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      setTimeout(() => setRedeemState("idle"), 4000);
    }
  };

  const redeemErrorLabel = (): string => {
    switch (redeemState) {
      case "bad_format": return "INVALID CODE FORMAT";
      case "not_found":  return "CODE NOT FOUND";
      case "expired":    return "CODE HAS EXPIRED";
      case "used":       return "CODE ALREADY USED";
      case "offline":    return "SERVER UNREACHABLE";
      case "connection_failed": return "CODE VALID — CONNECTION FAILED, TRY AGAIN";
      default:           return "COULD NOT REDEEM";
    }
  };

  const isErrorState = (s: RedeemState): boolean =>
    s !== "idle" && s !== "success";

  const styles = StyleSheet.create({
    scroll: { flex: 1 },
    content: { padding: 20, gap: 20, paddingBottom: 120 },
    sectionLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 3,
      marginBottom: 8,
    },
    qrCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: expired ? colors.destructive : colors.border,
      alignItems: "center",
      padding: 24,
      gap: 16,
    },
    qrWrap: {
      padding: 12,
      backgroundColor: "#FFFFFF",
      borderRadius: 8,
      opacity: expired ? 0.25 : 1,
    },
    expiredOverlay: {
      position: "absolute",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    expiredTxt: {
      color: colors.destructive,
      fontSize: 18,
      fontWeight: "800",
      letterSpacing: 4,
    },
    codeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    codeText: {
      color: expired ? colors.mutedForeground : colors.primary,
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: 6,
      fontFamily: "monospace",
    },
    copyBtn: {
      backgroundColor: copied ? colors.success : colors.muted,
      borderRadius: 8,
      padding: 8,
      borderWidth: 1,
      borderColor: copied ? colors.success : colors.border,
    },
    countdownRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    countdownTxt: {
      color: expired ? colors.destructive : remaining < 60000 ? colors.destructive : colors.mutedForeground,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 2,
      fontFamily: "monospace",
    },
    selfDestructBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: "rgba(255,59,48,0.12)",
      borderWidth: 1,
      borderColor: colors.destructive,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    selfDestructTxt: {
      color: colors.destructive,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 2,
    },
    timerRow: {
      flexDirection: "row",
      gap: 8,
    },
    timerBtn: {
      flex: 1,
      paddingVertical: 9,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    },
    timerBtnActive: {
      backgroundColor: "rgba(255,59,48,0.15)",
      borderColor: colors.destructive,
    },
    timerTxt: {
      color: colors.mutedForeground,
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 2,
    },
    timerTxtActive: {
      color: colors.destructive,
    },
    regenBtn: {
      borderRadius: colors.radius,
      overflow: "hidden",
    },
    goldBtnInner: {
      borderRadius: colors.radius,
      paddingVertical: 14,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 8,
    },
    regenBtnTxt: {
      color: colors.primaryForeground,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 3,
    },
    infoCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 10,
    },
    infoRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
    },
    infoTxt: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 1,
      flex: 1,
      lineHeight: 18,
    },
    redeemCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.primary,
      padding: 20,
      gap: 14,
    },
    redeemTitle: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: "800",
      letterSpacing: 4,
    },
    redeemSub: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 1,
      marginTop: -6,
    },
    redeemInput: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: 20,
      fontWeight: "800",
      letterSpacing: 6,
      fontFamily: "monospace",
      borderWidth: 1,
      borderColor: isErrorState(redeemState)
        ? colors.destructive
        : redeemState === "success"
          ? colors.success
          : colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 16,
      paddingVertical: 14,
      textAlign: "center",
    },
    redeemBtn: {
      borderRadius: colors.radius,
      overflow: "hidden",
    },
    redeemBtnTxt: {
      color: colors.primaryForeground,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 3,
    },
    redeemFeedback: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 8,
      paddingVertical: 4,
    },
    redeemFeedbackTxt: {
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 2,
    },
    myQrCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.primary,
      alignItems: "center",
      padding: 24,
      gap: 14,
    },
    myQrAlias: {
      color: colors.primary,
      fontSize: 20,
      fontWeight: "800",
      letterSpacing: 6,
    },
    myQrSub: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 2,
      textAlign: "center",
    },
    scanBtn: {
      borderRadius: colors.radius,
      overflow: "hidden",
    },
    scanBtnTxt: {
      color: colors.primaryForeground,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 3,
    },
    shareRow: {
      flexDirection: "row" as const,
      gap: 10,
      width: "100%" as const,
    },
    shareBtn: {
      flex: 1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 6,
      paddingVertical: 11,
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
    },
    shareBtnActive: {
      backgroundColor: "rgba(32,138,239,0.15)",
      borderColor: colors.primary,
    },
    shareBtnTxt: {
      color: colors.mutedForeground,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 2,
    },
    shareBtnTxtActive: {
      color: colors.primary,
    },
  });

  return (
    <>
    <QRScanner
      visible={showScanner}
      onClose={() => setShowScanner(false)}
      onScan={handleQRScan}
    />
    <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.content}>

        {/* My QR code */}
        {myAlias && (
          <View>
            <Text style={styles.sectionLabel}>MY GHOST QR CODE</Text>
            <View style={styles.myQrCard}>
              <View style={{ padding: 12, backgroundColor: "#FFFFFF", borderRadius: 8 }}>
                <QRCode
                  value={encodeContactQR(myAlias)}
                  size={180}
                  color="#000000"
                  backgroundColor="#FFFFFF"
                />
              </View>
              <Text style={styles.myQrAlias}>{myAlias}</Text>
              <Text style={styles.myQrSub}>Let others scan this to add you instantly</Text>
            </View>
          </View>
        )}

        {/* Scan button */}
        <Pressable
          style={styles.scanBtn}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowScanner(true); }}
        >
          <GoldGradient style={styles.goldBtnInner}>
            <Ionicons name="qr-code-outline" size={18} color={colors.primaryForeground} />
            <Text style={styles.scanBtnTxt}>SCAN THEIR QR CODE</Text>
          </GoldGradient>
        </Pressable>

        {/* QR card */}
        <View>
          <Text style={styles.sectionLabel}>ENCRYPTED INVITE CODE</Text>
          <View style={styles.qrCard}>

            {/* Self-destruct badge */}
            <View style={styles.selfDestructBadge}>
              <Ionicons name="flame-outline" size={10} color={colors.destructive} />
              <Text style={styles.selfDestructTxt}>SELF-DESTRUCT ENABLED</Text>
            </View>

            {/* QR code */}
            <View>
              <View style={styles.qrWrap}>
                <QRCode
                  value={expired ? "EXPIRED" : qrValue}
                  size={180}
                  color="#000000"
                  backgroundColor="#FFFFFF"
                />
              </View>
              {expired && (
                <View style={[StyleSheet.absoluteFill, styles.expiredOverlay]}>
                  <Ionicons name="ban-outline" size={40} color={colors.destructive} />
                  <Text style={styles.expiredTxt}>EXPIRED</Text>
                </View>
              )}
            </View>

            {/* Code text + copy */}
            <View style={styles.codeRow}>
              <Text style={styles.codeText}>{code}</Text>
              {!expired && (
                <Pressable style={styles.copyBtn} onPress={handleCopy}>
                  <Ionicons
                    name={copied ? "checkmark" : "copy-outline"}
                    size={18}
                    color={copied ? colors.success : colors.mutedForeground}
                  />
                </Pressable>
              )}
            </View>

            {/* Countdown */}
            <View style={styles.countdownRow}>
              <Ionicons
                name="timer-outline"
                size={12}
                color={expired ? colors.destructive : remaining < 60000 ? colors.destructive : colors.mutedForeground}
              />
              <Text style={styles.countdownTxt}>
                {expired ? "CODE DESTROYED" : `DESTROYS IN  ${fmtCountdown(remaining)}`}
              </Text>
            </View>

            {/* Copy + Send */}
            {!expired && (
              <View style={styles.shareRow}>
                <Pressable
                  style={[styles.shareBtn, copiedShare && styles.shareBtnActive]}
                  onPress={handleCopyShare}
                >
                  <Ionicons
                    name={copiedShare ? "checkmark" : "copy-outline"}
                    size={14}
                    color={copiedShare ? colors.primary : colors.mutedForeground}
                  />
                  <Text style={[styles.shareBtnTxt, copiedShare && styles.shareBtnTxtActive]}>
                    {copiedShare ? "COPIED" : "COPY"}
                  </Text>
                </Pressable>
                <Pressable style={styles.shareBtn} onPress={handleSend}>
                  <Ionicons name="share-outline" size={14} color={colors.mutedForeground} />
                  <Text style={styles.shareBtnTxt}>SEND</Text>
                </Pressable>
              </View>
            )}

          </View>
        </View>

        {/* Self-destruct timer selector */}
        <View>
          <Text style={styles.sectionLabel}>SELF-DESTRUCT TIMER</Text>
          <View style={styles.timerRow}>
            {TIMER_OPTIONS.map((opt, i) => (
              <Pressable
                key={opt.label}
                style={[styles.timerBtn, timerIdx === i && styles.timerBtnActive]}
                onPress={() => handleTimer(i)}
              >
                <Text style={[styles.timerTxt, timerIdx === i && styles.timerTxtActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Generate new code */}
        <Pressable
          style={({ pressed }) => [styles.regenBtn, pressed && { opacity: 0.8 }]}
          onPress={() => reset()}
        >
          <GoldGradient style={styles.goldBtnInner}>
            <Ionicons name="refresh-outline" size={16} color={colors.primaryForeground} />
            <Text style={styles.regenBtnTxt}>GENERATE NEW CODE</Text>
          </GoldGradient>
        </Pressable>

        {/* Info */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="qr-code-outline" size={14} color={colors.primary} />
            <Text style={styles.infoTxt}>Share your code with your contact. They enter it below to establish an encrypted channel.</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="flame-outline" size={14} color={colors.destructive} />
            <Text style={styles.infoTxt}>Codes self-destruct after the selected time. Once expired they cannot be used and leave no trace.</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="shield-checkmark-outline" size={14} color={colors.success} />
            <Text style={styles.infoTxt}>Each code is one-time use. After a contact connects, the code is automatically invalidated.</Text>
          </View>
        </View>

        {/* Redeem a code */}
        <View>
          <Text style={styles.sectionLabel}>RECEIVED A CODE?</Text>
          <View style={styles.redeemCard}>
            <Text style={styles.redeemTitle}>REDEEM GHOST CODE</Text>
            <Text style={styles.redeemSub}>Enter the code your contact shared with you</Text>

            <TextInput
              style={styles.redeemInput}
              value={redeemInput}
              onChangeText={handleRedeemChange}
              placeholder="GF-XXXX-XXXX"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
            />

            {redeemState === "success" && (
              <View style={styles.redeemFeedback}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={[styles.redeemFeedbackTxt, { color: colors.success }]}>
                  CHANNEL OPEN · {redeemAlias}
                </Text>
              </View>
            )}
            {isErrorState(redeemState) && (
              <View style={styles.redeemFeedback}>
                <Ionicons name="close-circle" size={16} color={colors.destructive} />
                <Text style={[styles.redeemFeedbackTxt, { color: colors.destructive }]}>
                  {redeemErrorLabel()}
                </Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.redeemBtn,
                (redeemInput.length < 12 || redeemState === "success") && { opacity: 0.4 },
                pressed && { opacity: 0.75 },
              ]}
              onPress={handleRedeem}
              disabled={redeemInput.length < 12 || redeemState === "success"}
            >
              <GoldGradient style={styles.goldBtnInner}>
                <Ionicons name="enter-outline" size={16} color={colors.primaryForeground} />
                <Text style={styles.redeemBtnTxt}>ESTABLISH CHANNEL</Text>
              </GoldGradient>
            </Pressable>
          </View>
        </View>

      </View>
    </ScrollView>
    </>
  );
}
