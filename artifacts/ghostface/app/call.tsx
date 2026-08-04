/* eslint-disable @typescript-eslint/no-explicit-any -- WebRTC interop: the native
   module (react-native-webrtc) and the browser RTC globals are loaded dynamically
   and are not statically typed uniformly across web/native platforms. */
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusDot } from "@/components/StatusDot";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { endNativeCall } from "@/lib/nativeCallUi";

// ── Native WebRTC (@livekit/react-native-webrtc) — native platforms only ────
// On web we use the browser's built-in WebRTC APIs instead. The @livekit fork
// replaced react-native-webrtc (task #152): expo-callkit-telecom coordinates
// CallKit's audio session with this fork's RTCAudioSession, which is what
// keeps call audio working when a call is answered from the lock screen.
let NativeRTCPeerConnection: any = null;
let NativeRTCSessionDescription: any = null;
let NativeRTCIceCandidate: any = null;
let nativeMediaDevices: any = null;
if (Platform.OS !== "web") {
  try {
    const webrtc = require("@livekit/react-native-webrtc");
    NativeRTCPeerConnection    = webrtc.RTCPeerConnection;
    NativeRTCSessionDescription = webrtc.RTCSessionDescription;
    NativeRTCIceCandidate      = webrtc.RTCIceCandidate;
    nativeMediaDevices         = webrtc.mediaDevices;
  } catch (e) {
    console.warn("[WebRTC] react-native-webrtc not available:", e);
  }
}

type VoicePreset = {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  description: string;
};

const VOICE_PRESETS: VoicePreset[] = [
  { id: "natural",  label: "NATURAL",   icon: "person-outline",        description: "Original voice" },
  { id: "robot",    label: "ROBOT",     icon: "hardware-chip-outline",  description: "Metallic tone" },
  { id: "deep",     label: "DEEP",      icon: "arrow-down-outline",     description: "Low frequency" },
  { id: "ghost",    label: "GHOST",     icon: "skull-outline",          description: "Ethereal echo" },
  { id: "alien",    label: "ALIEN",     icon: "planet-outline",         description: "Warped signal" },
  { id: "high",     label: "HIGH",      icon: "arrow-up-outline",       description: "High pitched" },
];

type IceServer = { urls: string | string[]; username?: string; credential?: string };
type IceConfig = { iceServers: IceServer[] };

// STUN-only fallback used if the server is unreachable. STUN alone won't traverse
// symmetric NAT or strict firewalls, but it's better than failing outright.
const STUN_FALLBACK: IceConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// Cache the ICE config for the lifetime of the JS context. The server returns
// short-lived TURN credentials, so refetching on every call is fine — but
// within a single call we want one stable config.
//
// We refresh once we're inside REFRESH_SKEW_MS of the absolute expiry. Same
// math as the server, so the two caches stay in step.
const REFRESH_SKEW_MS = 60_000;
const STUN_FALLBACK_TTL_SECONDS = 300;
let cachedIceConfig: IceConfig | null = null;
let cachedIceExpiresAt = 0;

function cacheFor(config: IceConfig, ttlSeconds: number): IceConfig {
  cachedIceConfig = config;
  cachedIceExpiresAt = Date.now() + ttlSeconds * 1000;
  return config;
}

async function fetchIceConfig(): Promise<IceConfig> {
  const now = Date.now();
  if (cachedIceConfig && now < cachedIceExpiresAt - REFRESH_SKEW_MS) {
    return cachedIceConfig;
  }

  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    console.warn("[WebRTC] EXPO_PUBLIC_DOMAIN not set; using STUN-only fallback");
    return cacheFor(STUN_FALLBACK, STUN_FALLBACK_TTL_SECONDS);
  }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://${domain}/api/ice-config`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { iceServers?: IceServer[]; ttl?: number };
    if (!data.iceServers || data.iceServers.length === 0) throw new Error("empty iceServers");
    const ttlSeconds = Math.max(120, Number(data.ttl ?? 600) || 600);
    return cacheFor({ iceServers: data.iceServers }, ttlSeconds);
  } catch (e) {
    console.warn("[WebRTC] /api/ice-config fetch failed, using STUN-only fallback:", e);
    return cacheFor(STUN_FALLBACK, STUN_FALLBACK_TTL_SECONDS);
  }
}

type CallState = "ringing" | "connecting" | "active" | "ended" | "no_answer";

