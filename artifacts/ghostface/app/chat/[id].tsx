import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GoldGradient } from "@/components/GoldGradient";
import { SecureBadge } from "@/components/SecureBadge";
import { StatusDot } from "@/components/StatusDot";
import type { Attachment } from "@/context/AppContext";
import { MAX_ATTACHMENT_B64_CHARS, useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { drKeyFingerprint } from "@/lib/doubleRatchet";
import {
  base64ToBytes,
  bytesToDataUri,
  downloadAndDecryptBlob,
  uploadEncryptedBlob,
} from "@/lib/blobStore";

// Allow photos up to ~25 MiB raw. Base64 inflates ~4/3 so the picker
// returns up to ~34 MB of base64; the encrypted upload itself stays well
// under the server's 32 MiB ciphertext cap.
const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const MAX_PHOTO_B64_CHARS = Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 16;
const PHOTO_QUALITY = 0.85;

// Module-level LRU cache so a single decrypted image is reused across renders
// (FlatList recycles cells and we don't want to re-download on every scroll).
// Bounded so long scrollback never grows memory without limit — old entries
// are evicted FIFO once the cap is reached.
const BLOB_CACHE_MAX_ENTRIES = 24;
const blobUriCache = new Map<string, string>();
function cacheBlobUri(blobId: string, uri: string): void {
  if (blobUriCache.has(blobId)) blobUriCache.delete(blobId);
  blobUriCache.set(blobId, uri);
  while (blobUriCache.size > BLOB_CACHE_MAX_ENTRIES) {
    const oldest = blobUriCache.keys().next().value;
    if (oldest === undefined) break;
    blobUriCache.delete(oldest);
  }
}
function readBlobUri(blobId: string): string | undefined {
  const v = blobUriCache.get(blobId);
  if (v !== undefined) {
    // Touch — move to most-recent end so it isn't evicted on next insert.
    blobUriCache.delete(blobId);
    blobUriCache.set(blobId, v);
  }
  return v;
}

function EncryptedImageView({
  attachment,
  style,
}: {
  attachment: Extract<Attachment, { kind: "image" | "image-ref" }>;
  style: import("react-native").ImageStyle;
}): React.ReactElement {
  // For image-ref: prefer the previously decrypted bytes from the module
  // cache; otherwise fall back to the sender's local picker URI as an
  // immediate placeholder. Either way, we ALWAYS attempt the blob fetch
  // (unless already cached) so a stale/inaccessible local URI on the
  // sender's device can self-heal by re-downloading and decrypting.
  const cached = attachment.kind === "image-ref" ? readBlobUri(attachment.blobId) : undefined;
  const initialUri =
    attachment.kind === "image"
      ? attachment.uri
      : cached ?? attachment.uri;
  const [uri, setUri] = useState<string | undefined>(initialUri);
  const [failed, setFailed] = useState(false);
  // Low-bandwidth mode: defer the auto-download so encrypted blobs aren't
  // pulled over a satellite link unless the user taps to fetch.
  const { lowBandwidthActive } = useApp();
  const [manualFetch, setManualFetch] = useState(0);
  const colors = useColors();

  useEffect(() => {
    if (attachment.kind !== "image-ref") return;
    if (readBlobUri(attachment.blobId)) return; // already decrypted in this session
    // In low-bandwidth mode, only fetch when the user explicitly taps.
    // `manualFetch` is bumped on tap to re-run this effect.
    if (lowBandwidthActive && manualFetch === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const bytes = await downloadAndDecryptBlob(attachment.blobId, attachment.key);
        const mime = attachment.mimeType ?? "image/jpeg";
        const dataUri = bytesToDataUri(bytes, mime);
        if (cancelled) return;
        cacheBlobUri(attachment.blobId, dataUri);
        setUri(dataUri);
      } catch (e) {
        if (cancelled) return;
        console.warn("[Attach] blob fetch/decrypt failed", e);
        // Only mark as failed if we don't have any local URI to fall back
        // on — the sender's freshly-picked photo still renders even when
        // the server is briefly unreachable.
        if (!attachment.uri) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment, lowBandwidthActive, manualFetch]);

  // Low-bandwidth placeholder: photo not auto-downloaded. Tap to fetch.
  if (
    lowBandwidthActive &&
    attachment.kind === "image-ref" &&
    !uri &&
    !readBlobUri(attachment.blobId)
  ) {
    return (
      <Pressable
        style={[style, { alignItems: "center", justifyContent: "center", backgroundColor: colors.muted, gap: 4 }]}
        onPress={() => setManualFetch((n) => n + 1)}
        accessibilityLabel="Tap to fetch encrypted photo"
        testID="lbw-image-deferred"
      >
        <Ionicons name="cloud-download-outline" size={22} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, fontWeight: "800" }}>
          TAP TO FETCH
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 8, letterSpacing: 1 }}>
          LO-BW
        </Text>
      </Pressable>
    );
  }

  const handleImageError = () => {
    // The local picker URI we're displaying is no longer readable (e.g.
    // app re-installed, cache cleared). Drop it and let the next render
    // show the lock placeholder while the effect retries the fetch.
    if (attachment.kind === "image-ref" && !readBlobUri(attachment.blobId)) {
      setUri(undefined);
    } else {
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <View style={[style, { alignItems: "center", justifyContent: "center", backgroundColor: colors.muted }]}>
        <Ionicons name="image-outline" size={24} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 4, letterSpacing: 1 }}>
          UNAVAILABLE
        </Text>
      </View>
    );
  }
  if (!uri) {
    return (
      <View style={[style, { alignItems: "center", justifyContent: "center", backgroundColor: colors.muted }]}>
        <Ionicons name="lock-closed" size={20} color={colors.mutedForeground} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit="cover"
      transition={120}
      onError={handleImageError}
      accessibilityLabel="Encrypted photo attachment"
    />
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function formatExpiry(expiresAt: number): string {
  const secsLeft = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  if (secsLeft < 60) return `${secsLeft}s`;
  if (secsLeft < 3600) return `${Math.floor(secsLeft / 60)}m`;
  if (secsLeft < 86400) return `${Math.floor(secsLeft / 3600)}h`;
  return `${Math.floor(secsLeft / 86400)}d`;
}

const DISAPPEAR_OPTIONS = [
  { label: "OFF", value: undefined },
  { label: "30s", value: 30 },
  { label: "5m", value: 300 },
  { label: "1h", value: 3600 },
  { label: "24h", value: 86400 },
  { label: "7d", value: 604800 },
];

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { conversations, sendMessage, retryMessage, deleteMessage, clearConversation, setDisappearTimer, markMessagesViewed, verifyConversation, deleteConversation, lowBandwidthActive, wsConnected } = useApp();
  const [text, setText] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [showDisappear, setShowDisappear] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<Attachment | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordStartRef = useRef<number>(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playingSoundRef = useRef<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const listRef = useRef<FlatList>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return () => {
      // Best-effort cleanup if we navigate away mid-record / mid-play.
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      playingSoundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const showQueuedToast = () => {
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  };

  const conv = conversations.find((c) => c.id === id);

  // Tick every second whenever a disappear timer could be live in this
  // conversation — either our own outgoing default (disappearAfterSec) or
  // any message carrying a receiver-side ttlMs (envelope-sourced, so it can
  // be present even when we've never set a local disappear timer ourselves).
  const hasTtlMessages = conv?.messages.some((m) => m.ttlMs) ?? false;
  useEffect(() => {
    if (!conv?.disappearAfterSec && !hasTtlMessages) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [conv?.id, conv?.disappearAfterSec, hasTtlMessages]);

  // Stamp viewedAt (and start the countdown) for every currently-visible
  // message that has a TTL and hasn't been viewed yet. Fires on every focus
  // — not just mount — so returning to an already-open conversation still
  // catches messages that arrived (or were scrolled into view) since the
  // last focus.
  useFocusEffect(
    useCallback(() => {
      if (!conv) return;
      const unviewed = conv.messages.filter((m) => m.ttlMs && !m.viewedAt).map((m) => m.id);
      if (unviewed.length > 0) markMessagesViewed(conv.id, unviewed);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conv?.id, conv?.messages]),
  );

  if (!conv) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.mutedForeground, letterSpacing: 2 }}>CHANNEL NOT FOUND</Text>
      </View>
    );
  }

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed && !pendingAttachment) return;
    if (conv.destroyedAt) return; // Composer is hidden, but belt-and-braces.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = sendMessage(conv.id, trimmed, pendingAttachment ?? undefined);
    if (result.queued) showQueuedToast();
    setText("");
    setPendingAttachment(null);
  };

  // Build an inline data URI from a picked image so the attachment travels
  // through the existing E2EE message channel without needing any external
  // storage. Quality and size are capped so the encoded payload stays small.
  const pickFromLibrary = async () => {
    setShowAttachMenu(false);
    if (attachBusy) return;
    // Low-bandwidth mode: refuse BEFORE running the picker so we don't read
    // a multi-MB photo into memory and upload its encrypted blob over a
    // satellite link, only to have sendMessage reject afterwards.
    if (lowBandwidthActive) {
      Alert.alert("Low-bandwidth mode", "Attachments are blocked to save satellite data. Toggle off in Settings to send.");
      return;
    }
    setAttachBusy(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "PHOTOS ACCESS DENIED",
          "Enable photo library access in your device settings to attach images.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: PHOTO_QUALITY,
        base64: true,
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];
      const mime = a.mimeType ?? "image/jpeg";
      if (!a.base64 || a.base64.length > MAX_PHOTO_B64_CHARS) {
        Alert.alert(
          "IMAGE TOO LARGE",
          "Photos up to 25 MB can be sent encrypted. Try a smaller image.",
        );
        return;
      }
      const bytes = base64ToBytes(a.base64);
      const { blobId, key } = await uploadEncryptedBlob(bytes);
      setPendingAttachment({
        kind: "image-ref",
        blobId,
        key,
        uri: a.uri,
        width: a.width,
        height: a.height,
        mimeType: mime,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      console.warn("[Attach] library pick failed", e);
      Alert.alert("ATTACH FAILED", "Could not upload the selected image.");
    } finally {
      setAttachBusy(false);
    }
  };

  const pickFromCamera = async () => {
    setShowAttachMenu(false);
    if (attachBusy) return;
    if (lowBandwidthActive) {
      Alert.alert("Low-bandwidth mode", "Attachments are blocked to save satellite data. Toggle off in Settings to send.");
      return;
    }
    setAttachBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "CAMERA ACCESS DENIED",
          "Enable camera access in your device settings to capture photos.",
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: PHOTO_QUALITY,
        base64: true,
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];
      const mime = a.mimeType ?? "image/jpeg";
      if (!a.base64 || a.base64.length > MAX_PHOTO_B64_CHARS) {
        Alert.alert(
          "PHOTO TOO LARGE",
          "Photos up to 25 MB can be sent encrypted.",
        );
        return;
      }
      const bytes = base64ToBytes(a.base64);
      const { blobId, key } = await uploadEncryptedBlob(bytes);
      setPendingAttachment({
        kind: "image-ref",
        blobId,
        key,
        uri: a.uri,
        width: a.width,
        height: a.height,
        mimeType: mime,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      console.warn("[Attach] camera capture failed", e);
      Alert.alert("CAPTURE FAILED", "Could not upload the captured photo.");
    } finally {
      setAttachBusy(false);
    }
  };

  // Files travel through the same E2EE envelope as images, so we read them
  // into a base64 data URI here (gated by a 5 MB cap to keep the ratchet
  // ciphertext from bloating). Anything larger should ship via a separate
  // encrypted blob channel — out of scope for this task.
  const MAX_FILE_BYTES = 5 * 1024 * 1024;

  const pickFile = async () => {
    setShowAttachMenu(false);
    if (attachBusy) return;
    if (lowBandwidthActive) {
      Alert.alert("Low-bandwidth mode", "Attachments are blocked to save satellite data. Toggle off in Settings to send.");
      return;
    }
    setAttachBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const f = result.assets[0];
      if (f.size && f.size > MAX_FILE_BYTES) {
        Alert.alert(
          "FILE TOO LARGE",
          "Files up to 5 MB can be sent end-to-end encrypted in this build.",
        );
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(f.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      // Belt-and-braces: some pickers omit `size`, so re-check post-read so
      // we never push an oversized blob into state/encryption.
      if (base64.length > MAX_ATTACHMENT_B64_CHARS) {
        Alert.alert(
          "FILE TOO LARGE",
          "Files up to 5 MB can be sent end-to-end encrypted in this build.",
        );
        return;
      }
      const mime = f.mimeType ?? "application/octet-stream";
      setPendingAttachment({
        kind: "file",
        uri: `data:${mime};base64,${base64}`,
        name: f.name || "attachment",
        size: f.size,
        mimeType: mime,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      console.warn("[Attach] file pick failed", e);
      Alert.alert("ATTACH FAILED", "Could not load the selected file.");
    } finally {
      setAttachBusy(false);
    }
  };

  // Voice notes: record with expo-av, then read the resulting file into a
  // base64 data URI so it rides the same E2EE envelope as photos/files.
  const openRecorder = async () => {
    setShowAttachMenu(false);
    if (attachBusy) return;
    if (lowBandwidthActive) {
      Alert.alert("Low-bandwidth mode", "Voice notes are blocked to save satellite data. Toggle off in Settings to record.");
      return;
    }
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "MICROPHONE ACCESS DENIED",
          "Enable microphone access in your device settings to record voice notes.",
        );
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      setShowRecorder(true);
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      recordStartRef.current = Date.now();
      setIsRecording(true);
      setRecordingMs(0);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      recordTimerRef.current = setInterval(() => {
        setRecordingMs(Date.now() - recordStartRef.current);
      }, 200);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      console.warn("[Voice] start record failed", e);
      Alert.alert("RECORDING FAILED", "Could not start recording.");
      setShowRecorder(false);
    }
  };

  const stopRecorder = async (keep: boolean) => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const rec = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);
    if (!rec) {
      setShowRecorder(false);
      return;
    }
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      const duration = Date.now() - recordStartRef.current;
      if (!keep || !uri) {
        setShowRecorder(false);
        return;
      }
      const info = await FileSystem.getInfoAsync(uri);
      if (info.exists && info.size && info.size > MAX_FILE_BYTES) {
        Alert.alert(
          "VOICE NOTE TOO LONG",
          "Voice notes are capped at 5 MB. Try a shorter recording.",
        );
        setShowRecorder(false);
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (base64.length > MAX_ATTACHMENT_B64_CHARS) {
        Alert.alert(
          "VOICE NOTE TOO LONG",
          "Voice notes are capped at 5 MB. Try a shorter recording.",
        );
        return;
      }
      const mime = Platform.OS === "ios" ? "audio/mp4" : "audio/m4a";
      setPendingAttachment({
        kind: "audio",
        uri: `data:${mime};base64,${base64}`,
        durationMs: duration,
        mimeType: mime,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      console.warn("[Voice] stop record failed", e);
      Alert.alert("RECORDING FAILED", "Could not save the voice note.");
    } finally {
      setShowRecorder(false);
      // Restore non-recording audio mode so subsequent playback (in any chat)
      // is not stuck in iOS record-mode routing.
      Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      }).catch(() => {});
    }
  };

  const playAudio = async (msgId: string, dataUri: string) => {
    try {
      if (playingSoundRef.current) {
        await playingSoundRef.current.unloadAsync();
        playingSoundRef.current = null;
      }
      if (playingId === msgId) {
        setPlayingId(null);
        return;
      }
      const { sound } = await Audio.Sound.createAsync({ uri: dataUri }, { shouldPlay: true });
      playingSoundRef.current = sound;
      setPlayingId(msgId);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          if (playingSoundRef.current === sound) playingSoundRef.current = null;
          setPlayingId((cur) => (cur === msgId ? null : cur));
        }
      });
    } catch (e) {
      console.warn("[Voice] play failed", e);
      Alert.alert("PLAYBACK FAILED", "Could not play this voice note.");
    }
  };

  const formatBytes = (n?: number) => {
    if (!n || n <= 0) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  const formatDuration = (ms?: number) => {
    const total = Math.max(0, Math.floor((ms ?? 0) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleLongPress = (msgId: string, fromMe: boolean, plaintext: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const deleteTitle = fromMe ? "DELETE MESSAGE" : "DELETE FOR ME";
    const deleteMsg = fromMe
      ? "Permanently delete this message?"
      : "Remove this message from your view?";

    const copy = async () => {
      await Clipboard.setStringAsync(plaintext);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };

    if (Platform.OS !== "web") {
      Alert.alert(
        "MESSAGE",
        fromMe ? "Copy text or permanently delete this message?" : "Copy text or remove this message from your view?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Copy", onPress: copy },
          { text: "Delete", style: "destructive", onPress: () => deleteMessage(conv.id, msgId) },
        ],
        { cancelable: true }
      );
    } else {
      const choice = window.prompt(`MESSAGE\nType "copy" to copy text, "delete" to ${fromMe ? "delete" : "remove"}:`, "copy");
      if (choice === "copy") copy();
      else if (choice === "delete") {
        if (window.confirm(`${deleteTitle}\n${deleteMsg}`)) deleteMessage(conv.id, msgId);
      }
    }
  };

  const handleClearChat = () => {
    if (Platform.OS !== "web") {
      Alert.alert("CLEAR CHAT", "Delete all messages in this channel? This cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: () => { clearConversation(conv.id); setShowInfo(false); } },
      ]);
    } else if (window.confirm("CLEAR CHAT\nDelete all messages in this channel? This cannot be undone.")) {
      clearConversation(conv.id);
      setShowInfo(false);
    }
  };

  const currentDisappear = DISAPPEAR_OPTIONS.find((o) => o.value === conv.disappearAfterSec)
    ?? DISAPPEAR_OPTIONS[0];

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 8),
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 12,
    },
    headerInfo: { flex: 1 },
    headerAlias: { color: colors.foreground, fontSize: 14, fontWeight: "800", letterSpacing: 3 },
    headerSub: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
    headerSubText: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 2 },
    headerTimerBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 2,
      backgroundColor: `${colors.destructive}20`,
      borderRadius: 4,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    headerTimerTxt: {
      fontSize: 8,
      fontWeight: "800" as const,
      letterSpacing: 1,
      color: colors.destructive,
    },
    headerActions: { flexDirection: "row", gap: 12, alignItems: "center" },
    encBanner: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: `${colors.primary}08`,
    },
    encBannerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
    encBannerTxt: { color: colors.mutedForeground, fontSize: 9, letterSpacing: 2 },
    disappearBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: conv.disappearAfterSec ? `${colors.destructive}22` : "transparent",
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    disappearTxt: {
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 2,
      color: conv.disappearAfterSec ? colors.destructive : colors.mutedForeground,
    },
    listContent: { paddingHorizontal: 16, paddingVertical: 12 },
    msgRow: { marginVertical: 4, maxWidth: "80%" },
    msgBubble: { borderRadius: colors.radius, paddingHorizontal: 12, paddingVertical: 8 },
    msgText: { fontSize: 14, lineHeight: 20, letterSpacing: 0.3 },
    msgMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
    msgTime: { fontSize: 9, letterSpacing: 0.5 },
    fingerprint: { fontSize: 8, letterSpacing: 1, opacity: 0.5, fontFamily: "monospace" },
    expiryBadge: {
      fontSize: 8,
      fontWeight: "800",
      letterSpacing: 1,
      color: colors.destructive,
    },
    sealedBadge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 2,
      backgroundColor: `${colors.primary}1A`,
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingVertical: 1,
    },
    sealedTxt: {
      fontSize: 7,
      fontWeight: "800" as const,
      letterSpacing: 1,
      color: colors.primary,
    },
    inputBar: {
      flexDirection: "row",
      alignItems: "flex-end",
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 10),
      gap: 8,
    },
    input: {
      flex: 1,
      backgroundColor: colors.card,
      color: colors.foreground,
      fontSize: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 10,
      maxHeight: 120,
    },
    sendBtn: {
      width: 40, height: 40, borderRadius: 20,
      alignItems: "center", justifyContent: "center",
      overflow: "hidden",
    },
    sendBtnInner: {
      width: "100%", height: "100%", borderRadius: 20,
      alignItems: "center", justifyContent: "center",
    },
    sendBtnDisabled: { backgroundColor: colors.muted },
    callBtn: { padding: 6 },
    attachBtn: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: colors.card,
      borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center",
    },

    // Image attachment in bubble
    msgBubbleWithImage: { padding: 4, gap: 6 },
    msgImage: {
      width: 220, height: 220, borderRadius: 10,
      backgroundColor: colors.muted,
    },
    msgTextWithImage: { paddingHorizontal: 8, paddingBottom: 4, paddingTop: 2 },

    // Pending attachment chip
    attachPreviewBar: {
      flexDirection: "row", alignItems: "center", gap: 10,
      paddingHorizontal: 12, paddingVertical: 8,
      borderTopWidth: 1, borderTopColor: colors.border,
      backgroundColor: colors.card,
    },
    attachPreviewImg: {
      width: 40, height: 40, borderRadius: 6,
      backgroundColor: colors.muted,
    },
    attachPreviewLabel: {
      color: colors.foreground, fontSize: 10, fontWeight: "800", letterSpacing: 2,
    },
    attachPreviewSub: {
      color: colors.mutedForeground, fontSize: 10, marginTop: 2,
    },
    attachPreviewClose: {
      width: 28, height: 28, borderRadius: 14,
      backgroundColor: colors.background,
      borderWidth: 1, borderColor: colors.border,
      alignItems: "center", justifyContent: "center",
    },

    // Attach sheet options
    attachHint: {
      color: colors.mutedForeground, fontSize: 11, lineHeight: 16,
    },
    attachOption: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 12, paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.background,
    },
    attachIconWrap: {
      width: 36, height: 36, borderRadius: 18,
      backgroundColor: `${colors.primary}15`,
      alignItems: "center", justifyContent: "center",
    },
    attachOptionTitle: {
      color: colors.foreground, fontSize: 11, fontWeight: "800", letterSpacing: 2,
    },
    attachOptionSub: {
      color: colors.mutedForeground, fontSize: 10, marginTop: 2,
    },
    attachPreviewIconBox: {
      alignItems: "center", justifyContent: "center",
      backgroundColor: `${colors.primary}15`,
    },

    // In-bubble audio chip
    audioChip: {
      flexDirection: "row", alignItems: "center", gap: 10,
      paddingHorizontal: 12, paddingVertical: 10,
      borderRadius: 14, minWidth: 200,
    },
    audioBars: {
      flexDirection: "row", alignItems: "center", gap: 3, flex: 1,
    },
    audioBar: {
      width: 2, borderRadius: 1, opacity: 0.8,
    },
    audioDuration: {
      fontSize: 11, fontWeight: "700", letterSpacing: 1,
    },

    // In-bubble file chip
    fileChip: {
      flexDirection: "row", alignItems: "center", gap: 10,
      paddingHorizontal: 12, paddingVertical: 10,
      borderRadius: 12, minWidth: 220, maxWidth: 260,
    },
    fileIconWrap: {
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: "rgba(255,255,255,0.18)",
      alignItems: "center", justifyContent: "center",
    },
    fileName: { fontSize: 12, fontWeight: "700" },
    fileSize: { fontSize: 10, marginTop: 2 },

    // Recorder modal
    recorderBox: {
      backgroundColor: colors.card,
      margin: 24, borderRadius: 16,
      borderWidth: 1, borderColor: colors.border,
      padding: 24, alignItems: "center", gap: 18,
    },
    recorderTitle: {
      color: colors.foreground, fontSize: 12, fontWeight: "800", letterSpacing: 4,
    },
    recorderDot: {
      width: 12, height: 12, borderRadius: 6,
      backgroundColor: colors.destructive,
    },
    recorderTime: {
      color: colors.foreground, fontSize: 32, fontWeight: "800",
      letterSpacing: 4, fontVariant: ["tabular-nums"],
    },
    recorderHint: {
      color: colors.mutedForeground, fontSize: 11, textAlign: "center",
    },
    recorderRow: {
      flexDirection: "row", gap: 12, marginTop: 4,
    },
    recorderBtn: {
      flex: 1, paddingVertical: 12, borderRadius: 10,
      alignItems: "center", justifyContent: "center",
      borderWidth: 1, borderColor: colors.border,
    },
    recorderBtnTxt: {
      fontSize: 11, fontWeight: "800", letterSpacing: 2,
    },

    // Info modal
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border,
      paddingBottom: insets.bottom + 24,
    },
    handle: {
      width: 40, height: 4, borderRadius: 2,
      backgroundColor: colors.border, alignSelf: "center", marginTop: 14, marginBottom: 4,
    },
    sheetHead: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 20, paddingVertical: 16,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    sheetTitle: { color: colors.foreground, fontSize: 13, fontWeight: "800", letterSpacing: 4 },
    sheetBody: { padding: 20, gap: 16 },
    safetyRow: {
      backgroundColor: colors.background,
      borderRadius: 12, borderWidth: 1, borderColor: colors.border,
      padding: 16, gap: 8,
    },
    safetyLabel: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 3 },
    safetyNumber: {
      color: colors.success,
      fontSize: 16, fontWeight: "800", letterSpacing: 4,
      fontFamily: "monospace",
    },
    safetyNote: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 1 },
    infoRow: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    infoLabel: { color: colors.mutedForeground, fontSize: 11, letterSpacing: 2 },
    infoValue: { color: colors.foreground, fontSize: 11, fontWeight: "700", letterSpacing: 2 },
    disappearOptions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    disappearOpt: {
      borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
      borderWidth: 1, borderColor: colors.border,
    },
    disappearOptTxt: { fontSize: 11, fontWeight: "800", letterSpacing: 2 },
    clearBtn: {
      marginTop: 4,
      borderWidth: 1,
      borderColor: colors.destructive,
      borderRadius: colors.radius,
      paddingVertical: 13,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 8,
    },
    clearBtnTxt: {
      color: colors.destructive,
      fontSize: 12,
      fontWeight: "800" as const,
      letterSpacing: 3,
    },
  });

  const messages = [...conv.messages];

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding" keyboardVerticalOffset={0}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={{ padding: 4 }} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.headerAlias}>{conv.alias}</Text>
          <View style={styles.headerSub}>
            <StatusDot active size={5} pulse={false} />
            <Text style={styles.headerSubText}>
              {conv.drSession
                ? conv.drSession.alice.pq
                  ? "POST-QUANTUM · DOUBLE RATCHET · CHACHA20"
                  : "DOUBLE RATCHET · X3DH · CHACHA20"
                : "SECURE · CHACHA20-POLY1305"}
            </Text>
            {conv.disappearAfterSec && (
              <View style={styles.headerTimerBadge}>
                <Ionicons name="timer-outline" size={8} color={colors.destructive} />
                <Text style={styles.headerTimerTxt}>
                  {currentDisappear.label}
                </Text>
              </View>
            )}
            {lowBandwidthActive && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 2,
                  backgroundColor: `${colors.primary}20`,
                  borderRadius: 4,
                  paddingHorizontal: 5,
                  paddingVertical: 1,
                }}
                testID="lbw-header-badge"
              >
                <Ionicons name="cellular-outline" size={8} color={colors.primary} />
                <Text style={{ fontSize: 8, fontWeight: "800", letterSpacing: 1, color: colors.primary }}>
                  LO-BW
                </Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.callBtn} onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({ pathname: "/call", params: { alias: conv.alias, mode: "voice", role: "caller", callId: Date.now().toString() } });
          }} testID="voice-call-btn">
            <Ionicons name="call-outline" size={20} color={colors.primary} />
          </Pressable>
          <Pressable style={styles.callBtn} onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({ pathname: "/call", params: { alias: conv.alias, mode: "video", role: "caller", callId: Date.now().toString() } });
          }} testID="video-call-btn">
            <Ionicons name="videocam-outline" size={20} color={colors.primary} />
          </Pressable>
          <Pressable style={styles.callBtn} onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowInfo(true);
          }}>
            <Ionicons
              name={conv.verified ? "shield-checkmark" : "shield-checkmark-outline"}
              size={20}
              color={conv.verified ? colors.primary : colors.success}
            />
          </Pressable>
        </View>
      </View>

      {/* Encryption banner */}
      <View style={styles.encBanner}>
        <View style={styles.encBannerLeft}>
          <SecureBadge type={conv.drSession ? "double-ratchet" : "e2ee"} size="sm" />
          <Text style={styles.encBannerTxt}>
            {conv.drSession ? "DOUBLE RATCHET · SEALED SENDER" : "E2EE · SEALED SENDER"}
          </Text>
        </View>
        <Pressable style={styles.disappearBadge} onPress={() => setShowDisappear(true)}>
          <Ionicons
            name={conv.disappearAfterSec ? "timer-outline" : "timer-outline"}
            size={10}
            color={conv.disappearAfterSec ? colors.destructive : colors.mutedForeground}
          />
          <Text style={styles.disappearTxt}>
            {currentDisappear.label === "OFF" ? "DISAPPEAR: OFF" : `DISAPPEAR: ${currentDisappear.label}`}
          </Text>
        </Pressable>
      </View>

      {/* Message list */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          item.system ? (
            <View
              style={{
                alignSelf: "center",
                maxWidth: "85%",
                marginVertical: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: `${colors.destructive}10`,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
              testID={`system-msg-${item.id}`}
            >
              <Ionicons name="skull-outline" size={14} color={colors.destructive} />
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 11,
                  fontStyle: "italic",
                  flex: 1,
                  textAlign: "center",
                }}
              >
                {item.text}
              </Text>
            </View>
          ) : (
          <Pressable
            style={[styles.msgRow, item.fromMe ? { alignSelf: "flex-end" } : { alignSelf: "flex-start" }]}
            onLongPress={() => handleLongPress(item.id, item.fromMe, item.text)}
            delayLongPress={400}
          >
            <View style={[
              styles.msgBubble,
              {
                backgroundColor: item.fromMe ? colors.primary : colors.card,
                borderWidth: item.fromMe ? 0 : 1,
                borderColor: colors.border,
              },
              (item.attachment?.kind === "image" || item.attachment?.kind === "image-ref") &&
                styles.msgBubbleWithImage,
            ]}>
              {(item.attachment?.kind === "image" || item.attachment?.kind === "image-ref") && (
                <EncryptedImageView attachment={item.attachment} style={styles.msgImage} />
              )}
              {item.attachment?.kind === "audio" && (
                <Pressable
                  style={[
                    styles.audioChip,
                    {
                      backgroundColor: item.fromMe
                        ? "rgba(255,255,255,0.18)"
                        : `${colors.primary}18`,
                    },
                  ]}
                  onPress={() => playAudio(item.id, item.attachment!.uri)}
                  testID={`audio-play-${item.id}`}
                  accessibilityLabel="Play voice note"
                >
                  <Ionicons
                    name={playingId === item.id ? "pause" : "play"}
                    size={16}
                    color={item.fromMe ? colors.primaryForeground : colors.primary}
                  />
                  <View style={styles.audioBars}>
                    {[6, 12, 9, 14, 8, 11, 7].map((h, i) => (
                      <View
                        key={i}
                        style={[
                          styles.audioBar,
                          {
                            height: h,
                            backgroundColor: item.fromMe ? colors.primaryForeground : colors.primary,
                          },
                        ]}
                      />
                    ))}
                  </View>
                  <Text
                    style={[
                      styles.audioDuration,
                      { color: item.fromMe ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {formatDuration(item.attachment.durationMs)}
                  </Text>
                </Pressable>
              )}
              {item.attachment?.kind === "file" && (
                <Pressable
                  style={[
                    styles.fileChip,
                    {
                      backgroundColor: item.fromMe
                        ? "rgba(255,255,255,0.18)"
                        : `${colors.primary}10`,
                    },
                  ]}
                  onPress={async () => {
                    await Clipboard.setStringAsync(item.attachment!.uri);
                    Alert.alert(
                      "FILE COPIED",
                      "The encrypted file payload was copied to your clipboard. Paste it where you can decode the base64 data URI.",
                    );
                  }}
                  testID={`file-${item.id}`}
                  accessibilityLabel="Encrypted file attachment"
                >
                  <View style={styles.fileIconWrap}>
                    <Ionicons
                      name="document"
                      size={18}
                      color={item.fromMe ? colors.primaryForeground : colors.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.fileName,
                        { color: item.fromMe ? colors.primaryForeground : colors.foreground },
                      ]}
                      numberOfLines={1}
                    >
                      {item.attachment.name}
                    </Text>
                    {item.attachment.size && (
                      <Text
                        style={[
                          styles.fileSize,
                          { color: item.fromMe ? "rgba(255,255,255,0.7)" : colors.mutedForeground },
                        ]}
                      >
                        {formatBytes(item.attachment.size)}
                      </Text>
                    )}
                  </View>
                </Pressable>
              )}
              {!!item.text && (
                <Text
                  style={[
                    styles.msgText,
                    { color: item.fromMe ? colors.primaryForeground : colors.foreground },
                    item.attachment?.kind === "image" && styles.msgTextWithImage,
                  ]}
                >
                  {item.text}
                </Text>
              )}
            </View>
            <View style={[styles.msgMeta, item.fromMe ? { justifyContent: "flex-end" } : {}]}>
              <Text style={[styles.msgTime, { color: colors.mutedForeground }]}>
                {formatTime(item.timestamp)}
              </Text>
              {item.failed ? (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    retryMessage(conv.id, item.id);
                  }}
                  style={[styles.sealedBadge, { backgroundColor: `${colors.destructive}22`, flexDirection: "row", alignItems: "center", gap: 3 }]}
                  testID={`retry-msg-${item.id}`}
                >
                  <Ionicons name="alert-circle-outline" size={8} color={colors.destructive} />
                  <Text style={[styles.sealedTxt, { color: colors.destructive }]}>FAILED · TAP TO RETRY</Text>
                </Pressable>
              ) : item.pending ? (
                // Three-state pending badge (task #112):
                //   wsConnected  → "SENDING"          (drain attempt in flight)
                //   !wsConnected → "WAITING FOR SIGNAL" (queued, link down)
                // The hard attempt-cap is gone, so a pending message keeps
                // this badge across satellite gaps until it lands or the
                // conversation seals via the handshake-expiry sweep.
                wsConnected ? (
                  <View style={[styles.sealedBadge, { backgroundColor: `${colors.mutedForeground}22` }]} testID={`sending-msg-${item.id}`}>
                    <Ionicons name="paper-plane-outline" size={7} color={colors.mutedForeground} />
                    <Text style={[styles.sealedTxt, { color: colors.mutedForeground }]}>SENDING</Text>
                  </View>
                ) : (
                  <View style={[styles.sealedBadge, { backgroundColor: `${colors.mutedForeground}22` }]} testID={`waiting-msg-${item.id}`}>
                    <Ionicons name="cloud-offline-outline" size={7} color={colors.mutedForeground} />
                    <Text style={[styles.sealedTxt, { color: colors.mutedForeground }]}>WAITING FOR SIGNAL</Text>
                  </View>
                )
              ) : (
                <>
                  {item.encrypted && (
                    <Ionicons name="lock-closed" size={8} color={colors.mutedForeground} />
                  )}
                  {item.sealed && (
                    <View style={styles.sealedBadge}>
                      <Ionicons name="mail-unread-outline" size={7} color={colors.primary} />
                      <Text style={styles.sealedTxt}>SEALED</Text>
                    </View>
                  )}
                </>
              )}
              {item.fingerprint && (
                <Text style={styles.fingerprint}>{item.fingerprint}</Text>
              )}
              {item.expiresAt && (
                <Text style={styles.expiryBadge}>⏱ {formatExpiry(item.expiresAt)}</Text>
              )}
            </View>
          </Pressable>
          )
        )}
      />

      {/* Pending attachment preview chip */}
      {pendingAttachment && (
        <View style={styles.attachPreviewBar}>
          {pendingAttachment.kind === "image" ? (
            <Image
              source={{ uri: pendingAttachment.uri }}
              style={styles.attachPreviewImg}
              contentFit="cover"
            />
          ) : pendingAttachment.kind === "image-ref" && pendingAttachment.uri ? (
            <Image
              source={{ uri: pendingAttachment.uri }}
              style={styles.attachPreviewImg}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.attachPreviewImg, styles.attachPreviewIconBox]}>
              <Ionicons
                name={pendingAttachment.kind === "audio" ? "mic" : "document"}
                size={20}
                color={colors.primary}
              />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.attachPreviewLabel}>
              {(pendingAttachment.kind === "image" || pendingAttachment.kind === "image-ref") &&
                "ENCRYPTED PHOTO"}
              {pendingAttachment.kind === "audio" && "ENCRYPTED VOICE NOTE"}
              {pendingAttachment.kind === "file" && "ENCRYPTED FILE"}
            </Text>
            <Text style={styles.attachPreviewSub} numberOfLines={1}>
              {pendingAttachment.kind === "image" &&
                "Sent end-to-end through the Double Ratchet"}
              {pendingAttachment.kind === "image-ref" &&
                "Encrypted blob · key carried inside the ratchet"}
              {pendingAttachment.kind === "audio" &&
                `${formatDuration(pendingAttachment.durationMs)} · Double Ratchet`}
              {pendingAttachment.kind === "file" &&
                `${pendingAttachment.name}${pendingAttachment.size ? ` · ${formatBytes(pendingAttachment.size)}` : ""}`}
            </Text>
          </View>
          <Pressable
            onPress={() => setPendingAttachment(null)}
            style={styles.attachPreviewClose}
            testID="attach-clear"
            accessibilityLabel="Remove attachment"
          >
            <Ionicons name="close" size={14} color={colors.mutedForeground} />
          </Pressable>
        </View>
      )}

      {/* Input bar — replaced with a sealed banner when the peer has self-destructed */}
      {conv.destroyedAt ? (
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 14,
            paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 14),
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: `${colors.destructive}10`,
            alignItems: "center",
            gap: 8,
          }}
          testID="conv-sealed-banner"
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="skull-outline" size={14} color={colors.destructive} />
            <Text style={{ color: colors.destructive, fontSize: 11, fontWeight: "800", letterSpacing: 3 }}>
              CONTACT SELF-DESTRUCTED
            </Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center" }}>
            This contact has wiped their device. The conversation is sealed.
          </Text>
          <Pressable
            testID="conv-sealed-delete-btn"
            accessibilityLabel="Delete sealed conversation"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const doDelete = () => {
                deleteConversation(conv.id);
                router.back();
              };
              if (Platform.OS !== "web") {
                Alert.alert(
                  "Delete Sealed Conversation",
                  `Remove the conversation with ${conv.alias} from your device? This cannot be undone.`,
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: doDelete },
                  ]
                );
              } else if (window.confirm(`Remove the conversation with ${conv.alias} from your device? This cannot be undone.`)) {
                doDelete();
              }
            }}
            style={({ pressed }) => ({
              marginTop: 4,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: colors.destructive,
              backgroundColor: pressed ? `${colors.destructive}33` : `${colors.destructive}1A`,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            })}
          >
            <Ionicons name="trash-outline" size={13} color={colors.destructive} />
            <Text style={{ color: colors.destructive, fontSize: 10, fontWeight: "800", letterSpacing: 2 }}>
              DELETE SEALED CONVERSATION
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.inputBar}>
          <Pressable
            style={styles.attachBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowAttachMenu(true);
            }}
            testID="attach-btn"
            accessibilityLabel="Attach to message"
          >
            <Ionicons name="add" size={20} color={colors.mutedForeground} />
          </Pressable>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Encrypted message..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            testID="message-input"
          />
          <Pressable
            style={[styles.sendBtn, !text.trim() && !pendingAttachment && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim() && !pendingAttachment}
            testID="send-btn"
          >
            {text.trim() || pendingAttachment ? (
              <GoldGradient style={styles.sendBtnInner}>
                <Ionicons
                  name="send"
                  size={16}
                  color={colors.primaryForeground}
                />
              </GoldGradient>
            ) : (
              <Ionicons
                name="send"
                size={16}
                color={colors.mutedForeground}
              />
            )}
          </Pressable>
        </View>
      )}

      {/* Attachment menu sheet */}
      <Modal
        visible={showAttachMenu}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAttachMenu(false)}
      >
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAttachMenu(false)} />
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>ATTACH TO MESSAGE</Text>
                <Pressable onPress={() => setShowAttachMenu(false)}>
                  <Ionicons name="close" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>
              <View style={styles.sheetBody}>
                <Text style={styles.attachHint}>
                  All attachments are encrypted with the same Double Ratchet keys as your messages.
                </Text>

                <Pressable
                  style={styles.attachOption}
                  onPress={pickFromLibrary}
                  testID="attach-photo-library"
                >
                  <View style={styles.attachIconWrap}>
                    <Ionicons name="images" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attachOptionTitle}>PHOTO LIBRARY</Text>
                    <Text style={styles.attachOptionSub}>Pick a photo from your device</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
                </Pressable>

                <Pressable
                  style={styles.attachOption}
                  onPress={pickFromCamera}
                  testID="attach-camera"
                >
                  <View style={styles.attachIconWrap}>
                    <Ionicons name="camera" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attachOptionTitle}>CAMERA</Text>
                    <Text style={styles.attachOptionSub}>Capture a photo with the camera</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
                </Pressable>

                <Pressable
                  style={styles.attachOption}
                  onPress={pickFile}
                  testID="attach-file"
                >
                  <View style={styles.attachIconWrap}>
                    <Ionicons name="document" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attachOptionTitle}>FILE</Text>
                    <Text style={styles.attachOptionSub}>Send any document up to 5 MB</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
                </Pressable>

                <Pressable
                  style={styles.attachOption}
                  onPress={openRecorder}
                  testID="attach-voice"
                >
                  <View style={styles.attachIconWrap}>
                    <Ionicons name="mic" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attachOptionTitle}>VOICE NOTE</Text>
                    <Text style={styles.attachOptionSub}>Record an encrypted audio message</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
                </Pressable>

                <Pressable
                  style={styles.attachOption}
                  onPress={() => {
                    setShowAttachMenu(false);
                    setShowDisappear(true);
                  }}
                  testID="attach-disappear"
                >
                  <View style={styles.attachIconWrap}>
                    <Ionicons name="timer-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.attachOptionTitle}>SELF-DESTRUCT TIMER</Text>
                    <Text style={styles.attachOptionSub}>
                      Set how long messages last in this chat
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>
        </View>
      </Modal>

      {/* Voice note recorder */}
      <Modal
        visible={showRecorder}
        transparent
        animationType="fade"
        onRequestClose={() => stopRecorder(false)}
      >
        <View style={[styles.overlay, { justifyContent: "center" }]}>
          <View style={styles.recorderBox}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {isRecording && <View style={styles.recorderDot} />}
              <Text style={styles.recorderTitle}>VOICE NOTE</Text>
            </View>
            <Text style={styles.recorderTime}>{formatDuration(recordingMs)}</Text>
            <Text style={styles.recorderHint}>
              Audio is encrypted end-to-end through the same Double Ratchet keys as your messages.
            </Text>
            <View style={styles.recorderRow}>
              <Pressable
                style={[styles.recorderBtn, { backgroundColor: colors.background }]}
                onPress={() => stopRecorder(false)}
                testID="recorder-cancel"
              >
                <Text style={[styles.recorderBtnTxt, { color: colors.mutedForeground }]}>CANCEL</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.recorderBtn,
                  { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
                onPress={() => stopRecorder(true)}
                disabled={!isRecording}
                testID="recorder-stop"
              >
                <Text style={[styles.recorderBtnTxt, { color: colors.primaryForeground }]}>
                  STOP &amp; ATTACH
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Security info sheet */}
      <Modal visible={showInfo} transparent animationType="slide" onRequestClose={() => setShowInfo(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowInfo(false)} />
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>SECURITY INFO</Text>
                <Pressable onPress={() => setShowInfo(false)}>
                  <Ionicons name="close" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>
              <View style={styles.sheetBody}>
                {/* Safety number */}
                {conv.safetyNumber && (
                  <View style={[
                    styles.safetyRow,
                    conv.verified && { borderColor: `${colors.primary}60`, backgroundColor: `${colors.primary}08` },
                  ]}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <Text style={styles.safetyLabel}>SAFETY NUMBER</Text>
                      {conv.verified && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: `${colors.primary}22`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Ionicons name="shield-checkmark" size={10} color={colors.primary} />
                          <Text style={{ color: colors.primary, fontSize: 9, fontWeight: "800", letterSpacing: 2 }}>VERIFIED</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.safetyNumber}>{conv.safetyNumber}</Text>
                    <Text style={styles.safetyNote}>
                      {conv.verified
                        ? `Identity confirmed. Safety number matches ${conv.alias}.`
                        : `Compare with ${conv.alias} out-of-band to verify identity`}
                    </Text>
                  </View>
                )}
                {/* Ratchet state panel — only visible for DR sessions */}
                {conv.drSession && (() => {
                  const drStep = conv.drSession.alice.step;
                  const stepColor = drStep === 0 ? colors.primary : colors.success;
                  return (
                    <View style={[styles.safetyRow, { backgroundColor: `${stepColor}10`, borderColor: `${stepColor}40` }]}>
                      <Text style={[styles.safetyLabel, { color: stepColor }]}>RATCHET STATE</Text>
                      <View style={{ flexDirection: "row", gap: 20, flexWrap: "wrap", marginTop: 4 }}>
                        <View>
                          <Text style={[styles.safetyLabel, { fontSize: 8 }]}>DH STEPS</Text>
                          <Text style={[styles.safetyNumber, { fontSize: 22, color: stepColor }]}>
                            {drStep}
                          </Text>
                        </View>
                        <View>
                          <Text style={[styles.safetyLabel, { fontSize: 8 }]}>SENT</Text>
                          <Text style={[styles.safetyNumber, { fontSize: 22 }]}>
                            {conv.drSession!.alice.Ns}
                          </Text>
                        </View>
                        <View>
                          <Text style={[styles.safetyLabel, { fontSize: 8 }]}>RECV</Text>
                          <Text style={[styles.safetyNumber, { fontSize: 22 }]}>
                            {conv.drSession!.alice.Nr}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.safetyNote, { fontFamily: "monospace", marginTop: 6 }]}>
                        DH KEY: {drKeyFingerprint(conv.drSession!.alice)}...
                      </Text>
                      <Text style={[styles.safetyNote, { marginTop: 2 }]}>
                        {drStep === 0 ? "Awaiting first ratchet step" : "Each reply triggers a new DH ratchet step"}
                      </Text>
                    </View>
                  );
                })()}

                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>PROTOCOL</Text>
                  <Text style={[styles.infoValue, { color: colors.success }]}>
                    {conv.drSession ? "DOUBLE RATCHET" : "SEALED SENDER"}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>KEY AGREEMENT</Text>
                  <Text style={[styles.infoValue, { color: colors.success }]}>
                    {conv.drSession
                      ? conv.drSession.alice.pq
                        ? "PQXDH · X25519 + ML-KEM-768"
                        : "X3DH · X25519"
                      : "ECDH"}
                  </Text>
                </View>
                {conv.drSession && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>QUANTUM RESISTANCE</Text>
                    <Text
                      style={[
                        styles.infoValue,
                        { color: conv.drSession.alice.pq ? colors.success : colors.mutedForeground },
                      ]}
                    >
                      {conv.drSession.alice.pq ? "HYBRID PQ (ML-KEM-768)" : "CLASSICAL ONLY"}
                    </Text>
                  </View>
                )}
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>CIPHER</Text>
                  <Text style={[styles.infoValue, { color: colors.success }]}>CHACHA20-POLY1305</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>KDF</Text>
                  <Text style={[styles.infoValue, { color: colors.success }]}>
                    {conv.drSession ? "HKDF-SHA256 · HMAC-SHA256" : "SHA-256"}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>FORWARD SECRECY</Text>
                  <Text style={[styles.infoValue, { color: colors.success }]}>ENABLED</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>BREAK-IN RECOVERY</Text>
                  <Text style={[styles.infoValue, { color: conv.drSession ? colors.success : colors.mutedForeground }]}>
                    {conv.drSession ? "ENABLED" : "N/A"}
                  </Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>NONCE</Text>
                  <Text style={[styles.infoValue, { color: colors.success }]}>RANDOM 96-BIT PER MSG</Text>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>SEALED SENDER</Text>
                  <Text style={[styles.infoValue, { color: colors.success }]}>ACTIVE</Text>
                </View>
                <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.infoLabel}>LIBRARY</Text>
                  <Text style={styles.infoValue}>@NOBLE/{conv.drSession ? "CURVES + HASHES" : "CIPHERS"}</Text>
                </View>
                {/* Verify / Unverify */}
                <Pressable
                  style={({ pressed }) => [
                    styles.clearBtn,
                    {
                      borderColor: conv.verified ? colors.mutedForeground : colors.primary,
                      backgroundColor: conv.verified ? "transparent" : `${colors.primary}12`,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    verifyConversation(conv.id);
                  }}
                >
                  <Ionicons
                    name={conv.verified ? "shield-outline" : "shield-checkmark"}
                    size={14}
                    color={conv.verified ? colors.mutedForeground : colors.primary}
                  />
                  <Text style={[styles.clearBtnTxt, { color: conv.verified ? colors.mutedForeground : colors.primary }]}>
                    {conv.verified ? "REMOVE VERIFICATION" : "MARK AS VERIFIED"}
                  </Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.7 }]}
                  onPress={handleClearChat}
                >
                  <Ionicons name="trash-outline" size={14} color={colors.destructive} />
                  <Text style={styles.clearBtnTxt}>CLEAR CHAT</Text>
                </Pressable>
              </View>
            </View>
        </View>
      </Modal>

      {/* Disappearing messages sheet */}
      <Modal visible={showDisappear} transparent animationType="slide" onRequestClose={() => setShowDisappear(false)}>
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowDisappear(false)} />
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>DISAPPEARING MESSAGES</Text>
                <Pressable onPress={() => setShowDisappear(false)}>
                  <Ionicons name="close" size={20} color={colors.mutedForeground} />
                </Pressable>
              </View>
              <View style={styles.sheetBody}>
                <Text style={styles.safetyNote}>
                  Messages auto-delete after the set time. Screenshots are blocked on both sides.
                </Text>
                <Text style={[styles.safetyNote, { opacity: 0.6, marginTop: -4 }]}>
                  This timer is enforced by the app on each device — it cannot be guaranteed against a modified client.
                </Text>
                <View style={styles.disappearOptions}>
                  {DISAPPEAR_OPTIONS.map((opt) => {
                    const active = opt.value === conv.disappearAfterSec;
                    return (
                      <Pressable
                        key={opt.label}
                        style={[
                          styles.disappearOpt,
                          active && { backgroundColor: colors.primary, borderColor: colors.primary },
                        ]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setDisappearTimer(conv.id, opt.value);
                          setShowDisappear(false);
                        }}
                      >
                        <Text style={[
                          styles.disappearOptTxt,
                          { color: active ? colors.primaryForeground : colors.mutedForeground },
                        ]}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
        </View>
      </Modal>
      {/* Queued message toast — shown briefly when a message is held for delivery */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: insets.bottom + 80,
          left: 20,
          right: 20,
          opacity: toastOpacity,
          backgroundColor: `${colors.card}F2`,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          paddingVertical: 10,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Ionicons name="time-outline" size={14} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 12, letterSpacing: 1, fontWeight: "600" }}>
          MESSAGE QUEUED — will send when connected
        </Text>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}
