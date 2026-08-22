import React, { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { type } from "@/constants/typography";

interface Props {
  visible: boolean;
  onClose: () => void;
  onDecoded: (data: string) => void;
  flash: boolean;
}

export function WebQRScanner({ visible, onClose, onDecoded, flash }: Props) {
  const colors = useColors();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permState, setPermState] = useState<"idle" | "asking" | "granted" | "denied">("idle");

  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;
    let cancelled = false;

    const start = async () => {
      setError(null);
      setPermState("asking");
      try {
        if (!navigator?.mediaDevices?.getUserMedia) {
          throw new Error("Camera not supported in this browser");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setPermState("granted");

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();

        const jsQR = (await import("jsqr")).default;
        const canvas = canvasRef.current ?? document.createElement("canvas");
        canvasRef.current = canvas;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        const tick = () => {
          if (cancelled) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w > 0 && h > 0) {
              canvas.width = w;
              canvas.height = h;
              ctx.drawImage(video, 0, 0, w, h);
              const imageData = ctx.getImageData(0, 0, w, h);
              const code = jsQR(imageData.data, w, h, { inversionAttempts: "dontInvert" });
              if (code?.data) {
                onDecoded(code.data);
                return;
              }
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        const isDenied = err instanceof Error && err.name === "NotAllowedError";
        const msg = isDenied
          ? "Camera permission denied. Allow access in your browser to scan."
          : (err instanceof Error ? err.message : undefined) ?? "Could not start camera";
        setError(msg);
        setPermState(isDenied ? "denied" : "idle");
      }
    };

    start();

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      const video = videoRef.current;
      if (video) {
        try { video.pause(); } catch { /* noop */ }
        video.srcObject = null;
      }
    };
  }, [visible, onDecoded]);

  const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "#000" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 16,
      zIndex: 10,
    },
    headerTitle: { ...type.heading, color: colors.foreground, fontSize: 14 },
    body: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
    videoWrap: {
      width: 320,
      height: 320,
      borderRadius: 16,
      overflow: "hidden",
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: "#000",
    },
    label: {
      ...type.label,
      fontSize: 12,
      marginTop: 16,
      color: colors.foreground,
      opacity: 0.8,
    },
    err: {
      ...type.caption,
      fontSize: 12,
      marginTop: 16,
      color: colors.destructive ?? "#ff5577",
      textAlign: "center",
      paddingHorizontal: 24,
    },
    flashOverlay: {
      position: "absolute",
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: colors.primary,
      opacity: 0.3,
    },
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>SCAN QR CODE</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={styles.body}>
          <View style={styles.videoWrap}>
            {React.createElement("video", {
              ref: videoRef,
              style: { width: "100%", height: "100%", objectFit: "cover" },
              muted: true,
              playsInline: true,
              autoPlay: true,
            })}
          </View>
          <Text style={styles.label}>
            {permState === "asking" ? "REQUESTING CAMERA…" : "POINT AT GHOST QR CODE"}
          </Text>
          {error ? <Text style={styles.err}>{error}</Text> : null}
        </View>
        {flash && <View style={styles.flashOverlay} pointerEvents="none" />}
      </View>
    </Modal>
  );
}
