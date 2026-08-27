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
import { type } from "@/constants/typography";

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
    fantasmaBalance,
    gfcBalance,
    appTokens,
    walletAddress,
    transactions,
    connectedWalletAddress,
    solBalance,
    connectWallet,
    disconnectWallet,
    createLocalWallet,
    restoreLocalWallet,
    hasWalletPin,
    walletUnlocked,
    checkWalletPin,
    isSectionLocked,
    themePreference,
  } = useApp();
  const isLight = themePreference === "light";
  const { scrollRef, onScroll } = useScrollPersist<ScrollView>();

  const [gatePin, setGatePin] = useState("");
  const [gateError, setGateError] = useState("");
  const [gateChecking, setGateChecking] = useState(false);

  const handleUnlock = async () => {
    if (gatePin.length < 4) return;
    setGateChecking(true);
    setGateError("");
    const ok = await checkWalletPin(gatePin);
    setGateChecking(false);
    if (!ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setGateError("INCORRECT PIN");
      setGatePin("");
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setGatePin("");
  };

  const [copied, setCopied] = useState(false);
  const [copiedConnected, setCopiedConnected] = useState(false);
  const [activeToken, setActiveToken] = useState<"FANTASMA" | "GFC">("FANTASMA");
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

  // ── Local (device) wallet creation / restore ──────────────────────────
  // `backupPhrase` holds the 24 words for exactly as long as the backup modal
  // is open. It is never persisted and never leaves this component — once the
  // modal is dismissed the only copy is whatever the user wrote down.
  const [backupPhrase, setBackupPhrase] = useState<string | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [phraseCopied, setPhraseCopied] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreInput, setRestoreInput] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [restoring, setRestoring] = useState(false);

  const handleCreateWallet = async () => {
    if (creatingWallet) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCreatingWallet(true);
    const result = await createLocalWallet();
    setCreatingWallet(false);
    if ("error" in result) {
      Alert.alert("COULD NOT CREATE WALLET", result.error);
      return;
    }
    setBackupConfirmed(false);
    setPhraseCopied(false);
    setBackupPhrase(result.phrase);
  };

  const handleCopyPhrase = async () => {
    if (!backupPhrase) return;
    await Clipboard.setStringAsync(backupPhrase);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPhraseCopied(true);
    setTimeout(() => setPhraseCopied(false), 2000);
  };

  // Clearing state here is the point at which the phrase becomes
  // unrecoverable, so it only runs behind the explicit confirmation.
  const dismissBackup = () => {
    setBackupPhrase(null);
    setBackupConfirmed(false);
    setPhraseCopied(false);
  };

  const handleRestore = async () => {
    setRestoreError("");
    if (!restoreInput.trim()) {
      setRestoreError("Enter your 24-word recovery phrase.");
      return;
    }
    setRestoring(true);
    const result = await restoreLocalWallet(restoreInput);
    setRestoring(false);
    if (result.error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setRestoreError(result.error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Wipe the input immediately — a recovery phrase sitting in a mounted
    // TextInput is the same secret as the key it derives.
    setRestoreInput("");
    setShowRestore(false);
  };

  const handleCopy = async () => {
    if (!walletAddress) return;
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

  const openMoonPay = async (currency: "sol" | "usdc_sol", destination: string) => {
    const url = `https://buy.moonpay.com/?defaultCurrencyCode=${currency}&walletAddress=${encodeURIComponent(destination)}`;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert("BROWSER ERROR", "Could not open the buy page. Try again.");
    }
  };

  // Funds the wallet with SOL or USDC. Deliberately NOT tied to activeToken:
  // FSM and GFC are GHOSTFACE's own SPL tokens and no card on-ramp lists
  // them, so deriving the purchase currency from the selected tab meant
  // "BUY" while viewing FSM silently opened a USDC checkout. The asset is now
  // chosen explicitly.
  const handleBuy = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Requires a real linked wallet. walletAddress is not a usable
    // destination — it is a placeholder, so falling back to it would send
    // the user to a checkout pointed at an address that cannot receive.
    if (!connectedWalletAddress) {
      Alert.alert(
        "LINK A WALLET FIRST",
        "Funds are sent straight to your own Solana wallet, so one has to be linked before you can buy.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Link Wallet", onPress: () => setShowConnect(true) },
        ]
      );
      return;
    }

    const destination = connectedWalletAddress;
    Alert.alert(
      "FUND WALLET",
      "Buy with a card. Funds go to your linked Solana wallet.\n\nFSM and GFC can't be bought with a card — they aren't listed on any on-ramp.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "USDC", onPress: () => void openMoonPay("usdc_sol", destination) },
        { text: "SOL", onPress: () => void openMoonPay("sol", destination) },
      ]
    );
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

  const balance = activeToken === "FANTASMA" ? fantasmaBalance : gfcBalance;
  // appTokens is ordered by id ascending (id 1 = GFC, id 2 = the second
  // app token) — fetched live from the api-server rather than hardcoded, so
  // renaming/redeploying a token doesn't need a client release.
  const gfcSymbol = appTokens[0]?.symbol ?? "GFC";
  const secondTokenSymbol = appTokens[1]?.symbol ?? "FSM";
  const activeSymbol = activeToken === "FANTASMA" ? secondTokenSymbol : gfcSymbol;
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
      ...type.heading,
      fontSize: 16,
      letterSpacing: 1.5,
      color: colors.foreground,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
    },
    sectionLabel: {
      ...type.label,
      fontSize: 10,
      color: colors.mutedForeground,
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
      ...type.labelStrong,
      fontSize: 10,
      color: "#8A8A8A",
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
      ...type.micro,
      color: colors.foreground,
    },
    solBalanceRow: {
      alignItems: "center",
      marginBottom: 12,
    },
    solAmount: {
      ...type.display,
      fontSize: 32,
      letterSpacing: 0.5,
      color: colors.foreground,
    },
    solLabel: {
      ...type.labelStrong,
      fontSize: 12,
      letterSpacing: 1.5,
      color: "#8A8A8A",
      marginTop: 2,
    },
    linkedAddressRow: {
      marginBottom: 12,
    },
    linkedAddressRowInner: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: colors.radius,
      padding: 10,
      gap: 8,
    },
    linkedAddress: {
      ...type.monoSmall,
      fontSize: 11,
      flex: 1,
      color: colors.foreground,
    },
    disconnectBtn: {
      alignItems: "center",
      paddingVertical: 8,
    },
    disconnectText: {
      ...type.label,
      fontSize: 11,
      color: colors.destructive,
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
      ...type.caption,
      fontSize: 11,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    connectBtn: {},
    connectBtnInner: {
      borderRadius: colors.radius,
      paddingVertical: 10,
      paddingHorizontal: 24,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    connectBtnText: {
      ...type.labelStrong,
      fontSize: 11,
      color: isLight ? colors.primaryForeground : "#FFFFFF",
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
      overflow: "hidden",
    },
    tokenTabActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    tokenTabText: {
      ...type.labelStrong,
      fontSize: 11,
      letterSpacing: 1.5,
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
      ...type.micro,
      fontSize: 10,
      color: colors.mutedForeground,
      marginBottom: 8,
    },
    balanceAmount: {
      ...type.display,
      fontSize: 40,
      letterSpacing: 0.5,
      color: colors.foreground,
    },
    balanceToken: {
      ...type.heading,
      fontSize: 16,
      letterSpacing: 1.5,
      color: colors.primary,
      marginTop: 4,
    },
    solBadge: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    solText: {
      ...type.micro,
      fontSize: 10,
      color: colors.mutedForeground,
    },
    addressBar: {
      marginHorizontal: 20,
      marginTop: 12,
    },
    addressBarInner: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: colors.radius,
      padding: 12,
      gap: 8,
    },
    addressLabel: {
      ...type.micro,
      fontSize: 10,
      color: colors.mutedForeground,
    },
    addressText: {
      ...type.monoSmall,
      fontSize: 12,
      color: colors.foreground,
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
    },
    actionBtnInner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 14,
      borderRadius: colors.radius,
    },
    actionBtnText: {
      ...type.labelStrong,
      fontSize: 12,
      letterSpacing: 1.5,
    },
    // Shared dimming for any control gated off (SEND until signing exists,
    // RECEIVE until a wallet exists, DONE until backup is acknowledged).
    actionBtnDisabled: {
      opacity: 0.45,
    },
    noWalletCard: {
      marginHorizontal: 20,
      marginTop: 16,
      padding: 20,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      gap: 10,
    },
    noWalletTitle: {
      ...type.labelStrong,
      fontSize: 12,
      letterSpacing: 1.5,
      color: colors.foreground,
    },
    noWalletBody: {
      ...type.caption,
      fontSize: 11,
      color: colors.mutedForeground,
      lineHeight: 16,
      textAlign: "center",
    },
    noWalletBtn: {
      alignSelf: "stretch",
      marginTop: 4,
      borderRadius: colors.radius,
      overflow: "hidden",
    },
    noWalletBtnInner: {
      paddingVertical: 13,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: colors.radius,
    },
    noWalletBtnTxt: {
      ...type.labelStrong,
      fontSize: 12,
      letterSpacing: 1.5,
      color: colors.foreground,
    },
    restoreLink: {
      ...type.label,
      fontSize: 10,
      color: colors.mutedForeground,
      paddingVertical: 8,
      textDecorationLine: "underline",
    },
    phraseWarnBox: {
      flexDirection: "row",
      gap: 8,
      padding: 12,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.destructive,
      backgroundColor: `${colors.destructive}12`,
      marginBottom: 12,
    },
    phraseWarnTxt: {
      ...type.caption,
      fontSize: 11,
      flex: 1,
      color: colors.foreground,
      lineHeight: 16,
    },
    phraseScroll: {
      maxHeight: 220,
      marginBottom: 12,
    },
    phraseGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    phraseWordBox: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.muted,
      minWidth: "30%",
    },
    phraseWordNum: {
      ...type.micro,
      fontSize: 9,
      color: colors.mutedForeground,
      minWidth: 14,
    },
    phraseWord: {
      ...type.mono,
      fontSize: 12,
      color: colors.foreground,
    },
    phraseNote: {
      ...type.micro,
      fontSize: 10,
      color: colors.mutedForeground,
      lineHeight: 15,
      marginBottom: 8,
    },
    phraseCopyBtn: {
      alignSelf: "center",
      borderRadius: colors.radius,
      overflow: "hidden",
      marginBottom: 12,
    },
    phraseCopyBtnInner: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: colors.radius,
    },
    phraseCopyTxt: {
      ...type.label,
      fontSize: 10,
      color: colors.mutedForeground,
    },
    phraseConfirmRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 12,
    },
    phraseConfirmTxt: {
      ...type.caption,
      fontSize: 12,
      color: colors.foreground,
    },
    restoreInput: {
      ...type.mono,
      fontSize: 12,
      backgroundColor: colors.muted,
      color: colors.foreground,
      lineHeight: 18,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 96,
      marginBottom: 8,
    },
    restoreError: {
      ...type.caption,
      fontSize: 11,
      color: colors.destructive,
      marginBottom: 12,
    },
    txSectionLabel: {
      ...type.label,
      fontSize: 10,
      color: colors.mutedForeground,
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
      ...type.labelStrong,
      fontSize: 12,
      color: colors.foreground,
    },
    txAddress: {
      ...type.monoSmall,
      fontSize: 11,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    txAmount: {
      ...type.subheading,
      fontSize: 14,
    },
    txDate: {
      ...type.micro,
      fontSize: 10,
      color: colors.mutedForeground,
    },
    txDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: 74,
    },
    buyHelp: {
      ...type.micro,
      fontSize: 10,
      color: colors.mutedForeground,
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
      ...type.heading,
      fontSize: 13,
      letterSpacing: 1.5,
      color: colors.foreground,
      marginBottom: 8,
    },
    modalSubtitle: {
      ...type.caption,
      fontSize: 11,
      color: colors.mutedForeground,
      marginBottom: 20,
      lineHeight: 16,
    },
    modalInput: {
      ...type.mono,
      fontSize: 12,
      backgroundColor: colors.muted,
      color: colors.foreground,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 8,
    },
    errorText: {
      ...type.caption,
      fontSize: 11,
      color: colors.destructive,
      marginBottom: 12,
    },
    modalBtn: {
      marginBottom: 8,
    },
    modalBtnInner: {
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: "center",
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
      ...type.labelStrong,
      fontSize: 12,
      letterSpacing: 1.5,
      color: isLight ? colors.primaryForeground : "#FFFFFF",
    },
    cancelBtn: {
      alignItems: "center",
      paddingVertical: 12,
    },
    cancelText: {
      ...type.label,
      fontSize: 12,
      color: colors.mutedForeground,
    },
    successText: {
      ...type.heading,
      fontSize: 16,
      letterSpacing: 1.5,
      color: colors.foreground,
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

  const gateStyles = StyleSheet.create({
    container: { alignItems: "center", gap: 14, paddingHorizontal: 32 },
    title: { ...type.heading, color: colors.foreground, marginTop: 8 },
    sub: { color: colors.mutedForeground, fontSize: 11, letterSpacing: 1, textAlign: "center" },
    input: {
      ...type.body,
      fontSize: 14,
      letterSpacing: 1.5,
      width: "100%",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      backgroundColor: colors.input,
      color: colors.foreground,
      paddingHorizontal: 16,
      paddingVertical: 14,
      textAlign: "center",
      marginTop: 10,
    },
    error: { ...type.labelStrong, color: colors.destructive },
    unlockBtn: { width: "100%", borderRadius: colors.radius, overflow: "hidden", marginTop: 4 },
    unlockBtnInner: { paddingVertical: 14, alignItems: "center" },
    unlockBtnTxt: { ...type.labelStrong, color: isLight ? colors.primaryForeground : "#FFFFFF", fontSize: 12 },
  });

  if (isSectionLocked("wallet") && !walletUnlocked) {
    return (
      <TabScreenWrapper>
        <View style={[styles.container, gateStyles.container, { paddingTop: insets.top + 40 }]}>
          <Ionicons name="lock-closed" size={40} color={colors.primary} />
          <Text style={gateStyles.title}>WALLET LOCKED</Text>
          <Text style={gateStyles.sub}>Enter your wallet PIN to continue</Text>
          <TextInput
            style={gateStyles.input}
            value={gatePin}
            onChangeText={(t) => { setGatePin(t.replace(/[^0-9]/g, "")); setGateError(""); }}
            placeholder="WALLET PIN"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numeric"
            secureTextEntry
            maxLength={8}
            autoFocus
            onSubmitEditing={handleUnlock}
            testID="wallet-pin-input"
          />
          {gateError ? <Text style={gateStyles.error}>{gateError}</Text> : null}
          <Pressable
            style={[gateStyles.unlockBtn, (gatePin.length < 4 || gateChecking) && { opacity: 0.4 }]}
            onPress={handleUnlock}
            disabled={gatePin.length < 4 || gateChecking}
            testID="wallet-unlock-btn"
          >
            <GoldGradient style={gateStyles.unlockBtnInner}>
              {gateChecking ? (
                <ActivityIndicator color={isLight ? colors.primaryForeground : "#FFFFFF"} />
              ) : (
                <Text style={gateStyles.unlockBtnTxt}>UNLOCK</Text>
              )}
            </GoldGradient>
          </Pressable>
        </View>
      </TabScreenWrapper>
    );
  }

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
              <GoldGradient style={styles.linkedAddressRowInner}>
                <Ionicons name="wallet-outline" size={12} color="#8A8A8A" />
                <Text style={styles.linkedAddress}>
                  {truncateAddress(connectedWalletAddress)}
                </Text>
                <Ionicons
                  name={copiedConnected ? "checkmark" : "copy-outline"}
                  size={14}
                  color={copiedConnected ? colors.foreground : colors.mutedForeground}
                />
              </GoldGradient>
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
              <GoldGradient style={styles.connectBtnInner}>
                <Ionicons name="link" size={14} color={isLight ? colors.primaryForeground : "#FFFFFF"} />
                <Text style={styles.connectBtnText}>LINK WALLET</Text>
              </GoldGradient>
            </Pressable>
          </View>
        )}

        {/* ── APP TOKENS ─────────────────────────────────── */}
        <View style={styles.tokenSelector}>
          <Pressable
            style={styles.tokenTab}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveToken("FANTASMA");
            }}
          >
            <GoldGradient
              style={[StyleSheet.absoluteFill, activeToken === "FANTASMA" && { borderColor: colors.primary }]}
            />
            <Text
              style={[
                styles.tokenTabText,
                {
                  color:
                    activeToken === "FANTASMA"
                      ? isLight
                        ? colors.primaryForeground
                        : "#FFFFFF"
                      : colors.mutedForeground,
                },
              ]}
            >
              {secondTokenSymbol}
            </Text>
          </Pressable>
          <Pressable
            style={styles.tokenTab}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveToken("GFC");
            }}
          >
            <GoldGradient
              style={[StyleSheet.absoluteFill, activeToken === "GFC" && { borderColor: colors.primary }]}
            />
            <Text
              style={[
                styles.tokenTabText,
                {
                  color:
                    activeToken === "GFC"
                      ? isLight
                        ? colors.primaryForeground
                        : "#FFFFFF"
                      : colors.mutedForeground,
                },
              ]}
            >
              {gfcSymbol}
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

        {walletAddress ? (
          <Pressable style={styles.addressBar} onPress={handleCopy}>
            <GoldGradient style={styles.addressBarInner}>
              <Ionicons name="wallet-outline" size={14} color={colors.mutedForeground} />
              <Text style={styles.addressLabel}>ADDR</Text>
              <Text style={styles.addressText} numberOfLines={1}>
                {walletAddress}
              </Text>
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={16}
                color={copied ? colors.foreground : colors.mutedForeground}
              />
            </GoldGradient>
          </Pressable>
        ) : (
          /* No wallet yet. Deliberately renders no address at all rather than
             a placeholder — a fake address is one users can copy and hand out
             as a receive address, losing real funds. */
          <View style={styles.noWalletCard}>
            <Ionicons name="wallet-outline" size={26} color={colors.mutedForeground} />
            <Text style={styles.noWalletTitle}>NO WALLET ON THIS DEVICE</Text>
            <Text style={styles.noWalletBody}>
              Create a non-custodial Solana wallet. The key is generated on this device
              and never leaves it — nobody else can recover it for you.
            </Text>
            <Pressable
              style={styles.noWalletBtn}
              onPress={handleCreateWallet}
              disabled={creatingWallet}
              testID="create-wallet-btn"
            >
              <GoldGradient style={styles.noWalletBtnInner}>
                {creatingWallet ? (
                  <ActivityIndicator size="small" color={colors.foreground} />
                ) : (
                  <Text style={styles.noWalletBtnTxt}>CREATE WALLET</Text>
                )}
              </GoldGradient>
            </Pressable>
            <Pressable
              onPress={() => {
                setRestoreError("");
                setRestoreInput("");
                setShowRestore(true);
              }}
              testID="restore-wallet-btn"
            >
              <Text style={styles.restoreLink}>RESTORE FROM RECOVERY PHRASE</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.actions}>
          {/* SEND is intentionally inert: the handler below never builds,
              signs, or broadcasts a transaction — it just flashes success.
              With a real receivable address on screen that would read as a
              working send and lose funds. Gated until signing lands. */}
          <Pressable
            style={[styles.actionBtn, styles.actionBtnDisabled]}
            disabled
            testID="send-btn-disabled"
          >
            <GoldGradient style={styles.actionBtnInner}>
              <Ionicons name="arrow-up" size={16} color={colors.mutedForeground} />
              <Text style={[styles.actionBtnText, { color: colors.mutedForeground }]}>SEND</Text>
            </GoldGradient>
          </Pressable>
          {/* Receiving needs a real address to show — no wallet, no modal. */}
          <Pressable
            style={[styles.actionBtn, !walletAddress && styles.actionBtnDisabled]}
            disabled={!walletAddress}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowReceive(true);
            }}
          >
            <GoldGradient style={styles.actionBtnInner}>
              <Ionicons
                name="arrow-down"
                size={16}
                color={walletAddress ? colors.foreground : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.actionBtnText,
                  { color: walletAddress ? colors.foreground : colors.mutedForeground },
                ]}
              >
                RECEIVE
              </Text>
            </GoldGradient>
          </Pressable>
          <Pressable style={styles.actionBtn} onPress={handleBuy}>
            <GoldGradient style={styles.actionBtnInner}>
              <Ionicons name="card-outline" size={16} color="#8A8A8A" />
              <Text style={[styles.actionBtnText, { color: "#8A8A8A" }]}>FUND</Text>
            </GoldGradient>
          </Pressable>
        </View>
        <Text style={styles.buyHelp}>
          Sending isn&apos;t available yet — this wallet can receive only.
        </Text>
        <Text style={styles.buyHelp}>
          {connectedWalletAddress
            ? "Buy SOL or USDC with a card — funds go to your linked Solana wallet. FSM and GFC can't be bought with a card."
            : "Link a Solana wallet to buy SOL or USDC with a card."}
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
                <GoldGradient style={styles.modalBtnInner}>
                {connecting ? (
                  <ActivityIndicator size="small" color={isLight ? colors.primaryForeground : "#FFF"} />
                ) : (
                  <Ionicons name="link" size={14} color={isLight ? colors.primaryForeground : "#FFF"} />
                )}
                <Text style={styles.modalBtnText}>
                  {connecting ? "LINKING..." : "LINK WALLET"}
                </Text>
                </GoldGradient>
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
              {walletAddress && (
                <Pressable style={styles.addressBar} onPress={handleCopy}>
                  <GoldGradient style={styles.addressBarInner}>
                    <Text style={styles.addressText} numberOfLines={1}>
                      {walletAddress}
                    </Text>
                    <Ionicons
                      name={copied ? "checkmark" : "copy-outline"}
                      size={16}
                      color={copied ? colors.foreground : colors.mutedForeground}
                    />
                  </GoldGradient>
                </Pressable>
              )}
              <Pressable style={[styles.cancelBtn, { marginTop: 8 }]} onPress={() => setShowReceive(false)}>
                <Text style={styles.cancelText}>CLOSE</Text>
              </Pressable>
            </View>
        </View>
      </Modal>

      {/* ── RECOVERY PHRASE BACKUP MODAL ─────────────────
          Shown exactly once, immediately after wallet creation. The phrase is
          not stored anywhere, so there is no way to bring this screen back —
          hence no dismiss path that isn't behind the confirmation. */}
      <Modal
        visible={backupPhrase !== null}
        transparent
        animationType="slide"
        /* No onRequestClose handler: Android back must not silently discard
           the only copy of the phrase. */
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>RECOVERY PHRASE</Text>

            <View style={styles.phraseWarnBox}>
              <Ionicons name="warning-outline" size={16} color={colors.destructive} />
              <Text style={styles.phraseWarnTxt}>
                These 24 words are the ONLY way to recover this wallet. They are shown
                once and cannot be shown again. Write them down and store them offline.
              </Text>
            </View>

            <ScrollView style={styles.phraseScroll} contentContainerStyle={styles.phraseGrid}>
              {(backupPhrase ?? "").split(" ").map((word, i) => (
                <View key={`${i}-${word}`} style={styles.phraseWordBox}>
                  <Text style={styles.phraseWordNum}>{i + 1}</Text>
                  <Text style={styles.phraseWord}>{word}</Text>
                </View>
              ))}
            </ScrollView>

            <Text style={styles.phraseNote}>
              A panic wipe, duress wipe, uninstall, or lost device destroys this wallet.
              Only this phrase brings it back — GHOSTFACE keeps no copy.
            </Text>
            <Text style={styles.phraseNote}>
              This is NOT the same phrase as the identity recovery phrase in Settings.
              Keep both, and keep them labelled.
            </Text>

            <Pressable style={styles.phraseCopyBtn} onPress={handleCopyPhrase}>
              <GoldGradient style={styles.phraseCopyBtnInner}>
                <Ionicons
                  name={phraseCopied ? "checkmark" : "copy-outline"}
                  size={14}
                  color={colors.mutedForeground}
                />
                <Text style={styles.phraseCopyTxt}>
                  {phraseCopied ? "COPIED" : "COPY PHRASE"}
                </Text>
              </GoldGradient>
            </Pressable>

            <Pressable
              style={styles.phraseConfirmRow}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setBackupConfirmed((v) => !v);
              }}
              testID="backup-confirm-checkbox"
            >
              <Ionicons
                name={backupConfirmed ? "checkbox" : "square-outline"}
                size={20}
                color={backupConfirmed ? colors.primary : colors.mutedForeground}
              />
              <Text style={styles.phraseConfirmTxt}>I have written this phrase down</Text>
            </Pressable>

            <Pressable
              style={[styles.modalBtnPrimary, !backupConfirmed && styles.actionBtnDisabled]}
              disabled={!backupConfirmed}
              onPress={dismissBackup}
              testID="backup-done-btn"
            >
              <GoldGradient style={styles.modalBtnPrimaryInner}>
                <Text
                  style={[
                    styles.modalBtnText,
                    { color: backupConfirmed ? colors.foreground : colors.mutedForeground },
                  ]}
                >
                  DONE
                </Text>
              </GoldGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── RESTORE FROM PHRASE MODAL ────────────────────── */}
      <Modal
        visible={showRestore}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRestore(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowRestore(false)} />
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>RESTORE WALLET</Text>
              <Text style={styles.phraseNote}>
                Enter the 24-word recovery phrase for the wallet you want to restore.
              </Text>
              <TextInput
                style={styles.restoreInput}
                value={restoreInput}
                onChangeText={(t) => {
                  setRestoreInput(t);
                  if (restoreError) setRestoreError("");
                }}
                placeholder="word1 word2 word3 ..."
                placeholderTextColor={colors.mutedForeground}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textAlignVertical="top"
                testID="restore-phrase-input"
              />
              {!!restoreError && <Text style={styles.restoreError}>{restoreError}</Text>}
              <Pressable
                style={styles.modalBtnPrimary}
                onPress={handleRestore}
                disabled={restoring}
                testID="restore-submit-btn"
              >
                <GoldGradient style={styles.modalBtnPrimaryInner}>
                  {restoring ? (
                    <ActivityIndicator size="small" color={colors.foreground} />
                  ) : (
                    <Text style={styles.modalBtnText}>RESTORE</Text>
                  )}
                </GoldGradient>
              </Pressable>
              <Pressable style={styles.cancelBtn} onPress={() => setShowRestore(false)}>
                <Text style={styles.cancelText}>CANCEL</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
    </TabScreenWrapper>
  );
}
