import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import EncryptionTools from "@/components/EncryptionTools";
import GhostInvite from "@/components/GhostInvite";
import { GoldGradient } from "@/components/GoldGradient";
import { QRScanner } from "@/components/QRScanner";
import { SecureBadge } from "@/components/SecureBadge";
import { StatusDot } from "@/components/StatusDot";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { useScrollPersist } from "@/hooks/useScrollPersist";
import { CODE_REGEX, lookupInviteCode, consumeInviteCode } from "@/lib/invites";
import { getProfileColor } from "@/lib/chatColors";

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const d = new Date(ts);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function addConvErrorTitle(error?: string): string {
  switch (error) {
    case "not_found":
      return "User Not Found";
    case "server_unreachable":
      return "Network Unavailable";
    default:
      return "Could Not Start Chat";
  }
}

function addConvErrorMessage(alias: string, error?: string): string {
  switch (error) {
    case "not_found":
      return `${alias} is not on the GHOSTFACE network. They must install GHOSTFACE and register before you can start an encrypted conversation.`;
    case "server_unreachable":
      return "Cannot reach the GHOSTFACE network. Check your connection and try again.";
    case "no_bundle":
      return `${alias} has no encryption keys available right now. Ask them to reopen GHOSTFACE, then try again.`;
    case "no_own_keys":
      return "Your own encryption keys could not be prepared. Try again in a moment.";
    case "x3dh_failed":
      return "The secure key exchange failed. Please try again.";
    default:
      return "The encrypted channel could not be established. Please try again.";
  }
}

function inviteErrorTitle(reason: string): string {
  if (reason === "expired") return "Code Expired";
  if (reason === "used")    return "Code Already Used";
  if (reason === "offline") return "Network Unavailable";
  return "Code Not Found";
}

function inviteErrorMessage(reason: string): string {
  if (reason === "expired") return "This invite code has expired. Ask your contact to generate a new one.";
  if (reason === "used")    return "This code has already been redeemed. Ask your contact for a new one.";
  if (reason === "offline") return "Cannot reach the GHOSTFACE network. Check your connection and try again.";
  return "This invite code was not found. Check the code and try again.";
}

