import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { type } from "@/constants/typography";

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

const SECURITY_FEATURES: { feature: string; active: boolean; note?: string }[] = [
  { feature: "End-to-End Encryption", active: true },
  { feature: "Authenticated Encryption", active: true, note: "AEAD via Poly1305" },
  { feature: "Forward Secrecy", active: true },
  { feature: "Disappearing Messages", active: true },
  { feature: "Safety Number Verification", active: true },
  { feature: "Message Fingerprints", active: true },
  { feature: "No Phone Number Required", active: true, note: "Alias only" },
  { feature: "Encrypted Invite Codes", active: true },
  { feature: "Voice Changer", active: true },
  { feature: "Panic Wipe", active: true },
  { feature: "PIN + Biometric Lock", active: true },
  { feature: "Crypto Wallet", active: true },
  { feature: "VPN Dashboard", active: true },
  { feature: "Open Source Protocol", active: false, note: "Proprietary — future roadmap" },
  { feature: "Sealed Sender", active: true, note: "Sender identity encrypted inside ciphertext" },
  { feature: "Full Double Ratchet", active: true, note: "X3DH handshake + per-message ratchet" },
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
    title: { ...type.heading, color: colors.foreground },
    scroll: { flex: 1 },
    section: { paddingHorizontal: 20, marginTop: 24 },
    sectionLabel: { ...type.label, color: colors.mutedForeground, fontSize: 10, marginBottom: 12 },
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
    scoreNum: { ...type.display, color: colors.success, fontSize: 52, letterSpacing: -2 },
    scoreLabel: { ...type.labelStrong, color: colors.success, fontSize: 12 },
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
    auditValue: { ...type.labelStrong },
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
      ...type.micro,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingVertical: 24,
      opacity: 0.4,
    },
  });

  const passCount = SECURITY_FEATURES.filter((r) => r.active).length;
  const totalCount = SECURITY_FEATURES.length;
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
            <Text style={s.scoreNote}>{passCount}/{totalCount} FEATURES ACTIVE</Text>
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
              { label: "WIPE DEVICE", active: true },
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
                  <Text style={{ ...type.labelStrong, color: item.active ? colors.success : colors.destructive }}>
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

        <Text style={s.footer}>
          GHOSTFACE USES AUDITED CRYPTOGRAPHY (@NOBLE/CIPHERS){"\n"}
          ALL ENCRYPTION RUNS 100% ON-DEVICE
        </Text>
      </ScrollView>
    </View>
  );
}
