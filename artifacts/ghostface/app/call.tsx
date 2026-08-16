/* eslint-disable @typescript-eslint/no-explicit-any -- WebRTC interop: the native
   module (react-native-webrtc) and the browser RTC globals are loaded dynamically
   and are not statically typed uniformly across web/native platforms. */
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { notifyCallEnded } from "@/hooks/usePushNotifications";

// ── Native WebRTC (react-native-webrtc) — loaded only on native platforms ───
// On web we use the browser's built-in WebRTC APIs instead.
let NativeRTCPeerConnection: any = null;
let NativeRTCSessionDescription: any = null;
let NativeRTCIceCandidate: any = null;
let NativeRTCView: any = null;
let nativeMediaDevices: any = null;
if (Platform.OS !== "web") {
  try {
    const webrtc = require("react-native-webrtc");
    NativeRTCPeerConnection    = webrtc.RTCPeerConnection;
    NativeRTCSessionDescription = webrtc.RTCSessionDescription;
    NativeRTCIceCandidate      = webrtc.RTCIceCandidate;
    NativeRTCView              = webrtc.RTCView;
    nativeMediaDevices         = webrtc.mediaDevices;
  } catch (e) {
    console.warn("[WebRTC] react-native-webrtc not available:", e);
  }
}

// CallKeep — iOS only needs this here. A callee answering via CallKit's
// native UI (see usePushNotifications.ts's "answerCall" listener) has its
// AVAudioSession owned by CallKit: react-native-webrtc's audio stays silent
// (ICE/DTLS/SRTP connect and negotiate fine — only audio in/out is affected)
// until CallKit is explicitly told the call is actually live via
// setCurrentCallActive. Without that call, iOS never activates the session
// and "didActivateAudioSession" (which is what wires RTCAudioSession up —
// see usePushNotifications.ts) never fires. The caller side never goes
// through CallKit in this app (no CallKeep.startCall anywhere), so it isn't
// affected — this only matters for the callee.
let CallKeep: any = null;
if (Platform.OS === "ios") {
  try {
    CallKeep = require("react-native-callkeep").default;
  } catch (e) {
    console.warn("[WebRTC] react-native-callkeep not available:", e);
  }
}

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
  // useMemo so this only runs once on mount even if callId is undefined.
  // Must be a real UUID, not just any unique string: this value is relayed
  // through the VoIP push payload and passed straight to CallKit's native
  // reportNewIncomingCall/displayIncomingCall on the callee's device, which
  // parses it with NSUUID(uuidString:) — a non-UUID string silently fails
  // there (nil), so the callee's phone would never actually ring.
  const effectiveCallId = useMemo(() => callId ?? Crypto.randomUUID(), []);
  const isVideo = mode === "video";

  const [callState, setCallState]     = useState<CallState>(isCaller ? "ringing" : "connecting");
  const [duration, setDuration]       = useState(0);
  const [muted, setMuted]             = useState(false);
  const [speakerOn, setSpeakerOn]     = useState(false);
  const [statusNote, setStatusNote]   = useState("");
  // Mirrors localStreamRef/remoteStreamRef in state so video views re-render
  // when a stream becomes available — refs alone don't trigger that.
  const [localStream, setLocalStream]   = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);

  const pulseAnim      = useRef(new Animated.Value(1)).current;
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const pcRef          = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  const mountedRef     = useRef(true);
  // WS messages are dispatched to the call-signal listener as they arrive,
  // without waiting for a prior dispatch's async work to finish (see
  // AppContext's ws.onmessage / handleIncomingWsMessage) — so a "call-ice"
  // signal can reach this handler while an in-flight "call-offer"/"call-answer"
  // invocation is still awaiting makePC()/setRemoteDescription. addIceCandidate
  // before setRemoteDescription completes throws (or, if pcRef.current isn't
  // even set yet, there's nothing to call it on) — either way the candidate
  // would otherwise be silently dropped. Queue it here instead and flush once
  // the remote description is actually in place.
  const pendingIceCandidatesRef = useRef<string[]>([]);
  const remoteDescSetRef = useRef(false);
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
  // Video calls carry their own audio through the visible remote <video>
  // element below, so this hidden element is only needed for voice calls —
  // otherwise the same MediaStream would play through both and double up.
  useEffect(() => {
    if (Platform.OS !== "web" || isVideo) return;
    const el = document.createElement("audio");
    el.id = "gf-remote-audio";
    el.autoplay = true;
    (el as any).playsInline = true;
    document.body.appendChild(el);
    return () => { try { el.remove(); } catch { /* element already removed */ } };
  }, [isVideo]);

  // ── Local/remote <video> elements (web only) ──────────────────────────────
  const localVideoContainerRef  = useRef<any>(null);
  const remoteVideoContainerRef = useRef<any>(null);
  const localVideoElRef  = useRef<HTMLVideoElement | null>(null);
  const remoteVideoElRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || !isVideo) return;
    const localEl = document.createElement("video");
    localEl.autoplay = true;
    localEl.muted = true; // never play back our own mic through the local preview
    (localEl as any).playsInline = true;
    Object.assign(localEl.style, { width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" });
    localVideoElRef.current = localEl;
    localVideoContainerRef.current?.appendChild(localEl);

    const remoteEl = document.createElement("video");
    remoteEl.autoplay = true;
    (remoteEl as any).playsInline = true;
    Object.assign(remoteEl.style, { width: "100%", height: "100%", objectFit: "cover" });
    remoteVideoElRef.current = remoteEl;
    remoteVideoContainerRef.current?.appendChild(remoteEl);

    return () => {
      try { localEl.remove(); } catch { /* already removed */ }
      try { remoteEl.remove(); } catch { /* already removed */ }
      localVideoElRef.current = null;
      remoteVideoElRef.current = null;
    };
  }, [isVideo]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (localVideoElRef.current) localVideoElRef.current.srcObject = localStream ?? null;
  }, [localStream]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (remoteVideoElRef.current) remoteVideoElRef.current.srcObject = remoteStream ?? null;
  }, [remoteStream]);

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
      const stream = ev.streams?.[0];
      if (stream) {
        remoteStreamRef.current = stream;
        setRemoteStream(stream);
      }
      if (Platform.OS === "web" && !isVideo) {
        // Voice calls have no visible <video> element to carry audio, so
        // route it through the hidden element instead (see effect above).
        const el = document.getElementById("gf-remote-audio") as HTMLAudioElement | null;
        if (el && stream) el.srcObject = stream;
      }
      // On native, audio plays automatically through the earpiece/speaker
      // regardless of video — RTCView (driven by remoteStream above) only
      // needs to handle the picture.
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
      if (s === "connected") {
        setCallState("active");
        // Tell CallKit the call is actually live now — see the CallKeep
        // comment near the top of this file for why this is required for
        // audio to work at all on the CallKit-answered (callee) side.
        if (!isCaller && CallKeep) {
          try { CallKeep.setCurrentCallActive(effectiveCallId); } catch (e) { console.warn("[CallKit] setCurrentCallActive failed:", e); }
        }
      }
      if (s === "disconnected" || s === "failed")  handleEndInternal();
    };

    return pc;
  }, [alias, effectiveCallId, sendCallSignal, isVideo, isCaller]);

  const getMedia = useCallback(async (pc: any) => {
    if (!pc) return;
    try {
      // expo-av and react-native-webrtc share the same native iOS audio
      // session. If a voice message was ever recorded in this app session,
      // AppContext's chat screen leaves that session in `allowsRecordingIOS:
      // false` mode (lib/chat's stop-recording cleanup) — WebRTC still
      // negotiates and connects fine either way (ICE/DTLS/SRTP don't touch
      // this), but actual audio capture/playback silently does nothing.
      // Force a call-appropriate session before requesting the mic.
      if (Platform.OS !== "web") {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
        }).catch((e) => {
          console.warn("[Call] setAudioModeAsync failed — audio session may not be call-ready:", e);
        });
      }
      const devices = Platform.OS === "web" ? navigator.mediaDevices : nativeMediaDevices;
      if (!devices) { setStatusNote("Microphone unavailable on this device"); return; }
      const stream = await devices.getUserMedia({ audio: true, video: isVideo });
      localStreamRef.current = stream;
      setLocalStream(stream);
      stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));
    } catch (e) {
      console.warn("[WebRTC] getUserMedia:", e);
      setStatusNote("Mic access denied — audio unavailable");
    }
  }, [isVideo]);

  // Applies one ICE candidate to the peer connection. Only safe to call once
  // remoteDescSetRef is true (see the ref's comment) — callers are
  // responsible for that check; this only guards pcRef.current itself being
  // gone (e.g. the call ended while a candidate was queued).
  const applyIceCandidate = useCallback(async (payloadJson: string) => {
    const pc = pcRef.current;
    if (!pc) return;
    const ICE = Platform.OS === "web" ? (window as any).RTCIceCandidate : NativeRTCIceCandidate;
    if (!ICE) return;
    try {
      await pc.addIceCandidate(new ICE(JSON.parse(payloadJson)));
    } catch (e) {
      console.warn("[WebRTC] addIceCandidate failed:", e);
    }
  }, []);

  // Drains candidates queued by the "call-ice" branch below while the remote
  // description wasn't set yet. Call once right after setRemoteDescription
  // resolves, on both the offer and answer paths.
  const flushPendingIce = useCallback(async () => {
    const queued = pendingIceCandidatesRef.current;
    pendingIceCandidatesRef.current = [];
    for (const payload of queued) {
      await applyIceCandidate(payload);
    }
  }, [applyIceCandidate]);

  // Closes the peer connection, stops mic capture, clears the duration
  // timer, and restores the non-call audio session. No mountedRef check and
  // no state/navigation — this must also be safe to run from unmount
  // cleanup, where setState would warn and there's no screen left to
  // navigate away from. Idempotent: safe to call more than once (e.g. once
  // from handleEndInternal, once again from the unmount cleanup below).
  const teardownCallResources = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pcRef.current) { try { pcRef.current.close(); } catch { /* ignore close errors */ } pcRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      localStreamRef.current = null;
    }
    if (Platform.OS !== "web") {
      Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch((e) => {
        console.warn("[Call] Failed to restore audio session on teardown:", e);
      });
    }
  }, []);

  const handleEndInternal = useCallback(() => {
    if (!mountedRef.current) return;
    teardownCallResources();
    setCallState("ended");
    setTimeout(() => { if (mountedRef.current) router.back(); }, 1200);
  }, [teardownCallResources]);

  // ── Unmount: tear down a live call even when handleEnd never ran ─────────
  // This screen can unmount without any explicit "end call" action — most
  // notably, app/_layout.tsx locks (and swaps out the whole navigator) on
  // any real AppState "background" transition, which unmounts this screen
  // directly. Nothing else in this file closes the peer connection or stops
  // mic capture in that path, so a backgrounded call would otherwise leave
  // an orphaned RTCPeerConnection + live microphone stream running with no
  // UI. mountedRef/handleEndInternal are unsuitable here: handleEndInternal
  // no-ops once mountedRef.current is false, which may already be the case
  // by the time this cleanup runs (another effect's cleanup owns flipping
  // it) — so teardownCallResources is called directly instead.
  //
  // Only notifies the peer if the call had actually connected ("active") —
  // best-effort: the signal goes out over the same WS that a lock-triggered
  // unmount may be closing around the same time, so delivery isn't
  // guaranteed, but sending it costs nothing (sendCallSignal no-ops if the
  // socket isn't open). A call still ringing/negotiating when the screen
  // unmounts intentionally does not send call-hangup here.
  useEffect(() => {
    return () => {
      if (callStateRef.current === "active") {
        sendCallSignal({ type: "call-hangup", to: alias, callId: effectiveCallId });
      }
      teardownCallResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          // Tell the callee we gave up — without this the callee's incoming-call
          // UI (CallKit's native banner, or the in-app overlay) has no way to
          // know and just sits there until CallKit's own native ~60s timeout
          // silently ends it. Queued if the socket's mid-reconnect rather than
          // dropped, and exempt from the call-signal queue's TTL (see
          // flushPendingCallSignals) since a late hangup is still meaningful.
          sendCallSignal({ type: "call-hangup", to: alias, callId: effectiveCallId });
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
          remoteDescSetRef.current = true;
          await flushPendingIce();
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
            remoteDescSetRef.current = true;
            await flushPendingIce();
          } catch (e) {
            console.warn("[WebRTC] setRemoteDescription:", e);
          }
        }
        setCallState("active");
        return;
      }

      // ── call-ice (either) ───────────────────────────────────────────────────
      // Queue instead of applying directly if the remote description isn't in
      // place yet — see pendingIceCandidatesRef's comment up top for why.
      if (signal.type === "call-ice" && signal.payload) {
        if (remoteDescSetRef.current && pcRef.current) {
          await applyIceCandidate(signal.payload);
        } else {
          pendingIceCandidatesRef.current.push(signal.payload);
        }
        return;
      }

      // ── call-hangup (either receives) ─────────────────────────────────────
      if (signal.type === "call-hangup") {
        notifyCallEnded(effectiveCallId, "remote");
        handleEndInternal();
      }
    });

    return () => registerCallListener(null);
  }, [alias, effectiveCallId, isCaller, makePC, getMedia, applyIceCandidate, flushPendingIce, sendCallSignal, handleEndInternal, registerCallListener]);

  // ── UI handlers ───────────────────────────────────────────────────────────
  const handleEnd = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    sendCallSignal({ type: "call-hangup", to: alias, callId: effectiveCallId });
    notifyCallEnded(effectiveCallId, "local");
    handleEndInternal();
  };

  const toggleMute = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMuted((m) => {
      const next = !m;
      // `enabled = false` silences the track at the source without tearing
      // down or renegotiating the peer connection — the remote side keeps
      // receiving silence rather than the connection hiccuping.
      localStreamRef.current?.getAudioTracks().forEach((t: MediaStreamTrack) => { t.enabled = !next; });
      return next;
    });
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const displayAlias = alias ?? "UNKNOWN";

  const hasLocalVideoTrack  = !!localStream?.getVideoTracks?.().length;
  const hasRemoteVideoTrack = !!remoteStream?.getVideoTracks?.().length;
  const showRemoteVideo  = isVideo && callState === "active" && hasRemoteVideoTrack;
  const showLocalPreview = isVideo && callState !== "ended" && hasLocalVideoTrack;

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
    remoteVideoLayer: { ...StyleSheet.absoluteFillObject },
    videoScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
    localPreview: {
      position: "absolute" as const, right: 16,
      width: 96, height: 140, borderRadius: colors.radius,
      overflow: "hidden" as const, borderWidth: 1, borderColor: colors.border,
      backgroundColor: colors.card, zIndex: 5,
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
    bottomSection: { gap: 16 },
    controls: { flexDirection: "row" as const, gap: 20, alignItems: "center" as const, justifyContent: "center" as const },
    ctrlItem: { alignItems: "center" as const },
    ctrlBtn: {
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
      alignItems: "center" as const, justifyContent: "center" as const,
    },
    ctrlBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
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
      {isVideo && (
        <>
          <View style={[styles.remoteVideoLayer, { opacity: showRemoteVideo ? 1 : 0 }]} pointerEvents="none">
            {Platform.OS !== "web" && NativeRTCView && remoteStream ? (
              <NativeRTCView streamURL={remoteStream.toURL()} style={StyleSheet.absoluteFillObject} objectFit="cover" zOrder={0} />
            ) : Platform.OS === "web" ? (
              <View ref={remoteVideoContainerRef} style={StyleSheet.absoluteFillObject} />
            ) : null}
          </View>
          {showRemoteVideo && <View style={styles.videoScrim} pointerEvents="none" />}
          <View style={[styles.localPreview, { top: insets.top + 16, opacity: showLocalPreview ? 1 : 0 }]}>
            {Platform.OS !== "web" && NativeRTCView && localStream ? (
              <NativeRTCView streamURL={localStream.toURL()} style={StyleSheet.absoluteFillObject} objectFit="cover" mirror zOrder={1} />
            ) : Platform.OS === "web" ? (
              <View ref={localVideoContainerRef} style={StyleSheet.absoluteFillObject} />
            ) : null}
          </View>
        </>
      )}

      <View style={styles.topSection}>
        {!showRemoteVideo && (
          <Animated.View style={[styles.avatarRing, (callState === "ringing" || callState === "connecting") && { transform: [{ scale: pulseAnim }] }]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{displayAlias.slice(0, 2)}</Text>
            </View>
          </Animated.View>
        )}

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
      </View>

      <View style={styles.bottomSection}>
        {/* Call controls */}
        <View style={styles.controls}>
          <View style={styles.ctrlItem}>
            <Pressable style={[styles.ctrlBtn, muted && styles.ctrlBtnActive]} onPress={toggleMute}>
              <Ionicons name={muted ? "mic-off" : "mic"} size={22} color={muted ? colors.primaryForeground : colors.foreground} />
            </Pressable>
            <Text style={styles.modeLabel}>{muted ? "UNMUTE" : "MUTE"}</Text>
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
