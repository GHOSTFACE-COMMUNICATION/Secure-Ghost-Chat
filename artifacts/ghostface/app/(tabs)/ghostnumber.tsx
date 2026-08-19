import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GoldGradient } from "@/components/GoldGradient";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { useScrollPersist } from "@/hooks/useScrollPersist";

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

type GhostNumber = {
  id: number;
  phoneNumber: string;
  msisdn: string;
  country: string;
  capabilities: string[];
  plan: string;
  status: string;
  createdAt: string;
  rotateEveryDays: number | null;
  nextRotationAt: string | null;
};

const ROTATION_OPTIONS: { label: string; days: 0 | 7 | 30 | 90 }[] = [
  { label: "OFF", days: 0 },
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
];

function formatNextRotation(nextRotationAt: string | null): string | null {
  if (!nextRotationAt) return null;
  const ms = new Date(nextRotationAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "ROTATING SOON";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return "ROTATES TODAY";
  if (days === 1) return "ROTATES TOMORROW";
  return `ROTATES IN ${days} DAYS`;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "NOW";
  if (mins < 60) return `${mins}M AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H AGO`;
  return `${Math.floor(hrs / 24)}D AGO`;
}

export default function GhostNumberScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { alias, deviceToken, loaded } = useApp();

  const { scrollRef, onScroll } = useScrollPersist<ScrollView>();

  const [numbers, setNumbers] = useState<GhostNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [releasing, setReleasing] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [savingRotation, setSavingRotation] = useState<number | null>(null);
  const [rotatingNow, setRotatingNow] = useState<number | null>(null);

  const authHeaders = useCallback(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${deviceToken ?? ""}`,
    }),
    [deviceToken]
  );

  const fetchNumbers = useCallback(async (): Promise<boolean> => {
    if (!alias || !deviceToken) return false;
    try {
      const res = await fetch(`${API_BASE}/numbers?alias=${alias}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setNumbers(json.data ?? []);
      setFetchError(false);
      return true;
    } catch {
      setFetchError(true);
      return false;
    }
  }, [alias, deviceToken, authHeaders]);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    await fetchNumbers();
    setLoading(false);
  }, [fetchNumbers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchNumbers();
    setRefreshing(false);
  }, [fetchNumbers]);

  useEffect(() => {
    // Wait for AsyncStorage hydration before firing the first fetch.
    // Without this, on Android cold-start the screen can read alias/deviceToken
    // as undefined for one render and short-circuit fetchNumbers to false,
    // leaving the user stuck on "NOT READY".
    if (!loaded) return;
    load();
  }, [load, loaded]);

  // Recompute countdown every time this tab comes back into focus.
  useFocusEffect(
    useCallback(() => {
      void fetchNumbers();
    }, [fetchNumbers])
  );

  const handleAcquire = async () => {
    // Belt-and-braces: the button is disabled while !loaded, but if a rapid
    // tap slips through we silently no-op rather than fire the misleading
    // "NOT READY" alert during the AsyncStorage hydration window.
    if (!loaded) return;
    if (!alias || !deviceToken) {
      Alert.alert("NOT READY", "Finish onboarding before acquiring a ghost number.");
      return;
    }
    setProvisioning(true);
    try {
      const res = await fetch(`${API_BASE}/numbers/provision?alias=${alias}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ country: "NZ", capabilities: ["sms"] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Provisioning failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await fetchNumbers();
    } catch (err) {
      Alert.alert("ERROR", err instanceof Error ? err.message : "Something went wrong");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setProvisioning(false);
    }
  };

  const handleRelease = (number: GhostNumber) => {
    Alert.alert(
      "RELEASE NUMBER",
      `Release ${number.phoneNumber}?\n\nThis cannot be undone.`,
      [
        { text: "CANCEL", style: "cancel" },
        {
          text: "RELEASE",
          style: "destructive",
          onPress: async () => {
            setReleasing(number.id);
            try {
              const res = await fetch(
                `${API_BASE}/numbers/${number.id}?alias=${alias}`,
                { method: "DELETE", headers: authHeaders() }
              );
              const json = await res.json();
              if (!res.ok) throw new Error(json.error ?? "Release failed");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await fetchNumbers();
            } catch (err) {
              Alert.alert("ERROR", err instanceof Error ? err.message : "Something went wrong");
            } finally {
              setReleasing(null);
            }
          },
        },
      ]
    );
  };

  const handleSetRotation = async (number: GhostNumber, days: 0 | 7 | 30 | 90) => {
    if (number.rotateEveryDays === (days === 0 ? null : days)) return;
    if (!alias || !deviceToken) return;
    setSavingRotation(number.id);
    try {
      const res = await fetch(
        `${API_BASE}/numbers/${number.id}/rotation?alias=${alias}`,
        {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ rotateEveryDays: days }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNumbers((prev) =>
        prev.map((n) => (n.id === number.id ? { ...n, ...json.data } : n))
      );
    } catch (err) {
      Alert.alert("ERROR", err instanceof Error ? err.message : "Something went wrong");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSavingRotation(null);
    }
  };

  const handleRotateNow = (number: GhostNumber) => {
    Alert.alert(
      "ROTATE NUMBER",
      `Replace ${number.phoneNumber} with a new ghost number now?\n\nYour old number will be archived for in-flight SMS. You can only do this once every 24 hours.`,
      [
        { text: "CANCEL", style: "cancel" },
        {
          text: "ROTATE NOW",
          onPress: async () => {
            setRotatingNow(number.id);
            try {
              const res = await fetch(
                `${API_BASE}/numbers/${number.id}/rotate-now?alias=${alias}`,
                { method: "POST", headers: authHeaders() }
              );
              const json = await res.json();
              if (!res.ok) throw new Error(json.error ?? "Rotation failed");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setNumbers((prev) =>
                prev.map((n) => (n.id === number.id ? { ...n, ...json.data } : n))
              );
            } catch (err) {
              Alert.alert("ERROR", err instanceof Error ? err.message : "Something went wrong");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setRotatingNow(null);
            }
          },
        },
      ]
    );
  };

  const handleCopy = async (number: GhostNumber) => {
    await Clipboard.setStringAsync(number.phoneNumber);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(number.id);
    setTimeout(() => setCopied(null), 2000);
  };

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
      paddingBottom: 16,
    },
    headerTitle: {
      color: colors.foreground,
      fontSize: 14,
      fontWeight: "800",
      letterSpacing: 4,
    },
    divider: { height: 1, backgroundColor: colors.border },
    scroll: { flex: 1 },
    listContent: { padding: 20, paddingBottom: 120 },
    emptyWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingTop: 80,
      gap: 12,
    },
    emptyIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: "rgba(245,210,107,0.08)",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    emptyTitle: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: "800",
      letterSpacing: 4,
    },
    emptyBody: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 1,
      textAlign: "center",
      lineHeight: 18,
      maxWidth: 240,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: "rgba(245,210,107,0.25)",
      padding: 18,
      marginBottom: 14,
    },
    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14,
    },
    statusBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: "rgba(245,210,107,0.1)",
      borderRadius: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    statusDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.primary,
    },
    statusText: {
      color: colors.primary,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 2,
    },
    planBadge: {
      backgroundColor: "rgba(138,138,138,0.12)",
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    planText: {
      color: "#8A8A8A",
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 2,
    },
    phoneRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 14,
    },
    phoneNumber: {
      color: colors.foreground,
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: 2,
      flex: 1,
    },
    copyBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.muted,
      borderRadius: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    copyBtnText: {
      color: colors.foreground,
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 1,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 14,
    },
    metaChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: colors.muted,
      borderRadius: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    metaChipText: {
      color: colors.mutedForeground,
      fontSize: 9,
      letterSpacing: 1,
      fontWeight: "600",
    },
    inboxBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 10,
      marginTop: 4,
      marginBottom: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: "rgba(245,210,107,0.08)",
    },
    inboxBtnText: {
      flex: 1,
      textAlign: "center",
      color: colors.primary,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 2,
    },
    cardDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginBottom: 12,
    },
    rotationLabel: {
      color: colors.mutedForeground,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 2,
      marginBottom: 8,
    },
    rotationRow: {
      flexDirection: "row",
      gap: 6,
      marginBottom: 6,
    },
    rotationChip: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: 6,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    rotationChipActive: {
      backgroundColor: "rgba(245,210,107,0.15)",
      borderColor: colors.primary,
    },
    rotationChipInactive: {
      backgroundColor: "transparent",
      borderColor: colors.border,
    },
    rotationChipText: {
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1,
    },
    rotationCountdown: {
      color: colors.primary,
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 1,
      marginTop: 4,
      marginBottom: 4,
    },
    rotateNowBtn: {
      marginTop: 8,
      borderRadius: colors.radius,
      overflow: "hidden",
    },
    rotateNowBtnInner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 10,
      borderRadius: colors.radius,
    },
    rotateNowBtnText: {
      color: "#FFFFFF",
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 2,
    },
    releaseBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: "rgba(255,59,48,0.35)",
      borderRadius: colors.radius,
      paddingVertical: 10,
    },
    releaseBtnText: {
      color: colors.destructive,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 2,
    },
    footer: {
      position: "absolute",
      bottom:
        Platform.OS === "web"
          ? 84
          : (Platform.OS === "ios" ? 49 : 56) + insets.bottom,
      left: 0,
      right: 0,
      padding: 20,
      paddingBottom: 20,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    acquireBtn: {
      borderRadius: colors.radius,
      overflow: "hidden",
    },
    acquireBtnInner: {
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
      borderRadius: colors.radius,
    },
    acquireBtnDisabled: {
      opacity: 0.5,
    },
    acquireBtnText: {
      color: "#FFFFFF",
      fontSize: 12,
      fontWeight: "800",
      letterSpacing: 3,
    },
  });

  return (
    <TabScreenWrapper>
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>GHOST NUMBER</Text>
        <Ionicons name="phone-portrait-outline" size={18} color={colors.primary} />
      </View>
      <View style={styles.divider} />

      {!loaded || loading ? (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : fetchError ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="warning-outline" size={28} color={colors.destructive} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.destructive }]}>LOAD FAILED</Text>
          <Text style={styles.emptyBody}>
            Could not retrieve your ghost numbers. Check your connection and try again.
          </Text>
          <Pressable
            style={{
              marginTop: 16,
              borderWidth: 1,
              borderColor: colors.primary,
              borderRadius: colors.radius,
              paddingHorizontal: 20,
              paddingVertical: 10,
            }}
            onPress={load}
          >
            <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 2 }}>
              RETRY
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={styles.scroll}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {numbers.length === 0 ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}>
                <Ionicons name="phone-portrait-outline" size={28} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>NO GHOST NUMBERS</Text>
              <Text style={styles.emptyBody}>
                Acquire a number to receive SMS anonymously. Your identity stays hidden.
              </Text>
            </View>
          ) : (
            numbers.map((n) => {
              const openInbox = () =>
                router.push({
                  pathname: "/sms-inbox/[numberId]",
                  params: {
                    numberId: String(n.id),
                    phoneNumber: n.phoneNumber,
                    currentMsisdn: n.msisdn,
                  },
                });
              return (
              <View key={n.id} style={styles.card}>
                <View>
                  <View style={styles.cardHead}>
                    <View style={styles.statusBadge}>
                      <View style={styles.statusDot} />
                      <Text style={styles.statusText}>{n.status.toUpperCase()}</Text>
                    </View>
                    <View style={styles.planBadge}>
                      <Text style={styles.planText}>{n.plan.toUpperCase()}</Text>
                    </View>
                  </View>

                  <View style={styles.phoneRow}>
                    <Text style={styles.phoneNumber}>{n.phoneNumber}</Text>
                    <Pressable style={styles.copyBtn} onPress={() => handleCopy(n)}>
                      <Ionicons
                        name={copied === n.id ? "checkmark" : "copy-outline"}
                        size={12}
                        color={colors.foreground}
                      />
                      <Text style={styles.copyBtnText}>
                        {copied === n.id ? "COPIED" : "COPY"}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={styles.metaRow}>
                    <View style={styles.metaChip}>
                      <Ionicons name="globe-outline" size={10} color={colors.mutedForeground} />
                      <Text style={styles.metaChipText}>{n.country}</Text>
                    </View>
                    {(n.capabilities as string[]).map((cap) => (
                      <View key={cap} style={styles.metaChip}>
                        <Ionicons
                          name={cap === "SMS" ? "chatbubble-outline" : "call-outline"}
                          size={10}
                          color={colors.mutedForeground}
                        />
                        <Text style={styles.metaChipText}>{cap}</Text>
                      </View>
                    ))}
                    <View style={styles.metaChip}>
                      <Ionicons name="time-outline" size={10} color={colors.mutedForeground} />
                      <Text style={styles.metaChipText}>{formatTime(n.createdAt)}</Text>
                    </View>
                  </View>

                </View>

                {/* Dedicated inbox button — own Pressable to avoid nested-touchable swallowing */}
                <Pressable
                  style={({ pressed }) => [styles.inboxBtn, pressed && { opacity: 0.7 }]}
                  onPress={openInbox}
                >
                  <Ionicons name="mail-outline" size={14} color={colors.primary} />
                  <Text style={styles.inboxBtnText}>VIEW SMS INBOX</Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.primary} />
                </Pressable>

                <View style={styles.cardDivider} />

                <Text style={styles.rotationLabel}>AUTO-ROTATE</Text>
                <View style={styles.rotationRow}>
                  {ROTATION_OPTIONS.map((opt) => {
                    const isActive =
                      (opt.days === 0 && !n.rotateEveryDays) ||
                      n.rotateEveryDays === opt.days;
                    return (
                      <Pressable
                        key={opt.days}
                        style={[
                          styles.rotationChip,
                          isActive ? styles.rotationChipActive : styles.rotationChipInactive,
                        ]}
                        onPress={() => handleSetRotation(n, opt.days)}
                        disabled={savingRotation === n.id}
                      >
                        <Text
                          style={[
                            styles.rotationChipText,
                            { color: isActive ? colors.primary : colors.mutedForeground },
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {n.rotateEveryDays && n.nextRotationAt ? (
                  <Text style={styles.rotationCountdown}>
                    {formatNextRotation(n.nextRotationAt)}
                  </Text>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    styles.rotateNowBtn,
                    (rotatingNow === n.id) && { opacity: 0.6 },
                    pressed && { opacity: 0.75 },
                  ]}
                  onPress={() => handleRotateNow(n)}
                  disabled={rotatingNow === n.id}
                >
                  <GoldGradient style={styles.rotateNowBtnInner}>
                    {rotatingNow === n.id ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons name="refresh-outline" size={12} color="#FFFFFF" />
                        <Text style={styles.rotateNowBtnText}>ROTATE NOW</Text>
                      </>
                    )}
                  </GoldGradient>
                </Pressable>

                <View style={[styles.cardDivider, { marginTop: 12 }]} />

                <Pressable
                  style={styles.releaseBtn}
                  onPress={() => handleRelease(n)}
                  disabled={releasing === n.id}
                >
                  {releasing === n.id ? (
                    <ActivityIndicator size="small" color={colors.destructive} />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={12} color={colors.destructive} />
                      <Text style={styles.releaseBtnText}>RELEASE NUMBER</Text>
                    </>
                  )}
                </Pressable>
              </View>
              );
            })
          )}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Pressable
          style={[styles.acquireBtn, (provisioning || !loaded) && styles.acquireBtnDisabled]}
          onPress={handleAcquire}
          disabled={provisioning || !loaded}
        >
          <GoldGradient style={styles.acquireBtnInner}>
            {provisioning || !loaded ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={16} color="#FFFFFF" />
                <Text style={styles.acquireBtnText}>ACQUIRE NUMBER</Text>
              </>
            )}
          </GoldGradient>
        </Pressable>
      </View>
    </View>
    </TabScreenWrapper>
  );
}
