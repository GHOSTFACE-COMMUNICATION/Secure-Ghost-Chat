import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GoldGradient } from "@/components/GoldGradient";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { Ionicons } from "@expo/vector-icons";
import { WebQRScanner } from "./WebQRScanner";
import { type } from "@/constants/typography";

const GHOSTFACE_QR_PREFIX = "ghostface://add/";
const GHOSTFACE_INVITE_PREFIX = "ghostface://invite/";

export function encodeContactQR(alias: string): string {
  return `${GHOSTFACE_QR_PREFIX}${alias.toUpperCase()}`;
}

export function encodeInviteQR(code: string): string {
  return `${GHOSTFACE_INVITE_PREFIX}${code.toUpperCase()}`;
}

/**
 * Decodes a scanned QR value into either a contact alias or an invite code.
 * Returns the raw string (alias or GF-XXXX-XXXX invite code).
 * Returns null if the value is unrecognisable.
 */
export function decodeContactQR(data: string): string | null {
  const trimmed = data.trim();
  if (trimmed.startsWith(GHOSTFACE_QR_PREFIX)) {
    const alias = trimmed.slice(GHOSTFACE_QR_PREFIX.length).toUpperCase();
    return alias.length >= 2 ? alias : null;
  }
  if (trimmed.startsWith(GHOSTFACE_INVITE_PREFIX)) {
    // Strip prefix and any query params → return raw invite code e.g. GF-ABCD-1234
    const code = trimmed.slice(GHOSTFACE_INVITE_PREFIX.length).split("?")[0].toUpperCase();
    return /^GF-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code) ? code : null;
  }
  const upper = trimmed.toUpperCase();
  if (/^[A-Z0-9_-]{2,32}$/.test(upper)) return upper;
  return null;
}

interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  onScan: (alias: string) => void;
}

export function QRScanner({ visible, onClose, onScan }: QRScannerProps) {
  const colors = useColors();
  const { themePreference } = useApp();
  const isLight = themePreference === "light";
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (visible) {
      scannedRef.current = false;
      setFlash(false);
      if (Platform.OS !== "web" && !permission?.granted) requestPermission();
    }
  }, [visible]);

  const handleDecoded = useCallback((raw: string) => {
    if (scannedRef.current) return;
    const alias = decodeContactQR(raw);
    if (!alias) return;
    scannedRef.current = true;
    setFlash(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => {
      onScan(alias);
      onClose();
    }, 200);
  }, [onScan, onClose]);

  const handleBarcode = ({ data }: { data: string }) => handleDecoded(data);

  // Web uses getUserMedia + jsqr (expo-camera's onBarcodeScanned is mobile-only).
  if (Platform.OS === "web") {
    return (
      <WebQRScanner
        visible={visible}
        onClose={onClose}
        onDecoded={handleDecoded}
        flash={flash}
      />
    );
  }

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "#000",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: Platform.OS === "ios" ? 60 : 40,
      paddingBottom: 16,
      zIndex: 10,
    },
    headerTitle: {
      ...type.heading,
      fontSize: 14,
      letterSpacing: 1.5,
      color: colors.foreground,
    },
    camera: {
      flex: 1,
    },
    frame: {
      position: "absolute",
      top: 0, left: 0, right: 0, bottom: 0,
      justifyContent: "center",
      alignItems: "center",
    },
    scanBox: {
      width: 240,
      height: 240,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: "transparent",
    },
    corner: {
      position: "absolute",
      width: 28,
      height: 28,
    },
    label: {
      ...type.label,
      fontSize: 12,
      position: "absolute",
      bottom: 120,
      alignSelf: "center",
      color: colors.foreground,
      opacity: 0.8,
    },
    permBox: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      gap: 16,
    },
    permTxt: {
      ...type.body,
      fontSize: 14,
      color: colors.foreground,
      textAlign: "center",
      paddingHorizontal: 40,
    },
    permBtn: {
      borderRadius: colors.radius,
      overflow: "hidden",
    },
    permBtnInner: {
      paddingHorizontal: 28,
      paddingVertical: 12,
    },
    permBtnTxt: {
      ...type.labelStrong,
      fontSize: 12,
      letterSpacing: 1.5,
      color: isLight ? colors.primaryForeground : "#FFFFFF",
    },
    flashOverlay: {
      position: "absolute",
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: colors.primary,
      opacity: 0.3,
    },
  });

  const CORNER_COLOR = colors.primary;
  const CORNER_SIZE = 28;
  const CORNER_THICK = 3;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>SCAN QR CODE</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </Pressable>
        </View>

        {!permission?.granted ? (
          <View style={styles.permBox}>
            <Ionicons name="camera-outline" size={56} color={colors.mutedForeground} />
            <Text style={styles.permTxt}>Camera access needed to scan QR codes</Text>
            <Pressable style={styles.permBtn} onPress={requestPermission}>
              <GoldGradient style={styles.permBtnInner}>
                <Text style={styles.permBtnTxt}>ALLOW CAMERA</Text>
              </GoldGradient>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={handleBarcode}
            />
            <View style={styles.frame} pointerEvents="none">
              <View style={styles.scanBox}>
                {[
                  { top: -2, left: -2, borderTopWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK },
                  { top: -2, right: -2, borderTopWidth: CORNER_THICK, borderRightWidth: CORNER_THICK },
                  { bottom: -2, left: -2, borderBottomWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK },
                  { bottom: -2, right: -2, borderBottomWidth: CORNER_THICK, borderRightWidth: CORNER_THICK },
                ].map((pos, i) => (
                  <View
                    key={i}
                    style={[
                      styles.corner,
                      pos,
                      { borderColor: CORNER_COLOR, width: CORNER_SIZE, height: CORNER_SIZE, borderRadius: 4 },
                    ]}
                  />
                ))}
              </View>
              <Text style={styles.label}>POINT AT GHOST QR CODE</Text>
            </View>
            {flash && <View style={styles.flashOverlay} pointerEvents="none" />}
          </>
        )}
      </View>
    </Modal>
  );
}
