import { Ionicons } from "@expo/vector-icons";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { managedNonce } from "@noble/ciphers/utils.js";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { GoldGradient } from "@/components/GoldGradient";
import { deriveKeyFromPin, generateSalt } from "@/lib/crypto";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
  }
  return out;
}

function base64ToBytes(str: string): Uint8Array {
  const s = str.replace(/=+$/, "");
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const a = B64.indexOf(s[i] ?? ""), b = B64.indexOf(s[i + 1] ?? "");
    const c = s[i + 2] ? B64.indexOf(s[i + 2]) : -1;
    const d = s[i + 3] ? B64.indexOf(s[i + 3]) : -1;
    out.push((a << 2) | (b >> 4));
    if (c >= 0) out.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) out.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(out);
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrs) { out.set(a, offset); offset += a.length; }
  return out;
}

/** ChaCha20-Poly1305 AEAD, key derived via PBKDF2-SHA256 (600k iterations) — same construction the app uses for PIN-derived keys. */
function ghostEncrypt(plaintext: string, passphrase: string): string {
  const salt = generateSalt();
  const key = deriveKeyFromPin(passphrase || "GHOSTFACE", salt);
  const chacha = managedNonce(chacha20poly1305);
  const ciphertext = chacha(key).encrypt(new TextEncoder().encode(plaintext));
  return "GHX2::" + bytesToBase64(concatBytes(salt, ciphertext));
}

function ghostDecrypt(payload: string, passphrase: string): string | null {
  if (!payload.startsWith("GHX2::")) return null;
  try {
    const combined = base64ToBytes(payload.slice(6));
    const salt = combined.slice(0, 32);
    const ciphertext = combined.slice(32);
    const key = deriveKeyFromPin(passphrase || "GHOSTFACE", salt);
    const chacha = managedNonce(chacha20poly1305);
    return new TextDecoder().decode(chacha(key).decrypt(ciphertext));
  } catch {
    return null;
  }
}

/** Zero-width character steganography — hides a string (here, always ciphertext) inside an innocent-looking word. */
function stealthEncode(payload: string): string {
  const bits = Array.from(payload).map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join("");
  return "GHOSTFACE" + bits.split("").map((b) => (b === "0" ? "​" : "‌")).join("");
}

function stealthDecode(carrier: string): string | null {
  const bits = Array.from(carrier).filter((c) => c === "​" || c === "‌")
    .map((c) => (c === "​" ? "0" : "1")).join("");
  let out = "";
  for (let i = 0; i < bits.length; i += 8) {
    const byte = bits.slice(i, i + 8);
    if (byte.length === 8) out += String.fromCharCode(parseInt(byte, 2));
  }
  return out || null;
}

const MONO = Platform.OS === "ios" ? "Courier" : "monospace";

