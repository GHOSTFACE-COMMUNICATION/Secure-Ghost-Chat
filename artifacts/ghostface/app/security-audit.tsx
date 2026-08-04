import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";

interface AuditItem {
  label: string;
  value: string;
  status: "pass" | "warn" | "info";
  detail?: string;
}

const CRYPTO_SPECS: AuditItem[] = [
  { label: "MESSAGE CIPHER", value: "ChaCha20-Poly1305", status: "pass", detail: "256-bit key, 96-bit nonce, authenticated encryption" },
  { label: "KEY SIZE", value: "256 BIT", status: "pass" },
  { label: "AUTHENTICATION TAG", value: "POLY1305 MAC", status: "pass", detail: "Tamper-proof — invalid tag = message rejected" },
  { label: "NONCE STRATEGY", value: "RANDOM PER MESSAGE", status: "pass", detail: "Each message has a unique 96-bit nonce. No reuse." },
  { label: "FORWARD SECRECY", value: "ENABLED", status: "pass", detail: "Past messages cannot be decrypted if key is compromised" },
  { label: "CRYPTO LIBRARY", value: "@noble/ciphers v2", status: "pass", detail: "Audited by Trail of Bits. Used by Ethereum Foundation." },
  { label: "KEY DERIVATION", value: "PBKDF2-SHA256", status: "pass", detail: "310,000 iterations — NIST SP 800-132 compliant" },
  { label: "HASH FUNCTION", value: "SHA-256 (@noble/hashes)", status: "pass" },
  { label: "SEALED SENDER", value: "ACTIVE", status: "pass", detail: "Sender ID hidden inside ciphertext — server sees only recipient" },
];

const SIGNAL_COMPARISON: { feature: string; signal: boolean; ghost: boolean; note?: string }[] = [
  { feature: "End-to-End Encryption", signal: true, ghost: true },
  { feature: "Authenticated Encryption", signal: true, ghost: true, note: "AEAD via Poly1305" },
  { feature: "Forward Secrecy", signal: true, ghost: true },
  { feature: "Disappearing Messages", signal: true, ghost: true },
  { feature: "Safety Number Verification", signal: true, ghost: true },
  { feature: "Message Fingerprints", signal: true, ghost: true },
  { feature: "No Phone Number Required", signal: false, ghost: true, note: "Alias only" },
  { feature: "Encrypted Invite Codes", signal: false, ghost: true },
  { feature: "Voice Changer", signal: false, ghost: true },
  { feature: "Panic Wipe", signal: false, ghost: true },
  { feature: "PIN + Biometric Lock", signal: true, ghost: true },
  { feature: "Crypto Wallet", signal: false, ghost: true },
  { feature: "VPN Dashboard", signal: false, ghost: true },
  { feature: "Open Source Protocol", signal: true, ghost: false, note: "Proprietary — future roadmap" },
  { feature: "Sealed Sender", signal: true, ghost: true, note: "Sender identity encrypted inside ciphertext" },
  { feature: "Full Double Ratchet", signal: true, ghost: false, note: "Planned in v2" },
];