type PageTab = "messages" | "tools" | "invite";

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { conversations, addConversation, deleteConversation, wsConnected, alias } = useApp();

  // Only show the offline banner after a successful connection has been made and then lost.
  // Avoids alarming users during the normal initial-connect window on app launch.
  const [hadConnection, setHadConnection] = useState(false);
  useEffect(() => {
    if (wsConnected && !hadConnection) setHadConnection(true);
  }, [wsConnected, hadConnection]);

  // Allows callers (e.g. the Call tab's empty state) to land directly on a
  // specific segment via router.push({ pathname: "/(tabs)/messages", params: { tab: "invite" } }).
  // Read once at mount — this screen is always freshly pushed, never updated in place.
  const { tab: initialTabParam } = useLocalSearchParams<{ tab?: string }>();
  const [pageTab, setPageTab] = useState<PageTab>(
    initialTabParam === "invite" || initialTabParam === "tools" ? initialTabParam : "messages",
  );
  const [showNew, setShowNew] = useState(false);
  const [newAlias, setNewAlias] = useState("");

  const { scrollRef: listRef, onScroll: onListScroll } = useScrollPersist<FlatList>("flatlist");

  const handleLongPressConversation = (convId: string, alias: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const conv = conversations.find((c) => c.id === convId);
    const isSealed = !!conv?.destroyedAt;
    const title = isSealed ? `${alias} — SEALED` : alias;
    const body = isSealed
      ? "This contact has self-destructed. Remove the sealed conversation from your list?"
      : "What would you like to do?";
    const actionLabel = isSealed ? "Delete Sealed Conversation" : "Delete Contact";
    if (Platform.OS !== "web") {
      Alert.alert(
        title,
        body,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: actionLabel,
            style: "destructive",
            onPress: () => deleteConversation(convId),
          },
        ]
      );
    } else {
      const webPrompt = isSealed
        ? `${alias} (SEALED)\nRemove this self-destructed conversation from your list? This cannot be undone.`
        : `${alias}\nDelete this contact and all messages? This cannot be undone.`;
      if (window.confirm(webPrompt)) {
        deleteConversation(convId);
      }
    }
  };

  const [addingChat, setAddingChat] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const handleQRScan = async (decoded: string) => {
    setShowScanner(false);
    setAddingChat(true);
    try {
      if (CODE_REGEX.test(decoded)) {
        const lookup = await lookupInviteCode(decoded);
        if (!lookup.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert(inviteErrorTitle(lookup.reason), inviteErrorMessage(lookup.reason), [{ text: "OK" }]);
          return;
        }
        const result = await addConversation(lookup.ownerAlias);
        if (!result.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert("Connection Failed", "Code valid — connection failed. Try again.", [{ text: "OK" }]);
          return;
        }
        const consume = await consumeInviteCode(decoded);
        if (!consume.ok && !consume.alreadyUsed) console.warn("[invite] QR consume failed in messages");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        const result = await addConversation(decoded);
        Haptics.notificationAsync(
          result.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
        );
        if (!result.ok) {
          Alert.alert(addConvErrorTitle(result.error), addConvErrorMessage(decoded, result.error), [{ text: "OK" }]);
        }
      }
    } finally {
      setAddingChat(false);
      setShowNew(false);
      setNewAlias("");
    }
  };

  const handleNewChat = async () => {
    const trimmed = newAlias.trim();
    if (trimmed.length < 2 || addingChat) return;
    setAddingChat(true);
    try {
      if (CODE_REGEX.test(trimmed)) {
        const lookup = await lookupInviteCode(trimmed);
        if (!lookup.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert(inviteErrorTitle(lookup.reason), inviteErrorMessage(lookup.reason), [{ text: "OK" }]);
          return;
        }
        const result = await addConversation(lookup.ownerAlias);
        if (!result.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert("Connection Failed", "Code valid — connection failed. Try again.", [{ text: "OK" }]);
          return;
        }
        const consume = await consumeInviteCode(trimmed);
        if (!consume.ok && !consume.alreadyUsed) console.warn("[invite] typed-code consume failed in messages");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        const result = await addConversation(trimmed);
        Haptics.notificationAsync(
          result.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
        );
        if (!result.ok) {
          Alert.alert(
            addConvErrorTitle(result.error),
            addConvErrorMessage(trimmed.toUpperCase(), result.error),
            [{ text: "OK" }]
          );
        }
      }
    } finally {
      setAddingChat(false);
      setShowNew(false);
      setNewAlias("");
    }
  };

  const sorted = [...conversations].sort((a, b) => b.timestamp - a.timestamp);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
      paddingBottom: 12,
    },
    headerTitle: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: "800",
      letterSpacing: 4,
    },
    headerRight: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
    },
    segRow: {
      flexDirection: "row",
      marginHorizontal: 16,
      marginTop: 10,
      marginBottom: 2,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    segBtn: {
      flex: 1,
      paddingVertical: 9,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    segBtnActive: {
      backgroundColor: colors.primary,
    },
    segTxt: {
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 2,
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 14,
    },
    avatarWrap: {
      position: "relative",
    },
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      // backgroundColor set per-item to the derived profile colour (see
      // renderItem) — no static fill here.
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarTxt: {
      // Fixed neutral text colour rather than the app's gold accent — the
      // fill now varies per-contact (getProfileColor), and near-white reads
      // reliably against any of the palette's dark swatches, whereas a
      // fixed accent colour isn't guaranteed to contrast well against all
      // of them equally.
      color: colors.foreground,
      fontSize: 15,
      fontWeight: "800",
      letterSpacing: 1,
    },
    badge: {
      position: "absolute",
      top: -4,
      right: -4,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeTxt: {
      color: colors.primaryForeground,
      fontSize: 10,
      fontWeight: "800",
    },
    itemBody: {
      flex: 1,
    },
    itemTop: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 3,
    },
    alias: {
      color: colors.foreground,
      fontSize: 14,
      fontWeight: "700",
      letterSpacing: 2,
    },
    time: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 1,
    },
    preview: {
      color: colors.mutedForeground,
      fontSize: 12,
    },
    itemDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: 80,
    },
    empty: {
      alignItems: "center",
      paddingTop: 60,
      gap: 12,
    },
    emptyTxt: {
      color: colors.mutedForeground,
      fontSize: 13,
      letterSpacing: 3,
    },
    emptySub: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 1,
      opacity: 0.6,
    },
    emptyBtn: {
      marginTop: 8,
      borderRadius: colors.radius,
      overflow: "hidden",
    },
    emptyBtnInner: {
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: colors.radius,
    },
    emptyBtnTxt: {
      color: colors.primaryForeground,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 3,
    },
    pad: {
      height: 110,
    },
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.88)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: 1,
      borderColor: colors.border,
      padding: 24,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 28),
      gap: 16,
    },
    sheetTitle: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: "800",
      letterSpacing: 4,
    },
    sheetSub: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 1,
      marginTop: -8,
    },
    aliasInput: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: 18,
      fontWeight: "700",
      letterSpacing: 4,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    sheetBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: "center",
    },
    sheetBtnTxt: {
      color: colors.primaryForeground,
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 3,
    },
    cancelBtn: {
      alignItems: "center",
      paddingVertical: 10,
    },
    cancelTxt: {
      color: colors.mutedForeground,
      fontSize: 12,
      letterSpacing: 2,
    },
  });

  return (
    <TabScreenWrapper>
    <View style={styles.container}>
      <QRScanner
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleQRScan}
      />
      {/* WS offline banner — only after a prior successful connection */}
      {alias && !wsConnected && hadConnection && (
        <View style={{ backgroundColor: "#FF9500", paddingVertical: 5, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Ionicons name="cloud-offline-outline" size={14} color="#000" />
          <Text style={{ color: "#000", fontSize: 12, fontFamily: "SpaceMono", letterSpacing: 0.5 }}>
            CONNECTING TO SERVER…
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {pageTab === "messages" ? "MESSAGES" : pageTab === "tools" ? "ENCRYPT" : "INVITE"}
        </Text>
        <View style={styles.headerRight}>
          <SecureBadge type="e2ee" />
          {pageTab === "messages" && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setNewAlias("");
                setShowNew(true);
              }}
              testID="new-chat-btn"
            >
              <Ionicons name="create-outline" size={22} color={colors.primary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Segment switcher */}
      <View style={styles.segRow}>
        <Pressable
          style={[styles.segBtn, pageTab === "messages" && styles.segBtnActive]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPageTab("messages"); }}
        >
          <Ionicons
            name="chatbubble-outline"
            size={14}
            color={pageTab === "messages" ? colors.primaryForeground : colors.mutedForeground}
          />
          <Text style={[styles.segTxt, { color: pageTab === "messages" ? colors.primaryForeground : colors.mutedForeground }]}>
            MESSAGES
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segBtn, pageTab === "tools" && styles.segBtnActive]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPageTab("tools"); }}
        >
          <Ionicons
            name="lock-closed-outline"
            size={14}
            color={pageTab === "tools" ? colors.primaryForeground : colors.mutedForeground}
          />
          <Text style={[styles.segTxt, { color: pageTab === "tools" ? colors.primaryForeground : colors.mutedForeground }]}>
            TOOLS
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segBtn, pageTab === "invite" && styles.segBtnActive]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPageTab("invite"); }}
        >
          <Ionicons
            name="qr-code-outline"
            size={14}
            color={pageTab === "invite" ? colors.primaryForeground : colors.mutedForeground}
          />
          <Text style={[styles.segTxt, { color: pageTab === "invite" ? colors.primaryForeground : colors.mutedForeground }]}>
            INVITE
          </Text>
        </Pressable>
      </View>

      <View style={styles.divider} />

      {/* Content */}
      {pageTab === "tools" ? (
        <EncryptionTools />
      ) : pageTab === "invite" ? (
        <GhostInvite />
      ) : (
        <FlatList
          ref={listRef}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          data={sorted}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubble-outline" size={48} color={colors.border} />
              <Text style={styles.emptyTxt}>NO CHANNELS</Text>
              <Text style={styles.emptySub}>Start a new secure conversation</Text>
              <Pressable
                style={styles.emptyBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNewAlias(""); setShowNew(true); }}
              >
                <GoldGradient style={styles.emptyBtnInner}>
                  <Text style={styles.emptyBtnTxt}>+ NEW CHANNEL</Text>
                </GoldGradient>
              </Pressable>
            </View>
          }
          renderItem={({ item, index }) => (
            <View>
              <Pressable
                style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/chat/${item.id}`); }}
                onLongPress={() => handleLongPressConversation(item.id, item.alias)}
                delayLongPress={400}
                testID={`conversation-${item.id}`}
              >
                <View style={styles.avatarWrap}>
                  <View style={[styles.avatar, { backgroundColor: getProfileColor(item.alias) }]}>
                    <Text style={styles.avatarTxt}>{item.alias.slice(0, 2)}</Text>
                  </View>
                  {item.unread > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeTxt}>{item.unread}</Text>
                    </View>
                  )}
                </View>
                <View style={[styles.itemBody, item.destroyedAt && { opacity: 0.55 }]}>
                  <View style={styles.itemTop}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                      <Text style={styles.alias}>{item.alias}</Text>
                      {item.verified && !item.destroyedAt && (
                        <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
                      )}
                      {item.destroyedAt ? (
                        <View style={{ backgroundColor: colors.destructive + "22", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, flexDirection: "row", alignItems: "center", gap: 3 }}>
                          <Ionicons name="skull-outline" size={9} color={colors.destructive} />
                          <Text style={{ color: colors.destructive, fontSize: 8, fontWeight: "800", letterSpacing: 1.5 }}>SELF-DESTRUCTED</Text>
                        </View>
                      ) : item.isRealContact && (
                        <View style={{ backgroundColor: colors.success + "22", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Text style={{ color: colors.success, fontSize: 8, fontWeight: "800", letterSpacing: 1.5 }}>LIVE</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
                  </View>
                  <Text style={styles.preview} numberOfLines={1}>{item.lastMessage}</Text>
                </View>
                <StatusDot active={!item.destroyedAt} size={5} pulse={false} />
              </Pressable>
              {index < sorted.length - 1 && <View style={styles.itemDivider} />}
            </View>
          )}
          ListFooterComponent={<View style={styles.pad} />}
        />
      )}

      {/* New contact modal */}
      <Modal
        visible={showNew}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNew(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowNew(false)} />
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>NEW SECURE CHANNEL</Text>
              <Text style={styles.sheetSub}>Scan their QR code or enter alias manually</Text>

              <Pressable
                style={[styles.sheetBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary }]}
                onPress={() => { setShowNew(false); setTimeout(() => setShowScanner(true), 300); }}
              >
                <Ionicons name="qr-code-outline" size={16} color={colors.primary} />
                <Text style={[styles.sheetBtnTxt, { color: colors.primary }]}>SCAN QR CODE</Text>
              </Pressable>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                <Text style={{ color: colors.mutedForeground, fontSize: 10, letterSpacing: 2 }}>OR</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
              </View>

              <TextInput
                style={styles.aliasInput}
                value={newAlias}
                onChangeText={(t) => setNewAlias(t.toUpperCase())}
                placeholder="ALIAS"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                maxLength={24}
                testID="new-alias-input"
              />

              <Pressable
                style={[{ borderRadius: colors.radius, overflow: "hidden" }, (newAlias.trim().length < 2 || addingChat) && { opacity: 0.38 }]}
                onPress={handleNewChat}
                disabled={newAlias.trim().length < 2 || addingChat}
              >
                <GoldGradient style={{ paddingVertical: 14, alignItems: "center", borderRadius: colors.radius }}>
                  <Text style={styles.sheetBtnTxt}>{addingChat ? "SEARCHING…" : "ESTABLISH CHANNEL"}</Text>
                </GoldGradient>
              </Pressable>

              <Pressable style={styles.cancelBtn} onPress={() => setShowNew(false)}>
                <Text style={styles.cancelTxt}>CANCEL</Text>
              </Pressable>
            </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </TabScreenWrapper>
  );
}