export default function EncryptionTools() {
  const colors = useColors();

  const [stealthMsg, setStealthMsg] = useState("");
  const [stealthKey, setStealthKey] = useState("");
  const [stealthCarrier, setStealthCarrier] = useState("");
  const [stealthOut, setStealthOut] = useState("");
  const [stealthError, setStealthError] = useState("");
  const [stealthMode, setStealthMode] = useState<"hide" | "reveal">("hide");
  const [stealthCopied, setStealthCopied] = useState(false);

  const copy = async (text: string, done: (v: boolean) => void) => {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    done(true);
    setTimeout(() => done(false), 1500);
  };

  const s = StyleSheet.create({
    body: { padding: 16, gap: 14 },
    lbl: { color: colors.mutedForeground, fontSize: 10, letterSpacing: 3, fontWeight: "700" },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      color: colors.foreground,
      fontSize: 13,
      padding: 12,
      fontFamily: MONO,
    },
    modeRow: { flexDirection: "row", gap: 8 },
    modeBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: colors.radius, borderWidth: 1 },
    modeTxt: { fontSize: 11, letterSpacing: 2, fontWeight: "700" },
    btn: { borderRadius: colors.radius, overflow: "hidden" },
    btnGold: { borderRadius: colors.radius, paddingVertical: 13, alignItems: "center" },
    btnTxt: { color: "#FFFFFF", fontSize: 12, fontWeight: "800", letterSpacing: 3 },
    out: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius, padding: 12 },
    outTxt: { color: colors.primary, fontSize: 11, fontFamily: MONO },
    copyRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, alignSelf: "flex-end" },
    copyTxt: { fontSize: 10, letterSpacing: 2 },
    info: { flexDirection: "row", gap: 8, backgroundColor: `${colors.primary}12`, borderRadius: colors.radius, padding: 10, borderWidth: 1, borderColor: `${colors.primary}28` },
    infoTxt: { color: colors.mutedForeground, fontSize: 11, flex: 1, lineHeight: 16 },
  });

  const renderCopy = (text: string, copied: boolean, done: (v: boolean) => void) => (
    <Pressable style={s.copyRow} onPress={() => copy(text, done)}>
      <Ionicons name={copied ? "checkmark" : "copy-outline"} size={13} color={colors.foreground} />
      <Text style={[s.copyTxt, { color: colors.foreground }]}>{copied ? "COPIED" : "COPY"}</Text>
    </Pressable>
  );

  const runHide = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStealthError("");
    const ciphertext = ghostEncrypt(stealthMsg, stealthKey);
    setStealthOut(stealthEncode(ciphertext));
  };

  const runReveal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const hidden = stealthDecode(stealthCarrier);
    if (!hidden) {
      setStealthOut("");
      setStealthError("NO HIDDEN MESSAGE FOUND");
      return;
    }
    const plaintext = ghostDecrypt(hidden, stealthKey);
    if (plaintext === null) {
      setStealthOut("");
      setStealthError("DECRYPTION FAILED — wrong key or corrupted data");
      return;
    }
    setStealthError("");
    setStealthOut(plaintext);
  };

  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={s.body}>
        <View style={s.info}>
          <Ionicons name="information-circle-outline" size={13} color={colors.primary} />
          <Text style={s.infoTxt}>
            ChaCha20-Poly1305 AEAD (key via PBKDF2-SHA256, 600k iterations), then hidden inside an
            innocent-looking word with zero-width character steganography. A passive scan finds
            nothing to read — and even if the hidden bits are extracted, it's still ciphertext
            without the key.
          </Text>
        </View>

        <Text style={s.lbl}>MODE</Text>
        <View style={s.modeRow}>
          {(["hide", "reveal"] as const).map((m) => (
            <Pressable
              key={m}
              style={[s.modeBtn, { borderColor: stealthMode === m ? colors.primary : colors.border, overflow: "hidden" }]}
              onPress={() => { setStealthMode(m); setStealthOut(""); setStealthError(""); }}
            >
              {stealthMode === m && <GoldGradient style={StyleSheet.absoluteFill} />}
              <Text style={[s.modeTxt, { color: stealthMode === m ? "#FFFFFF" : colors.mutedForeground }]}>
                {m === "hide" ? "HIDE MESSAGE" : "REVEAL MESSAGE"}
              </Text>
            </Pressable>
          ))}
        </View>

        {stealthMode === "hide" ? (
          <>
            <Text style={s.lbl}>SECRET MESSAGE</Text>
            <TextInput
              style={s.input} value={stealthMsg} onChangeText={setStealthMsg}
              placeholder="Message to hide..." placeholderTextColor={colors.mutedForeground} autoCorrect={false}
            />
            <Text style={s.lbl}>SECRET KEY (OPTIONAL)</Text>
            <TextInput
              style={s.input} value={stealthKey} onChangeText={setStealthKey}
              placeholder="Blank = default key" placeholderTextColor={colors.mutedForeground} autoCorrect={false}
            />
            <Pressable
              style={[s.btn, !stealthMsg && { opacity: 0.38 }]} disabled={!stealthMsg}
              onPress={runHide}
            >
              <GoldGradient style={s.btnGold}>
                <Text style={s.btnTxt}>👻  ENCRYPT &amp; HIDE</Text>
              </GoldGradient>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={s.lbl}>PASTE TEXT TO SCAN</Text>
            <TextInput
              style={[s.input, { minHeight: 72, textAlignVertical: "top" }]}
              value={stealthCarrier} onChangeText={setStealthCarrier}
              placeholder="Paste carrier text to scan..." placeholderTextColor={colors.mutedForeground} multiline autoCorrect={false}
            />
            <Text style={s.lbl}>SECRET KEY (OPTIONAL)</Text>
            <TextInput
              style={s.input} value={stealthKey} onChangeText={setStealthKey}
              placeholder="Blank = default key" placeholderTextColor={colors.mutedForeground} autoCorrect={false}
            />
            <Pressable
              style={[s.btn, !stealthCarrier && { opacity: 0.38 }]} disabled={!stealthCarrier}
              onPress={runReveal}
            >
              <GoldGradient style={s.btnGold}>
                <Text style={s.btnTxt}>🔍  SCAN &amp; DECRYPT</Text>
              </GoldGradient>
            </Pressable>
          </>
        )}

        {!!stealthOut && (
          <View style={s.out}>
            <Text style={[s.lbl, { marginBottom: 6 }]}>{stealthMode === "hide" ? "OUTPUT (copy & send)" : "DECRYPTED MESSAGE"}</Text>
            <Text style={s.outTxt}>{stealthMode === "hide" ? "GHOSTFACE [encrypted data embedded — copy to share]" : stealthOut}</Text>
            {renderCopy(stealthOut, stealthCopied, setStealthCopied)}
          </View>
        )}

        {!!stealthError && (
          <View style={s.out}>
            <Text style={[s.outTxt, { color: colors.destructive }]}>{stealthError}</Text>
          </View>
        )}
      </View>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}
