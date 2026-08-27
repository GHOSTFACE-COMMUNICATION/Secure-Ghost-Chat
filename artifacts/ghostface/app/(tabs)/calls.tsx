import { SectionLock } from "@/components/SectionLock";
import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback } from "react";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassCallButton } from "@/components/GlassCallButton";
import { GoldGradient } from "@/components/GoldGradient";
import { SecureBadge } from "@/components/SecureBadge";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { CallLogEntry, useApp } from "@/context/AppContext";
import { getContrastText, getProfileColor } from "@/lib/chatColors";
import { useColors } from "@/hooks/useColors";
import { type } from "@/constants/typography";

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const d = new Date(ts);
  if (mins < 1) return "NOW";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function CallScreenInner() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { callHistory, markCallsSeen, clearCallHistory } = useApp();

  const confirmClearHistory = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Erase call history?",
      "All call log entries on this device will be permanently removed.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Erase", style: "destructive", onPress: () => clearCallHistory() },
      ],
    );
  };

  // Clear the missed-call badge whenever this tab is actually viewed.
  useFocusEffect(
    useCallback(() => {
      markCallsSeen();
    }, [markCallsSeen])
  );

  const startCall = (alias: string, mode: "voice" | "video") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      // Must be a real UUID, not just unique: this is relayed through the
      // VoIP push payload and passed straight to CallKit's native
      // reportNewIncomingCall on the callee's device, which parses it with
      // NSUUID(uuidString:) — a non-UUID string fails there.
      pathname: "/call",
      params: { alias, mode, role: "caller", callId: Crypto.randomUUID() },
    });
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: insets.top + 16,
      paddingBottom: 12,
    },
    headerTitle: { ...type.heading, color: colors.foreground },
    headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
    item: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 14,
    },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarTxt: { ...type.subheading, color: colors.foreground },
    itemBody: { flex: 1 },
    aliasRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    alias: { ...type.subheading, color: colors.foreground, fontSize: 14 },
    aliasMissed: { color: colors.destructive },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
    metaTxt: { ...type.micro, color: colors.mutedForeground, fontSize: 10 },
    metaMissed: { color: colors.destructive },
    timeTxt: { ...type.micro, color: colors.mutedForeground, fontSize: 10 },
    actions: { flexDirection: "row", gap: 10 },
    itemDivider: { height: 1, backgroundColor: colors.border, marginLeft: 80 },
    empty: { alignItems: "center", paddingTop: 60, gap: 12 },
    emptyTxt: { ...type.label, color: colors.mutedForeground, fontSize: 13 },
    emptySub: { ...type.caption, color: colors.mutedForeground, fontSize: 11, opacity: 0.6 },
    emptyBtn: { marginTop: 8, borderRadius: colors.radius, overflow: "hidden" },
    emptyBtnInner: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: colors.radius },
    emptyBtnTxt: { ...type.labelStrong, color: "#FFFFFF", fontSize: 12 },
    pad: { height: 110 },
  });

  return (
    <TabScreenWrapper>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>CALL</Text>
          <View style={styles.headerRight}>
            {callHistory.length > 0 && (
              <Pressable
                onPress={confirmClearHistory}
                hitSlop={10}
                testID="clear-call-history"
                accessibilityLabel="Erase call history"
              >
                <Ionicons name="trash-outline" size={18} color={colors.mutedForeground} />
              </Pressable>
            )}
            <SecureBadge type="e2ee" />
          </View>
        </View>

        <FlatList
          data={callHistory}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="call-outline" size={48} color={colors.border} />
              <Text style={styles.emptyTxt}>NO CALLS YET</Text>
              <Text style={styles.emptySub}>Add a contact to start calling</Text>
              <Pressable
                style={styles.emptyBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: "/(tabs)/messages", params: { tab: "invite" } });
                }}
              >
                <GoldGradient style={styles.emptyBtnInner}>
                  <Text style={styles.emptyBtnTxt}>+ INVITE A CONTACT</Text>
                </GoldGradient>
              </Pressable>
            </View>
          }
          renderItem={({ item, index }: { item: CallLogEntry; index: number }) => {
            const missed = item.outcome === "missed" && item.direction === "incoming";
            const directionIcon =
              item.outcome === "declined"
                ? "close-circle-outline"
                : item.direction === "outgoing"
                ? "arrow-up-outline"
                : "arrow-down-outline";
            const outcomeLabel =
              item.outcome === "declined"
                ? "DECLINED"
                : missed
                ? "MISSED"
                : item.outcome === "missed"
                ? "NO ANSWER" // outgoing call the other side never picked up
                : item.durationSec !== undefined
                ? formatDuration(item.durationSec)
                : "";
            return (
              <View>
                <View style={styles.item}>
                  <View style={[styles.avatar, { backgroundColor: getProfileColor(item.alias) }]}>
                    <Text style={[styles.avatarTxt, { color: getContrastText(getProfileColor(item.alias)) }]}>
                      {item.alias.slice(0, 2)}
                    </Text>
                  </View>
                  <View style={styles.itemBody}>
                    <View style={styles.aliasRow}>
                      <Text style={[styles.alias, missed && styles.aliasMissed]}>{item.alias}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Ionicons
                        name={directionIcon}
                        size={10}
                        color={missed ? colors.destructive : colors.mutedForeground}
                      />
                      <Ionicons
                        name={item.mode === "video" ? "videocam-outline" : "call-outline"}
                        size={10}
                        color={missed ? colors.destructive : colors.mutedForeground}
                      />
                      <Text style={[styles.metaTxt, missed && styles.metaMissed]}>{outcomeLabel}</Text>
                      <Text style={styles.timeTxt}>· {formatTime(item.timestamp)}</Text>
                    </View>
                  </View>
                  <View style={styles.actions}>
                    <GlassCallButton
                      icon="call-outline"
                      onPress={() => startCall(item.alias, "voice")}
                      testID={`call-voice-${item.id}`}
                      accessibilityLabel={`Voice call ${item.alias}`}
                    />
                    <GlassCallButton
                      icon="videocam-outline"
                      onPress={() => startCall(item.alias, "video")}
                      testID={`call-video-${item.id}`}
                      accessibilityLabel={`Video call ${item.alias}`}
                    />
                  </View>
                </View>
                {index < callHistory.length - 1 && <View style={styles.itemDivider} />}
              </View>
            );
          }}
          ListFooterComponent={<View style={styles.pad} />}
        />
      </View>
    </TabScreenWrapper>
  );
}

export default function CallScreen() {
  return (
    <SectionLock sectionKey="calls" label="CALLS">
      <CallScreenInner />
    </SectionLock>
  );
}