export default function CallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { alias, mode, role, callId } = useLocalSearchParams<{
    alias: string;
    mode: "voice" | "video";
    role?: "caller" | "callee";
    callId?: string;
  }>();

  const { sendCallSignal, registerCallListener, wsConnected } = useApp();

  const isCaller = (role ?? "caller") === "caller";
  // useMemo so Date.now() is only called once on mount even if callId is undefined
  const effectiveCallId = useMemo(() => callId ?? Date.now().toString(), []);
  const isVideo = mode === "video";

  const [callState, setCallState]     = useState<CallState>(isCaller ? "ringing" : "connecting");
  const [duration, setDuration]       = useState(0);
  const [muted, setMuted]             = useState(false);
  const [speakerOn, setSpeakerOn]     = useState(false);
  const [showVoiceChanger, setShowVoiceChanger] = useState(false);
  const [activeVoice, setActiveVoice] = useState("natural");
  const [statusNote, setStatusNote]   = useState("");

  const pulseAnim      = useRef(new Animated.Value(1)).current;
  const voiceSlideAnim = useRef(new Animated.Value(0)).current;
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const pcRef          = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  const mountedRef     = useRef(true);
  // Ref so timeout callbacks always read the latest callState without stale closure
  const callStateRef   = useRef<CallState>(isCaller ? "ringing" : "connecting");
  useEffect(() => { callStateRef.current = callState; }, [callState]);

  // ── Start call duration timer when call goes active ──────────────────────
  useEffect(() => {
    if (callState !== "active") return;
    timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callState]);

  // ── Pulse animation while ringing / connecting ────────────────────────────
  useEffect(() => {
    if (callState !== "ringing" && callState !== "connecting") return;
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 800, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [callState, pulseAnim]);

  // ── Remote audio element (web only) ──────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = document.createElement("audio");
    el.id = "gf-remote-audio";
    el.autoplay = true;
    (el as any).playsInline = true;
    document.body.appendChild(el);
    return () => { try { el.remove(); } catch { /* element already removed */ } };
  }, []);

  // ── WebRTC helpers ────────────────────────────────────────────────────────
  const makePC = useCallback(async () => {
    // Pick the right RTCPeerConnection for the platform
    const RTC = Platform.OS === "web"
      ? (window as any).RTCPeerConnection
      : NativeRTCPeerConnection;
    if (!RTC) return null;

    const iceConfig = await fetchIceConfig();
    const pc = new RTC(iceConfig);

    pc.ontrack = (ev: any) => {
      if (Platform.OS === "web") {
        const el = document.getElementById("gf-remote-audio") as HTMLAudioElement | null;
        if (el && ev.streams?.[0]) el.srcObject = ev.streams[0];
      } else {
        // On native, audio plays automatically through the earpiece/speaker.
        // Store remote stream for video RTCView if needed.
        if (ev.streams?.[0]) remoteStreamRef.current = ev.streams[0];
      }
    };

    pc.onicecandidate = (ev: any) => {
      const candidate = ev.candidate ?? ev; // react-native-webrtc emits the candidate directly
      if (candidate && candidate.candidate) {
        sendCallSignal({ type: "call-ice", to: alias, callId: effectiveCallId, payload: JSON.stringify(candidate) });
      }
    };

    pc.onconnectionstatechange = () => {
      if (!mountedRef.current) return;
      const s = pc.connectionState;
      if (s === "connected")                       setCallState("active");
      if (s === "disconnected" || s === "failed")  handleEndInternal();
    };

    return pc;
  }, [alias, effectiveCallId, sendCallSignal]);

  const getMedia = useCallback(async (pc: any) => {
    if (!pc) return;
    try {
      const devices = Platform.OS === "web" ? navigator.mediaDevices : nativeMediaDevices;
      if (!devices) { setStatusNote("Microphone unavailable on this device"); return; }
      const stream = await devices.getUserMedia({ audio: true, video: isVideo });
      localStreamRef.current = stream;
      stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));
    } catch (e) {
      console.warn("[WebRTC] getUserMedia:", e);
      setStatusNote("Mic access denied — audio unavailable");
    }
  }, [isVideo]);

  const handleEndInternal = useCallback(() => {
    if (!mountedRef.current) return;
    if (timerRef.current) clearInterval(timerRef.current);
    if (pcRef.current) { try { pcRef.current.close(); } catch { /* ignore close errors */ } pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop()); localStreamRef.current = null; }
    // Task #152: clear the native CallKit / Core-Telecom call UI if this call
    // was answered from the lock screen. No-op when there is no native session.
    endNativeCall(effectiveCallId);
    setCallState("ended");
    setTimeout(() => { if (mountedRef.current) router.back(); }, 1200);
  }, [effectiveCallId]);

  // ── Caller: send ring on mount ────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    if (isCaller) {
      if (!wsConnected) {
        setStatusNote("Server not connected — check your internet connection");
        setCallState("no_answer");
        const t = setTimeout(() => { if (mountedRef.current) router.back(); }, 3000);
        return () => { mountedRef.current = false; clearTimeout(t); };
      }
      sendCallSignal({ type: "call-ring", to: alias, callId: effectiveCallId, callMode: mode ?? "voice" });
      // 30-second ring timeout
      const timeout = setTimeout(() => {
        // Use ref so we read the CURRENT callState, not the stale closure value
        if (mountedRef.current && callStateRef.current === "ringing") {
          setCallState("no_answer");
          setTimeout(() => { if (mountedRef.current) router.back(); }, 1500);
        }
      }, 30_000);
      return () => { mountedRef.current = false; clearTimeout(timeout); };
    }
    // Callee: send accept and let the call-offer signal drive WebRTC setup.
    // The signal listener handles both web and native — if NativeRTCPeerConnection
    // is unavailable (plain Expo Go without WebRTC), makePC() returns null and
    // the handler falls back to setCallState("active") gracefully.
    sendCallSignal({ type: "call-accept", to: alias, callId: effectiveCallId });
    return () => { mountedRef.current = false; };
  }, []);

  // ── Call signal listener ──────────────────────────────────────────────────
  useEffect(() => {
    registerCallListener(async (signal) => {
      if (signal.callId && signal.callId !== effectiveCallId) return;
      if (!mountedRef.current) return;

      // ── call-accept (caller receives) ─────────────────────────────────────
      if (signal.type === "call-accept" && isCaller) {
        setCallState("connecting");
        const pc = await makePC();
        if (!pc) { setCallState("active"); return; }
        pcRef.current = pc;
        await getMedia(pc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendCallSignal({ type: "call-offer", to: alias, callId: effectiveCallId, payload: JSON.stringify(offer) });
        return;
      }

      // ── call-offer (callee receives) ──────────────────────────────────────
      if (signal.type === "call-offer" && !isCaller && signal.payload) {
        const pc = await makePC();
        if (!pc) { setCallState("active"); return; }
        pcRef.current = pc;
        await getMedia(pc);
        const SDP = Platform.OS === "web" ? (window as any).RTCSessionDescription : NativeRTCSessionDescription;
        if (SDP) {
          await pc.setRemoteDescription(new SDP(JSON.parse(signal.payload)));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendCallSignal({ type: "call-answer", to: alias, callId: effectiveCallId, payload: JSON.stringify(answer) });
        }
        setCallState("active");
        return;
      }

      // ── call-answer (caller receives) ─────────────────────────────────────
      if (signal.type === "call-answer" && isCaller && signal.payload && pcRef.current) {
        const SDP = Platform.OS === "web" ? (window as any).RTCSessionDescription : NativeRTCSessionDescription;
        if (SDP) {
          try {
            await pcRef.current.setRemoteDescription(new SDP(JSON.parse(signal.payload)));
          } catch (e) {
            console.warn("[WebRTC] setRemoteDescription:", e);
          }
        }
        setCallState("active");
        return;
      }

      // ── call-ice (either) ─────────────────────────────────────────────────
      if (signal.type === "call-ice" && signal.payload && pcRef.current) {
        const ICE = Platform.OS === "web" ? (window as any).RTCIceCandidate : NativeRTCIceCandidate;
        if (ICE) {
          try { await pcRef.current.addIceCandidate(new ICE(JSON.parse(signal.payload))); } catch { /* ignore malformed ICE candidate */ }
        }
        return;
      }

      // ── call-hangup (either receives) ─────────────────────────────────────
      if (signal.type === "call-hangup") {
        handleEndInternal();
      }
    });

    return () => registerCallListener(null);
  }, [alias, effectiveCallId, isCaller, makePC, getMedia, sendCallSignal, handleEndInternal, registerCallListener]);

  // ── UI handlers ───────────────────────────────────────────────────────────
  const handleEnd = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    sendCallSignal({ type: "call-hangup", to: alias, callId: effectiveCallId });
    handleEndInternal();
  };

  const toggleVoiceChanger = () => {
    setShowVoiceChanger((v) => !v);
    Animated.spring(voiceSlideAnim, { toValue: showVoiceChanger ? 0 : 1, useNativeDriver: true, tension: 80, friction: 12 }).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const displayAlias = alias ?? "UNKNOWN";
  const activePreset  = VOICE_PRESETS.find((p) => p.id === activeVoice)!;
  const voiceActive   = activeVoice !== "natural";

  const callStatusText = () => {
    if (callState === "ringing")    return "RINGING...";
    if (callState === "connecting") return isCaller ? "CONNECTING..." : "JOINING...";
    if (callState === "ended")      return "CALL ENDED";
    if (callState === "no_answer")  return "NO ANSWER";
    return isVideo ? "VIDEO ACTIVE" : "CALL ACTIVE";
  };

  const callStatusColor = () => {
    if (callState === "active")                          return colors.success;
    if (callState === "ended" || callState === "no_answer") return colors.destructive;
    return colors.primary;
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1, backgroundColor: colors.background,
      paddingTop: insets.top + (Platform.OS === "web" ? 67 : 40),
      paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 48),
    },
    topSection: { alignItems: "center", gap: 14, flex: 1, justifyContent: "center" },
    avatarRing: {
      width: 120, height: 120, borderRadius: 60,
      borderWidth: 2,
      borderColor: callState === "active" ? colors.success : colors.border,
      alignItems: "center", justifyContent: "center",
    },
    avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
    avatarText: { color: colors.primary, fontSize: 32, fontWeight: "800" as const, letterSpacing: 2 },
    aliasText: { color: colors.foreground, fontSize: 22, fontWeight: "800" as const, letterSpacing: 4 },
    statusRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    statusText: { fontSize: 13, letterSpacing: 3, fontWeight: "600" as const },
    durationText: { color: colors.mutedForeground, fontSize: 13, letterSpacing: 4, fontWeight: "600" as const },
    encRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    encText: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 2 },
    noteText: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 1, textAlign: "center" as const, maxWidth: 240 },
    voiceActiveRow: {
      flexDirection: "row" as const, alignItems: "center" as const, gap: 6,
      backgroundColor: `${colors.primary}20`, borderRadius: 20,
      paddingHorizontal: 12, paddingVertical: 4,
    },
    voiceActiveText: { color: colors.primary, fontSize: 10, letterSpacing: 2, fontWeight: "700" as const },
    bottomSection: { gap: 16 },
    vcPanel: {
      marginHorizontal: 16, backgroundColor: colors.card,
      borderRadius: colors.radius, borderWidth: 1,
      borderColor: voiceActive ? colors.primary : colors.border, overflow: "hidden",
    },
    vcHeader: {
      flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between",
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: showVoiceChanger ? 1 : 0, borderBottomColor: colors.border,
    },
    vcHeaderLeft: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    vcHeaderTitle: { color: voiceActive ? colors.primary : colors.foreground, fontSize: 12, fontWeight: "700" as const, letterSpacing: 3 },
    vcHeaderSub: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 1 },
    vcGrid: { flexDirection: "row" as const, flexWrap: "wrap" as const, padding: 12, gap: 8 },
    vcPreset: { flex: 1, minWidth: 80, alignItems: "center" as const, paddingVertical: 12, borderRadius: colors.radius, borderWidth: 1.5, gap: 4 },
    vcLabel: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 2 },
    vcDesc: { fontSize: 8, letterSpacing: 0.5 },
    controls: { flexDirection: "row" as const, gap: 20, alignItems: "center" as const, justifyContent: "center" as const },
    ctrlItem: { alignItems: "center" as const },
    ctrlBtn: {
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      alignItems: "center" as const, justifyContent: "center" as const,
    },
    ctrlBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    ctrlBtnVoice: {
      backgroundColor: voiceActive ? `${colors.primary}25` : colors.card,
      borderColor: voiceActive ? colors.primary : colors.border,
    },
    endBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.destructive, alignItems: "center" as const, justifyContent: "center" as const },
    modeLabel: { color: colors.mutedForeground, fontSize: 9, letterSpacing: 2, marginTop: 4, textAlign: "center" as const },
    webrtcBadge: {
      flexDirection: "row" as const, alignItems: "center" as const, gap: 4,
      backgroundColor: `${colors.success}18`, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 3,
    },
    webrtcBadgeTxt: { color: colors.success, fontSize: 9, fontWeight: "700" as const, letterSpacing: 2 },
  });

  return (
    <View style={styles.container}>
      <View style={styles.topSection}>
        <Animated.View style={[styles.avatarRing, (callState === "ringing" || callState === "connecting") && { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{displayAlias.slice(0, 2)}</Text>
          </View>
        </Animated.View>

        <Text style={styles.aliasText}>{displayAlias}</Text>

        <View style={styles.statusRow}>
          <StatusDot active={callState === "active"} size={6} />
          <Text style={[styles.statusText, { color: callStatusColor() }]}>
            {callStatusText()}
          </Text>
        </View>

        {callState === "active" && (
          <Text style={styles.durationText}>{formatDuration(duration)}</Text>
        )}

        <View style={styles.encRow}>
          <Ionicons name="lock-closed" size={10} color={colors.mutedForeground} />
          <Text style={styles.encText}>ZRTP {isVideo ? "VIDEO" : "VOICE"} ENCRYPTED</Text>
        </View>

        {Platform.OS === "web" && callState === "active" && (
          <View style={styles.webrtcBadge}>
            <Ionicons name="radio-outline" size={10} color={colors.success} />
            <Text style={styles.webrtcBadgeTxt}>WEBRTC P2P · LIVE</Text>
          </View>
        )}

        {Platform.OS !== "web" && callState === "active" && (
          <View style={styles.webrtcBadge}>
            <Ionicons name="radio-outline" size={10} color={colors.success} />
            <Text style={styles.webrtcBadgeTxt}>SIGNALLING LIVE</Text>
          </View>
        )}

        {statusNote !== "" && (
          <Text style={styles.noteText}>{statusNote}</Text>
        )}

        {voiceActive && (
          <View style={styles.voiceActiveRow}>
            <Ionicons name="mic" size={10} color={colors.primary} />
            <Text style={styles.voiceActiveText}>VOICE: {activePreset.label}</Text>
          </View>
        )}
      </View>

      <View style={styles.bottomSection}>
        {/* Voice changer panel */}
        <Pressable style={styles.vcPanel} onPress={toggleVoiceChanger}>
          <View style={styles.vcHeader}>
            <View style={styles.vcHeaderLeft}>
              <Ionicons name="mic-outline" size={18} color={voiceActive ? colors.primary : colors.mutedForeground} />
              <View>
                <Text style={styles.vcHeaderTitle}>VOICE CHANGER {voiceActive ? `· ${activePreset.label}` : ""}</Text>
                <Text style={styles.vcHeaderSub}>{voiceActive ? activePreset.description.toUpperCase() : "TAP TO CONFIGURE"}</Text>
              </View>
            </View>
            <Ionicons name={showVoiceChanger ? "chevron-down" : "chevron-up"} size={16} color={colors.mutedForeground} />
          </View>
          {showVoiceChanger && (
            <View style={styles.vcGrid}>
              {VOICE_PRESETS.map((preset) => {
                const active = activeVoice === preset.id;
                return (
                  <Pressable
                    key={preset.id}
                    style={[styles.vcPreset, { backgroundColor: active ? `${colors.primary}20` : "transparent", borderColor: active ? colors.primary : colors.border }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveVoice(preset.id); }}
                  >
                    <Ionicons name={preset.icon} size={20} color={active ? colors.primary : colors.mutedForeground} />
                    <Text style={[styles.vcLabel, { color: active ? colors.primary : colors.foreground }]}>{preset.label}</Text>
                    <Text style={[styles.vcDesc, { color: colors.mutedForeground }]}>{preset.description}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Pressable>

        {/* Call controls */}
        <View style={styles.controls}>
          <View style={styles.ctrlItem}>
            <Pressable style={[styles.ctrlBtn, muted && styles.ctrlBtnActive]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMuted((m) => !m); }}>
              <Ionicons name={muted ? "mic-off" : "mic"} size={22} color={muted ? colors.primaryForeground : colors.foreground} />
            </Pressable>
            <Text style={styles.modeLabel}>{muted ? "UNMUTE" : "MUTE"}</Text>
          </View>

          <View style={styles.ctrlItem}>
            <Pressable style={[styles.ctrlBtn, styles.ctrlBtnVoice]} onPress={toggleVoiceChanger}>
              <Ionicons name="mic-circle-outline" size={22} color={voiceActive ? colors.primary : colors.foreground} />
            </Pressable>
            <Text style={[styles.modeLabel, voiceActive && { color: colors.primary }]}>VOICE FX</Text>
          </View>

          <View style={styles.ctrlItem}>
            <Pressable style={styles.endBtn} onPress={handleEnd} testID="end-call-btn">
              <Ionicons name="call" size={26} color="#FFFFFF" style={{ transform: [{ rotate: "135deg" }] }} />
            </Pressable>
            <Text style={styles.modeLabel}>END</Text>
          </View>

          <View style={styles.ctrlItem}>
            <Pressable style={[styles.ctrlBtn, speakerOn && styles.ctrlBtnActive]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSpeakerOn((s) => !s); }}>
              <Ionicons name={speakerOn ? "volume-high" : "volume-medium"} size={22} color={speakerOn ? colors.primaryForeground : colors.foreground} />
            </Pressable>
            <Text style={styles.modeLabel}>SPEAKER</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
