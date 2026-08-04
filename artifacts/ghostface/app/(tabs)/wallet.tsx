import "react-native-get-random-values";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { GoldGradient } from "@/components/GoldGradient";
import { SecureBadge } from "@/components/SecureBadge";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import { useScrollPersist } from "@/hooks/useScrollPersist";

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
}

export default function WalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    fdBalance,
    casperBalance,
    appTokens,
    walletAddress,
    transactions,
    connectedWalletAddress,
    solBalance,
    connectWallet,
    disconnectWallet,
  } = useApp();
  const { scrollRef, onScroll } = useScrollPersist<ScrollView>();

  const [copied, setCopied] = useState(false);
  const [copiedConnected, setCopiedConnected] = useState(false);
  const [activeToken, setActiveToken] = useState<"FD" | "CASPER">("FD");
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [sendAmount, setSendAmount] = useState("");
  const [sendAddress, setSendAddress] = useState("");
  const [sent, setSent] = useState(false);
  const [walletInput, setWalletInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(walletAddress);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyConnected = async () => {
    if (!connectedWalletAddress) return;
    await Clipboard.setStringAsync(connectedWalletAddress);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedConnected(true);
    setTimeout(() => setCopiedConnected(false), 2000);
  };

  const handleSend = () => {
    if (!sendAmount || !sendAddress) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSent(true);
    setTimeout(() => {
      setSent(false);
      setShowSend(false);
      setSendAmount("");
      setSendAddress("");
    }, 2000);
  };

  const handleConnect = async () => {
    setConnectError("");
    if (!walletInput.trim()) {
      setConnectError("Please enter a wallet address.");
      return;
    }
    setConnecting(true);
    const result = await connectWallet(walletInput);
    setConnecting(false);
    if (result.error) {
      setConnectError(result.error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWalletInput("");
      setShowConnect(false);
    }
  };

  const handleBuy = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const destination = connectedWalletAddress ?? walletAddress;
    const currency = activeToken === "FD" ? "usdc_sol" : "sol";
    const url = `https://buy.moonpay.com/?defaultCurrencyCode=${currency}&walletAddress=${encodeURIComponent(destination)}`;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert("BROWSER ERROR", "Could not open the buy page. Try again.");
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      "DISCONNECT WALLET",
      "Remove your linked Solana wallet from GHOSTFACE?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setDisconnecting(true);
            await disconnectWallet();
            setDisconnecting(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ]
    );
  };

  const balance = activeToken === "FD" ? fdBalance : casperBalance;
  // appTokens is ordered by id ascending (id 1 = CASPER, id 2 = the second
  // app token) — fetched live from the api-server rather than hardcoded, so
  // renaming/redeploying a token doesn't need a client release.
  const casperSymbol = appTokens[0]?.symbol ?? "CASPER";
  const secondTokenSymbol = appTokens[1]?.symbol ?? "FD";
  const activeSymbol = activeToken === "FD" ? secondTokenSymbol : casperSymbol;
  const filteredTx = transactions.filter((t) => t.token === activeToken);

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
    sectionLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 3,
      fontWeight: "700" as const,
      paddingHorizontal: 20,
      marginTop: 24,
      marginBottom: 12,
    },
    linkedCard: {
      marginHorizontal: 20,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: "#8A8A8A",
      padding: 16,
    },
    linkedHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    linkedTitle: {
      color: "#8A8A8A",
      fontSize: 10,
      letterSpacing: 3,
      fontWeight: "800" as const,
    },
    linkedStatus: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    linkedDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.success,
    },
    linkedStatusText: {
      color: colors.foreground,
      fontSize: 9,
      letterSpacing: 2,
      fontWeight: "700" as const,
    },
    solBalanceRow: {
      alignItems: "center",
      marginBottom: 12,
    },
    solAmount: {
      color: colors.foreground,
      fontSize: 32,
      fontWeight: "800" as const,
      letterSpacing: 1,
    },
    solLabel: {
      color: "#8A8A8A",
      fontSize: 12,
      fontWeight: "700" as const,
      letterSpacing: 3,
      marginTop: 2,
    },
    linkedAddressRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      padding: 10,
      gap: 8,
      marginBottom: 12,
    },
    linkedAddress: {
      flex: 1,
      color: colors.foreground,
      fontSize: 11,
      letterSpacing: 1,
      fontWeight: "600" as const,
    },
    disconnectBtn: {
      alignItems: "center",
      paddingVertical: 8,
    },
    disconnectText: {
      color: colors.destructive,
      fontSize: 11,
      letterSpacing: 2,
      fontWeight: "700" as const,
    },
    connectPrompt: {
      marginHorizontal: 20,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: "dashed",
      padding: 20,
      alignItems: "center",
      gap: 10,
    },
    connectPromptText: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 2,
      textAlign: "center",
    },
    connectBtn: {
      backgroundColor: "#8A8A8A",
      borderRadius: colors.radius,
      paddingVertical: 10,
      paddingHorizontal: 24,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    connectBtnText: {
      color: "#FFFFFF",
      fontSize: 11,
      fontWeight: "800" as const,
      letterSpacing: 3,
    },
    tokenSelector: {
      flexDirection: "row",
      margin: 20,
      gap: 12,
    },
    tokenTab: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: colors.radius,
      alignItems: "center",
      borderWidth: 1,
    },
    tokenTabActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    tokenTabInactive: {
      backgroundColor: colors.card,
      borderColor: colors.border,
    },
    tokenTabText: {
      fontSize: 11,
      fontWeight: "800" as const,
      letterSpacing: 3,
    },
    balanceCard: {
      marginHorizontal: 20,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 24,
      alignItems: "center",
    },
    balanceLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 4,
      marginBottom: 8,
    },
    balanceAmount: {
      color: colors.foreground,
      fontSize: 40,
      fontWeight: "800" as const,
      letterSpacing: 1,
    },
    balanceToken: {
      color: colors.primary,
      fontSize: 16,
      fontWeight: "700" as const,
      letterSpacing: 3,
      marginTop: 4,
    },
    solBadge: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    solText: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 2,
    },
    addressBar: {
      flexDirection: "row",
      alignItems: "center",
      marginHorizontal: 20,
      marginTop: 12,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      gap: 8,
    },
    addressLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 2,
    },
    addressText: {
      color: colors.foreground,
      fontSize: 12,
      fontWeight: "600" as const,
      letterSpacing: 1,
      flex: 1,
    },
    actions: {
      flexDirection: "row",
      marginHorizontal: 20,
      marginTop: 16,
      gap: 12,
    },
    actionBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 14,
      borderRadius: colors.radius,
      borderWidth: 1,
    },
    actionBtnText: {
      fontSize: 12,
      fontWeight: "800" as const,
      letterSpacing: 3,
    },
    txSectionLabel: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 3,
      fontWeight: "700" as const,
      paddingHorizontal: 20,
      marginTop: 24,
      marginBottom: 12,
    },
    txItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 12,
      gap: 14,
    },
    txIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    txContent: {
      flex: 1,
    },
    txType: {
      color: colors.foreground,
      fontSize: 12,
      fontWeight: "700" as const,
      letterSpacing: 2,
    },
    txAddress: {
      color: colors.mutedForeground,
      fontSize: 11,
      marginTop: 2,
    },
    txAmount: {
      fontSize: 14,
      fontWeight: "800" as const,
    },
    txDate: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 1,
    },
    txDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: 74,
    },
    buyHelp: {
      color: colors.mutedForeground,
      fontSize: 10,
      letterSpacing: 1,
      lineHeight: 14,
      paddingHorizontal: 20,
      marginTop: 10,
    },
    padBottom: { height: 120 },
    modalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.85)",
      justifyContent: "flex-end",
    },
    modalContent: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      borderTopWidth: 1,
      borderColor: colors.border,
      padding: 24,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24),
    },
    modalTitle: {
      color: colors.foreground,
      fontSize: 13,
      fontWeight: "800" as const,
      letterSpacing: 4,
      marginBottom: 8,
    },
    modalSubtitle: {
      color: colors.mutedForeground,
      fontSize: 11,
      letterSpacing: 1,
      marginBottom: 20,
      lineHeight: 16,
    },
    modalInput: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: 12,
      letterSpacing: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 8,
    },
    errorText: {
      color: colors.destructive,
      fontSize: 11,
      letterSpacing: 1,
      marginBottom: 12,
    },
    modalBtn: {
      backgroundColor: "#8A8A8A",
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: "center",
      marginBottom: 8,
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
    },
    modalBtnPrimary: {
      borderRadius: colors.radius,
      marginBottom: 8,
      overflow: "hidden",
    },
    modalBtnPrimaryInner: {
      paddingVertical: 14,
      alignItems: "center",
      borderRadius: colors.radius,
    },
    modalBtnText: {
      color: "#FFFFFF",
      fontSize: 12,
      fontWeight: "800" as const,
      letterSpacing: 3,
    },
    cancelBtn: {
      alignItems: "center",
      paddingVertical: 12,
    },
    cancelText: {
      color: colors.mutedForeground,
      fontSize: 12,
      letterSpacing: 2,
    },
    successText: {
      color: colors.foreground,
      fontSize: 16,
      fontWeight: "800" as const,
      letterSpacing: 3,
      textAlign: "center",
      marginBottom: 8,
    },
    qrPlaceholder: {
      width: 160,
      height: 160,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      alignSelf: "center",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
      backgroundColor: colors.muted,
    },

  });

  return (
    <TabScreenWrapper>
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>WALLET</Text>
        <SecureBadge type="encrypted" />
      </View>
      <View style={styles.divider} />

      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >

        {/* ── PERSONAL SOLANA WALLET ─────────────────────── */}
        <Text style={styles.sectionLabel}>PERSONAL WALLET</Text>
        {connectedWalletAddress ? (
          <View style={styles.linkedCard}>
            <View style={styles.linkedHeader}>
              <Text style={styles.linkedTitle}>SOLANA MAINNET</Text>
              <View style={styles.linkedStatus}>
                <View style={styles.linkedDot} />
                <Text style={styles.linkedStatusText}>LINKED</Text>
              </View>
            </View>
            <View style={styles.solBalanceRow}>
              <Text style={styles.solAmount}>
                {solBalance === 0 ? "—" : solBalance.toFixed(4)}
              </Text>
              <Text style={styles.solLabel}>SOL</Text>
            </View>
            <Pressable style={styles.linkedAddressRow} onPress={handleCopyConnected}>
              <Ionicons name="wallet-outline" size={12} color="#8A8A8A" />
              <Text style={styles.linkedAddress}>
                {truncateAddress(connectedWalletAddress)}
              </Text>
              <Ionicons
                name={copiedConnected ? "checkmark" : "copy-outline"}
                size={14}
                color={copiedConnected ? colors.success : colors.mutedForeground}
              />
            </Pressable>
            <Pressable style={styles.disconnectBtn} onPress={handleDisconnect} disabled={disconnecting}>
              <Text style={styles.disconnectText}>
                {disconnecting ? "DISCONNECTING..." : "DISCONNECT WALLET"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.connectPrompt}>
            <Ionicons name="wallet-outline" size={28} color={colors.mutedForeground} />
            <Text style={styles.connectPromptText}>
              Link your personal Solana wallet{"\n"}to view your real SOL balance
            </Text>
            <Pressable
              style={styles.connectBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setConnectError("");
                setWalletInput("");
                setShowConnect(true);
              }}
            >
              <Ionicons name="link" size={14} color="#FFFFFF" />
              <Text style={styles.connectBtnText}>LINK WALLET</Text>
            </Pressable>
          </View>
        )}

        {/* ── APP TOKENS ─────────────────────────────────── */}
        <View style={styles.tokenSelector}>
          <Pressable
            style={[
              styles.tokenTab,
              activeToken === "FD" ? styles.tokenTabActive : styles.tokenTabInactive,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveToken("FD");
            }}
          >
            <Text
              style={[
                styles.tokenTabText,
                { color: activeToken === "FD" ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              {secondTokenSymbol}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.tokenTab,
              activeToken === "CASPER" ? styles.tokenTabActive : styles.tokenTabInactive,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveToken("CASPER");
            }}
          >
            <Text
              style={[
                styles.tokenTabText,
                { color: activeToken === "CASPER" ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              {casperSymbol}
            </Text>
          </Pressable>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>BALANCE</Text>
          <Text style={styles.balanceAmount}>
            {balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </Text>
          <Text style={styles.balanceToken}>{activeSymbol}</Text>
          <View style={styles.solBadge}>
            <Ionicons name="radio-button-on" size={10} color="#8A8A8A" />
            <Text style={styles.solText}>SOLANA NETWORK</Text>
          </View>
        </View>

        <Pressable style={styles.addressBar} onPress={handleCopy}>
          <Ionicons name="wallet-outline" size={14} color={colors.mutedForeground} />
          <Text style={styles.addressLabel}>ADDR</Text>
          <Text style={styles.addressText} numberOfLines={1}>
            {walletAddress}
          </Text>
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={16}
            color={copied ? colors.success : colors.mutedForeground}
          />
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.primary },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowSend(true);
            }}
          >
            <Ionicons name="arrow-up" size={16} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>SEND</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.success },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowReceive(true);
            }}
          >
            <Ionicons name="arrow-down" size={16} color={colors.foreground} />
            <Text style={[styles.actionBtnText, { color: colors.foreground }]}>RECEIVE</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: pressed ? colors.muted : colors.card, borderColor: "#8A8A8A" },
            ]}
            onPress={handleBuy}
          >
            <Ionicons name="card-outline" size={16} color="#8A8A8A" />
            <Text style={[styles.actionBtnText, { color: "#8A8A8A" }]}>BUY</Text>
          </Pressable>
        </View>
        <Text style={styles.buyHelp}>
          Buy SOL or USDC with a card. Funds land in your{" "}
          {connectedWalletAddress ? "linked Solana wallet" : "GHOSTFACE wallet"}.
        </Text>

        <Text style={styles.txSectionLabel}>TRANSACTIONS</Text>
        {filteredTx.map((tx, idx) => (
          <View key={tx.id}>
            <View style={styles.txItem}>
              <View
                style={[
                  styles.txIcon,
                  { borderColor: tx.type === "receive" ? colors.success : colors.primary },
                ]}
              >
                <Ionicons
                  name={tx.type === "receive" ? "arrow-down" : "arrow-up"}
                  size={18}
                  color={tx.type === "receive" ? colors.success : colors.primary}
                />
              </View>
              <View style={styles.txContent}>
                <Text style={styles.txType}>{tx.type === "receive" ? "RECEIVED" : "SENT"}</Text>
                <Text style={styles.txAddress}>{tx.address}</Text>
                <Text style={styles.txDate}>{formatDate(tx.timestamp)}</Text>
              </View>
              <Text
                style={[
                  styles.txAmount,
                  { color: tx.type === "receive" ? colors.foreground : colors.primary },
                ]}
              >
                {tx.type === "receive" ? "+" : "-"}
                {tx.amount}
              </Text>
            </View>
            {idx < filteredTx.length - 1 && <View style={styles.txDivider} />}
          </View>
        ))}

        <View style={styles.padBottom} />
      </ScrollView>

      {/* ── LINK WALLET MODAL ───────────────────────────── */}
      <Modal
        visible={showConnect}
        transparent
        animationType="slide"
        onRequestClose={() => setShowConnect(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowConnect(false)} />
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>LINK WALLET</Text>
              <Text style={styles.modalSubtitle}>
                Paste your Solana wallet address to view your real SOL balance. Your private keys stay on your device — GHOSTFACE never has access.
              </Text>
              <TextInput
                style={styles.modalInput}
                value={walletInput}
                onChangeText={(t) => { setWalletInput(t); setConnectError(""); }}
                placeholder="Solana wallet address"
                placeholderTextColor={colors.mutedForeground}
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
              />
              {connectError ? (
                <Text style={styles.errorText}>{connectError}</Text>
              ) : null}
              <Pressable
                style={[styles.modalBtn, (!walletInput.trim() || connecting) && { opacity: 0.5 }]}
                onPress={handleConnect}
                disabled={!walletInput.trim() || connecting}
              >
                {connecting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Ionicons name="link" size={14} color="#FFF" />
                )}
                <Text style={styles.modalBtnText}>
                  {connecting ? "LINKING..." : "LINK WALLET"}
                </Text>
              </Pressable>
              <Pressable style={styles.cancelBtn} onPress={() => setShowConnect(false)}>
                <Text style={styles.cancelText}>CANCEL</Text>
              </Pressable>
            </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── SEND MODAL ──────────────────────────────────── */}
      <Modal
        visible={showSend}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSend(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSend(false)} />
            <View style={styles.modalContent}>
              {sent ? (
                <>
                  <Text style={styles.successText}>TRANSMITTED</Text>
                  <Text style={{ color: colors.mutedForeground, textAlign: "center", fontSize: 11, letterSpacing: 2 }}>
                    TRANSACTION ENCRYPTED & BROADCAST
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.modalTitle}>SEND {activeSymbol}</Text>
                  <View style={{ backgroundColor: "rgba(138,138,138,0.1)", borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 12 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 10, letterSpacing: 2, textAlign: "center" }}>
                      COMING SOON — TRANSFERS NOT YET ACTIVE
                    </Text>
                  </View>
                  <TextInput
                    style={[styles.modalInput, { opacity: 0.4 }]}
                    value={sendAddress}
                    onChangeText={setSendAddress}
                    placeholder="RECIPIENT ADDRESS"
                    placeholderTextColor={colors.mutedForeground}
                    autoCorrect={false}
                    editable={false}
                  />
                  <TextInput
                    style={[styles.modalInput, { opacity: 0.4 }]}
                    value={sendAmount}
                    onChangeText={setSendAmount}
                    placeholder="AMOUNT"
                    placeholderTextColor={colors.mutedForeground}
                    keyboardType="decimal-pad"
                    editable={false}
                  />
                  <Pressable
                    style={[styles.modalBtnPrimary, { opacity: 0.4 }]}
                    onPress={handleSend}
                    disabled={true}
                  >
                    <GoldGradient style={styles.modalBtnPrimaryInner}>
                      <Text style={styles.modalBtnText}>CONFIRM SEND</Text>
                    </GoldGradient>
                  </Pressable>
                  <Pressable style={styles.cancelBtn} onPress={() => setShowSend(false)}>
                    <Text style={styles.cancelText}>CANCEL</Text>
                  </Pressable>
                </>
              )}
            </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── RECEIVE MODAL ───────────────────────────────── */}
      <Modal
        visible={showReceive}
        transparent
        animationType="slide"
        onRequestClose={() => setShowReceive(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowReceive(false)} />
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>RECEIVE {activeSymbol}</Text>
              <View style={styles.qrPlaceholder}>
                <Ionicons name="qr-code" size={80} color={colors.primary} />
              </View>
              <Pressable style={styles.addressBar} onPress={handleCopy}>
                <Text style={styles.addressText} numberOfLines={1}>
                  {walletAddress}
                </Text>
                <Ionicons
                  name={copied ? "checkmark" : "copy-outline"}
                  size={16}
                  color={copied ? colors.success : colors.mutedForeground}
                />
              </Pressable>
              <Pressable style={[styles.cancelBtn, { marginTop: 8 }]} onPress={() => setShowReceive(false)}>
                <Text style={styles.cancelText}>CLOSE</Text>
              </Pressable>
            </View>
        </View>
      </Modal>

    </View>
    </TabScreenWrapper>
  );
}
