import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassCallButton } from "@/components/GlassCallButton";
import { GoldGradient } from "@/components/GoldGradient";
import { SecureBadge } from "@/components/SecureBadge";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { useApp } from "@/context/AppContext";
import { getProfileColor } from "@/lib/chatColors";
import { useColors } from "@/hooks/useColors";

export default function CallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { conversations } = useApp();

  const sorted = [...conversations].sort((a, b) => b.timestamp - a.timestamp);

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
    headerTitle: { color: colors.foreground, fontSize: 16, fontWeight: "800", letterSpacing: 4 },
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
    avatarTxt: { color: colors.foreground, fontSize: 15, fontWeight: "800", letterSpacing: 1 },
    itemBody: { flex: 1 },
    alias: { color: colors.foreground, fontSize: 14, fontWeight: "700", letterSpacing: 2 },
    sealedRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
    sealedTxt: { color: colors.destructive, fontSize: 8, fontWeight: "800", letterSpacing: 1.5 },
    actions: { flexDirection: "row", gap: 10 },
    itemDivider: { height: 1, backgroundColor: colors.border, marginLeft: 80 },
    empty: { alignItems: "center", paddingTop: 60, gap: 12 },
    emptyTxt: { color: colors.mutedForeground, fontSize: 13, letterSpacing: 3 },
    emptySub: { color: colors.mutedForeground, fontSize: 11, letterSpacing: 1, opacity: 0.6 },
    emptyBtn: { marginTop: 8, borderRadius: colors.radius, overflow: "hidden" },
    emptyBtnInner: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: colors.radius },
    emptyBtnTxt: { color: colors.primaryForeground, fontSize: 12, fontWeight: "800", letterSpacing: 3 },
    pad: { height: 110 },
  });

  return (
    <TabScreenWrapper>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>CALL</Text>
          <SecureBadge type="e2ee" />
        </View>

        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="call-outline" size={48} color={colors.border} />
              <Text style={styles.emptyTxt}>NO CONTACTS</Text>
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
          renderItem={({ item, index }) => {
            const sealed = !!item.destroyedAt;
            return (
              <View>
                <View style={styles.item}>
                  <View style={[styles.avatar, { backgroundColor: getProfileColor(item.alias) }]}>
                    <Text style={styles.avatarTxt}>{item.alias.slice(0, 2)}</Text>
                  </View>
                  <View style={styles.itemBody}>
                    <Text style={styles.alias}>{item.alias}</Text>
                    {sealed && (
                      <View style={styles.sealedRow}>
                        <Ionicons name="skull-outline" size={9} color={colors.destructive} />
                        <Text style={styles.sealedTxt}>SELF-DESTRUCTED</Text>
                      </View>
                    )}
                  </View>
                  {!sealed && (
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
                  )}
                </View>
                {index < sorted.length - 1 && <View style={styles.itemDivider} />}
              </View>
            );
          }}
          ListFooterComponent={<View style={styles.pad} />}
        />
      </View>
    </TabScreenWrapper>
  );
}