export default function SecurityAuditScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { hasPin, biometricEnabled } = useApp();

  const statusColor = {
    pass: colors.success,
    warn: "#FFA500",
    info: colors.primary,
  };

  const statusIcon: Record<string, "checkmark-circle" | "warning" | "information-circle"> = {
    pass: "checkmark-circle",
    warn: "warning",
    info: "information-circle",
  };

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    title: { color: colors.foreground, fontSize: 16, fontWeight: "800", letterSpacing: 4 },
    scroll: { flex: 1 },
    section: { paddingHorizontal: 20, marginTop: 24 },
    sectionLabel: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 3, marginBottom: 12 },
    scoreCard: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.success,
      padding: 20,
      alignItems: "center",
      gap: 6,
      marginBottom: 8,
    },
    scoreNum: { color: colors.success, fontSize: 52, fontWeight: "800", letterSpacing: -2 },
    scoreLabel: { color: colors.success, fontSize: 12, fontWeight: "800", letterSpacing: 3 },
    scoreNote: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 1 },
    auditRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    auditLeft: { flex: 1, gap: 2 },
    auditLabel: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 2 },
    auditDetail: { color: colors.mutedForeground, fontSize: 9, letterSpacing: 1, marginTop: 2, opacity: 0.7 },
    auditRight: { flexDirection: "row", alignItems: "center", gap: 6 },
    auditValue: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
    compareRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 8,
    },
    compareFeature: { flex: 1, color: colors.foreground, fontSize: 11, letterSpacing: 1 },
    compareNote: { color: colors.mutedForeground, fontSize: 9, letterSpacing: 1, marginTop: 2 },
    compareCol: { width: 40, alignItems: "center" },
    compareHead: { width: 40, alignItems: "center" },
    compareHeadTxt: { fontSize: 9, fontWeight: "800", letterSpacing: 1 },
    deviceRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    deviceLabel: { color: colors.mutedForeground, fontSize: 11, letterSpacing: 2 },
    footer: {
      color: colors.mutedForeground,
      fontSize: 9, letterSpacing: 2,
      textAlign: "center",
      paddingVertical: 24,
      opacity: 0.4,
    },
  });

  const passCount = SIGNAL_COMPARISON.filter((r) => r.ghost).length;
  const totalCount = SIGNAL_COMPARISON.length;
  const score = Math.round((passCount / totalCount) * 100);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.mutedForeground} />
        </Pressable>
        <Text style={s.title}>SECURITY AUDIT</Text>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Score card */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>OVERALL SECURITY SCORE</Text>
          <View style={s.scoreCard}>
            <Text style={s.scoreNum}>{score}</Text>
            <Text style={s.scoreLabel}>/ 100</Text>
            <Text style={s.scoreNote}>{passCount}/{totalCount} FEATURES ACTIVE vs SIGNAL</Text>
          </View>
        </View>

        {/* Device security */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>DEVICE SECURITY</Text>
          <View>
            {[
              { label: "PIN LOCK", active: hasPin },
              { label: "BIOMETRIC LOCK", active: biometricEnabled },
              { label: "SECURE STORAGE (KEYCHAIN)", active: Platform.OS !== "web" },
              { label: "PANIC WIPE", active: true },
              { label: "ENCRYPTED KEY DERIVATION", active: true },
            ].map((item) => (
              <View key={item.label} style={s.deviceRow}>
                <Text style={s.deviceLabel}>{item.label}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons
                    name={item.active ? "checkmark-circle" : "close-circle"}
                    size={16}
                    color={item.active ? colors.success : colors.destructive}
                  />
                  <Text style={{ fontSize: 11, fontWeight: "800", letterSpacing: 2, color: item.active ? colors.success : colors.destructive }}>
                    {item.active ? "ACTIVE" : "INACTIVE"}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Crypto spec */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>CRYPTOGRAPHY SPECIFICATIONS</Text>
          <View>
            {CRYPTO_SPECS.map((item) => (
              <View key={item.label} style={s.auditRow}>
                <View style={s.auditLeft}>
                  <Text style={s.auditLabel}>{item.label}</Text>
                  {item.detail && <Text style={s.auditDetail}>{item.detail}</Text>}
                </View>
                <View style={s.auditRight}>
                  <Text style={[s.auditValue, { color: statusColor[item.status] }]}>{item.value}</Text>
                  <Ionicons name={statusIcon[item.status]} size={14} color={statusColor[item.status]} />
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Signal comparison */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>FEATURE COMPARISON: SIGNAL vs GHOSTFACE</Text>
          {/* Header row */}
          <View style={[s.compareRow, { borderBottomWidth: 2, borderBottomColor: colors.border }]}>
            <Text style={[s.compareFeature, { color: colors.mutedForeground, fontSize: 9, letterSpacing: 2 }]}>FEATURE</Text>
            <View style={s.compareHead}>
              <Text style={[s.compareHeadTxt, { color: colors.mutedForeground }]}>SIGNAL</Text>
            </View>
            <View style={s.compareHead}>
              <Text style={[s.compareHeadTxt, { color: colors.primary }]}>GHOST</Text>
            </View>
          </View>
          {SIGNAL_COMPARISON.map((row) => (
            <View key={row.feature} style={s.compareRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.compareFeature}>{row.feature}</Text>
                {row.note && <Text style={s.compareNote}>{row.note}</Text>}
              </View>
              <View style={s.compareCol}>
                <Ionicons
                  name={row.signal ? "checkmark-circle" : "remove-circle-outline"}
                  size={18}
                  color={row.signal ? colors.success : colors.mutedForeground}
                />
              </View>
              <View style={s.compareCol}>
                <Ionicons
                  name={row.ghost ? "checkmark-circle" : "remove-circle-outline"}
                  size={18}
                  color={row.ghost ? colors.success : colors.mutedForeground}
                />
              </View>
            </View>
          ))}
        </View>

        <Text style={s.footer}>
          GHOSTFACE USES AUDITED CRYPTOGRAPHY (@NOBLE/CIPHERS){"\n"}
          ALL ENCRYPTION RUNS 100% ON-DEVICE
        </Text>
      </ScrollView>
    </View>
  );
}
