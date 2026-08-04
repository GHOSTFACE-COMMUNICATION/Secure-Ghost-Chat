import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusDot } from "@/components/StatusDot";
import { getApiBase, useApp } from "@/context/AppContext";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { VPN_SERVERS } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { useScrollPersist } from "@/hooks/useScrollPersist";

// The "connecting…" spinner used to run for a fixed, made-up 1500/1200ms —
// a fake connection time, since there's no real tunnel being negotiated.
// This does one genuine round trip instead, so however long the spinner
// shows is how long a real request actually took, not an invented number.
async function performHandshake(): Promise<void> {
  const apiBase = getApiBase();
  const url = apiBase ? `${apiBase}/healthz` : "https://api.ipify.org?format=json";
  try {
    await fetch(url);
  } catch {
    // Nothing meaningful left to wait on if even this fails.
  }
}

export default function VPNScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { vpnConnected, vpnServer, connectVPN, disconnectVPN, dataUsed, dataLimit, vpnAutoReconnecting } =
    useApp();
  const [connecting, setConnecting] = useState(false);
  const [currentIp, setCurrentIp] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(true);
  // Genuinely measured round-trip time to a real endpoint — there's no
  // per-region VPN infrastructure behind this screen, so a distinct ms
  // figure per server would just be a fabricated number. This one figure
  // is real; it stands in for "current network latency" rather than
  // pretending to benchmark six different regions.
  const [pingMs, setPingMs] = useState<number | null>(null);
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const { scrollRef: listRef, onScroll: onListScroll } = useScrollPersist<FlatList>("flatlist");

  useEffect(() => {
    let cancelled = false;
    async function fetchIp() {
      try {
        setIpLoading(true);
        const started = Date.now();
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        if (!cancelled) {
          setCurrentIp(data.ip ?? null);
          setPingMs(Date.now() - started);
        }
      } catch {
        if (!cancelled) {
          setCurrentIp(null);
          setPingMs(null);
        }
      } finally {
        if (!cancelled) setIpLoading(false);
      }
    }
    fetchIp();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (connecting || vpnAutoReconnecting) {
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      rotateAnim.setValue(0);
    }
  }, [connecting, vpnAutoReconnecting]);

  const handleToggle = () => {
    if (vpnAutoReconnecting) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (vpnConnected) {
      disconnectVPN();
    } else {
      const target = vpnServer ?? VPN_SERVERS[0];
      setConnecting(true);
      performHandshake().finally(() => {
        connectVPN(target);
        setConnecting(false);
      });
    }
  };

  const handleSelectServer = (server: typeof VPN_SERVERS[0]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (vpnConnected) {
      setConnecting(true);
      disconnectVPN();
      performHandshake().finally(() => {
        connectVPN(server);
        setConnecting(false);
      });
    } else {
      connectVPN(server);
    }
  };

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const dataPercent = (dataUsed / dataLimit) * 100;

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
      color: colors.foreground,
      fontSize: 16,
      fontWeight: "800" as const,
      letterSpacing: 4,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
    },
    heroSection: {
      alignItems: "center",
      paddingVertical: 36,
    },
    toggleBtn: {
      width: 120,
      height: 120,
      borderRadius: 60,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
    },
    statusLabel: {
      fontSize: 13,
      fontWeight: "800" as const,
      letterSpacing: 4,
      marginBottom: 4,
    },
    serverLabel: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 3,
    },
    statsRow: {
      flexDirection: "row",
      marginHorizontal: 20,
      gap: 12,
      marginBottom: 20,
    },
    statCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    },
    statLabel: {
      color: colors.mutedForeground,
      fontSize: 9,
      letterSpacing: 3,
      marginBottom: 6,
    },
    statValue: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: "800" as const,
      letterSpacing: 1,
    },
    statUnit: {
      color: colors.mutedForeground,
      fontSize: 10,
    },
    progressBar: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.muted,
      marginTop: 8,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      borderRadius: 2,
    },
    sectionLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 3,
      fontWeight: "700" as const,
      paddingHorizontal: 20,
      marginBottom: 12,
    },
    serverItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 14,
    },
    flag: {
      fontSize: 24,
      width: 36,
      textAlign: "center",
    },
    serverInfo: {
      flex: 1,
    },
    serverName: {
      fontSize: 13,
      fontWeight: "700" as const,
      letterSpacing: 2,
    },
    serverRegion: {
      color: colors.mutedForeground,
      fontSize: 11,
      marginTop: 2,
    },
    serverDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: 70,
    },
    padBottom: { height: 120 },
  });

  return (
    <TabScreenWrapper>
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>VPN</Text>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <StatusDot active={vpnConnected || vpnAutoReconnecting} size={6} />
            <Text style={{ color: vpnAutoReconnecting ? colors.primary : vpnConnected ? colors.foreground : colors.destructive, fontSize: 11, letterSpacing: 2, fontWeight: "700" as const }}>
              {vpnAutoReconnecting ? "RECONNECTING…" : vpnConnected ? "CONNECTED" : "DISCONNECTED"}
            </Text>
          </View>
          {(vpnConnected || vpnAutoReconnecting) && vpnServer && (
            <Text style={{ color: colors.mutedForeground, fontSize: 11, letterSpacing: 1 }}>
              {vpnServer.flag} {vpnServer.shortRegion}
            </Text>
          )}
        </View>
      </View>
      <View style={styles.divider} />

      <FlatList
        ref={listRef}
        onScroll={onListScroll}
        scrollEventThrottle={16}
        data={VPN_SERVERS}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <>
            <View style={styles.heroSection}>
              <Pressable
                style={({ pressed }) => [
                  styles.toggleBtn,
                  {
                    backgroundColor: vpnConnected
                      ? `${colors.foreground}15`
                      : colors.card,
                    borderWidth: 2,
                    borderColor: vpnConnected
                      ? colors.foreground
                      : connecting
                      ? colors.primary
                      : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
                onPress={handleToggle}
                testID="vpn-toggle"
              >
                <Animated.View style={(connecting || vpnAutoReconnecting) ? { transform: [{ rotate: spin }] } : {}}>
                  <Ionicons
                    name={vpnConnected ? "shield-checkmark" : (connecting || vpnAutoReconnecting) ? "reload" : "shield-outline"}
                    size={48}
                    color={
                      vpnConnected
                        ? colors.foreground
                        : (connecting || vpnAutoReconnecting)
                        ? colors.primary
                        : colors.mutedForeground
                    }
                  />
                </Animated.View>
              </Pressable>
              <Text
                style={[
                  styles.statusLabel,
                  {
                    color: vpnConnected
                      ? colors.foreground
                      : (connecting || vpnAutoReconnecting)
                      ? colors.primary
                      : colors.mutedForeground,
                  },
                ]}
              >
                {vpnConnected
                  ? "PROTECTED"
                  : vpnAutoReconnecting
                  ? "RECONNECTING…"
                  : connecting
                  ? "CONNECTING..."
                  : "UNPROTECTED"}
              </Text>
              <Text style={styles.serverLabel}>
                {(vpnConnected || vpnAutoReconnecting) && vpnServer
                  ? `${vpnServer.flag} ${vpnServer.name}`
                  : "TAP SHIELD TO CONNECT"}
              </Text>

              {/* Current IP row */}
              <View style={{
                marginTop: 18,
                backgroundColor: vpnConnected ? `${colors.foreground}12` : `${colors.destructive}12`,
                borderWidth: 1,
                borderColor: vpnConnected ? `${colors.foreground}40` : `${colors.destructive}40`,
                borderRadius: 8,
                paddingHorizontal: 18,
                paddingVertical: 10,
                alignItems: "center",
                minWidth: 220,
              }}>
                <Text style={{
                  color: colors.mutedForeground,
                  fontSize: 9,
                  letterSpacing: 3,
                  fontWeight: "700",
                  marginBottom: 4,
                }}>
                  {vpnConnected ? "IP ADDRESS" : "YOUR EXPOSED IP"}
                </Text>
                {vpnConnected ? (
                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "800", letterSpacing: 3, fontVariant: ["tabular-nums"] }}>
                    ●●●.●●●.●●●.●●●
                  </Text>
                ) : ipLoading ? (
                  <Text style={{ color: colors.mutedForeground, fontSize: 13, letterSpacing: 2 }}>DETECTING...</Text>
                ) : currentIp ? (
                  <Text style={{ color: colors.destructive, fontSize: 15, fontWeight: "800", letterSpacing: 2, fontVariant: ["tabular-nums"] }}>
                    {currentIp}
                  </Text>
                ) : (
                  <Text style={{ color: colors.mutedForeground, fontSize: 13, letterSpacing: 2 }}>UNAVAILABLE</Text>
                )}
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>DATA USED</Text>
                <Text style={styles.statValue}>
                  {dataUsed} <Text style={styles.statUnit}>GB</Text>
                </Text>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${dataPercent}%`,
                        backgroundColor:
                          dataPercent > 80 ? colors.destructive : colors.primary,
                      },
                    ]}
                  />
                </View>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>DATA LIMIT</Text>
                <Text style={styles.statValue}>
                  {dataLimit} <Text style={styles.statUnit}>GB</Text>
                </Text>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: "100%",
                        backgroundColor: colors.muted,
                      },
                    ]}
                  />
                </View>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>PING</Text>
                <Text style={styles.statValue}>
                  {pingMs !== null ? pingMs : "--"}{" "}
                  <Text style={styles.statUnit}>ms</Text>
                </Text>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: pingMs !== null
                          ? `${Math.min((pingMs / 150) * 100, 100)}%`
                          : "0%",
                        backgroundColor:
                          pingMs !== null && pingMs < 30
                            ? colors.foreground
                            : pingMs !== null && pingMs < 70
                            ? colors.warning
                            : colors.destructive,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>

            <Text style={styles.sectionLabel}>SELECT SERVER</Text>
          </>
        )}
        renderItem={({ item, index }) => {
          const isActive = vpnServer?.id === item.id && vpnConnected;
          return (
            <View>
              <Pressable
                style={({ pressed }) => [
                  styles.serverItem,
                  isActive && { backgroundColor: `${colors.foreground}10` },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => handleSelectServer(item)}
              >
                <Text style={styles.flag}>{item.flag}</Text>
                <View style={styles.serverInfo}>
                  <Text
                    style={[
                      styles.serverName,
                      {
                        color: isActive ? colors.foreground : colors.foreground,
                      },
                    ]}
                  >
                    {item.name}
                    <Text style={{ color: colors.mutedForeground, fontWeight: "400" as const }}>{" · "}{item.shortRegion}</Text>
                  </Text>
                  <Text style={styles.serverRegion}>{item.region}</Text>
                </View>
                {isActive && (
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={colors.foreground}
                    style={{ marginLeft: 8 }}
                  />
                )}
              </Pressable>
              {index < VPN_SERVERS.length - 1 && (
                <View style={styles.serverDivider} />
              )}
            </View>
          );
        }}
        ListFooterComponent={<View style={styles.padBottom} />}
      />
    </View>
    </TabScreenWrapper>
  );
}
