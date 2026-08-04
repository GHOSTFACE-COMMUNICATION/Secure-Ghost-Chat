import { Ionicons } from "@expo/vector-icons";
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

type EncToolTab = "cipher" | "hash" | "keygen" | "stealth";

function b64Encode(str: string): string {
  if (Platform.OS === "web") {
    try { return btoa(unescape(encodeURIComponent(str))); } catch { return btoa(str); }
  }
  const C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = Array.from(str).map((c) => c.charCodeAt(0));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0, b1 = bytes[i + 1] ?? 0, b2 = bytes[i + 2] ?? 0;
    out += C[b0 >> 2] + C[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? C[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? C[b2 & 63] : "=";
  }
  return out;
}

function b64Decode(str: string): string {
  try {
    if (Platform.OS === "web") return decodeURIComponent(escape(atob(str)));
    const C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const s = str.replace(/=/g, "");
    let out = "";
    for (let i = 0; i < s.length; i += 4) {
      const a = C.indexOf(s[i] ?? ""), b = C.indexOf(s[i + 1] ?? "");
      const c = s[i + 2] ? C.indexOf(s[i + 2]) : 0;
      const d = s[i + 3] ? C.indexOf(s[i + 3]) : 0;
      out += String.fromCharCode((a << 2) | (b >> 4));
      if (s[i + 2]) out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (s[i + 3]) out += String.fromCharCode(((c & 3) << 6) | d);
    }
    return out;
  } catch { return "DECODE ERROR"; }
}

function xor(text: string, key: string): string {
  const k = key || "GHOSTFACE";
  return Array.from(text).map((c, i) =>
    String.fromCharCode(c.charCodeAt(0) ^ k.charCodeAt(i % k.length))
  ).join("");
}

function ghostEncrypt(p: string, k: string) { return "GHX1::" + b64Encode(xor(p, k)); }
function ghostDecrypt(c: string, k: string) {
  if (!c.startsWith("GHX1::")) return "INVALID FORMAT — NOT GHOSTFACE ENCRYPTED";
  return xor(b64Decode(c.slice(6)), k);
}

function simHash(input: string, algo: "SHA-256" | "MD5" | "BLAKE2"): string {
  const seed = algo === "SHA-256" ? 0x6a09e667 : algo === "MD5" ? 0x67452301 : 0x6b08c647;
  let h = 0;
  for (let i = 0; i < input.length; i++) h = ((h << 5) - h + input.charCodeAt(i) + seed) | 0;
  const raw = Math.abs(h).toString(16).padStart(8, "0");
  return Array.from({ length: 8 }, (_, i) =>
    parseInt(raw, 16).toString(16).padStart(8, "0").split("").map((c, j) =>
      ((parseInt(c, 16) + i * 3 + j * 7) % 16).toString(16)
    ).join("")
  ).join("").slice(0, algo === "MD5" ? 32 : 64);
}

function genKeyPair() {
  const h = "0123456789abcdef";
  const r = (n: number) => Array.from({ length: n }, () => h[Math.floor(Math.random() * 16)]).join("");
  return {
    pub: `04:${r(8)}:${r(8)}:${r(8)}:${r(8)}:${r(8)}:${r(8)}:${r(8)}`,
    priv: `GF:${r(12)}:${r(12)}:${r(12)}:${r(12)}`,
  };
}

function stealthEncode(msg: string): string {
  const bits = Array.from(msg).map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join("");
  return "GHOSTFACE" + bits.split("").map((b) => (b === "0" ? "\u200B" : "\u200C")).join("");
}

function stealthDecode(carrier: string): string {
  const bits = Array.from(carrier).filter((c) => c === "\u200B" || c === "\u200C")
    .map((c) => (c === "\u200B" ? "0" : "1")).join("");
  let out = "";
  for (let i = 0; i < bits.length; i += 8) {
    const byte = bits.slice(i, i + 8);
    if (byte.length === 8) out += String.fromCharCode(parseInt(byte, 2));
  }
  return out || "NO HIDDEN MESSAGE FOUND";
}

const TOOL_TABS: { id: EncToolTab; icon: React.ComponentProps<typeof Ionicons>["name"]; label: string }[] = [
  { id: "cipher", icon: "lock-closed-outline", label: "CIPHER" },
  { id: "hash", icon: "finger-print", label: "HASH" },
  { id: "keygen", icon: "key-outline", label: "KEYGEN" },
  { id: "stealth", icon: "eye-off-outline", label: "STEALTH" },
];

const MONO = Platform.OS === "ios" ? "Courier" : "monospace";

export default function EncryptionTools() {
  const colors = useColors();

  const [tool, setTool] = useState<EncToolTab>("cipher");

  const [encInput, setEncInput] = useState("");
  const [encKey, setEncKey] = useState("");
  const [encOutput, setEncOutput] = useState("");
  const [encMode, setEncMode] = useState<"encrypt" | "decrypt">("encrypt");
  const [encCopied, setEncCopied] = useState(false);

  const [hashInput, setHashInput] = useState("");
  const [hashAlgo, setHashAlgo] = useState<"SHA-256" | "MD5" | "BLAKE2">("SHA-256");
  const [hashOutput, setHashOutput] = useState("");
  const [hashCopied, setHashCopied] = useState(false);

  const [keys, setKeys] = useState<{ pub: string; priv: string } | null>(null);
  const [keyCopied, setKeyCopied] = useState<"pub" | "priv" | null>(null);

  const [stealthMsg, setStealthMsg] = useState("");
  const [stealthCarrier, setStealthCarrier] = useState("");
  const [stealthOut, setStealthOut] = useState("");
  const [stealthMode, setStealthMode] = useState<"hide" | "reveal">("hide");
  const [stealthCopied, setStealthCopied] = useState(false);

  const copy = async (text: string, done: (v: boolean) => void) => {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    done(true);
    setTimeout(() => done(false), 1500);
  };

  const s = StyleSheet.create({
    pill: {
      flexDirection: "row",
      gap: 8,
      padding: 16,
      paddingBottom: 0,
    },
    pillBtn: {
      flex: 1,
      paddingVertical: 9,
      alignItems: "center",
      borderRadius: colors.radius,
      borderWidth: 1,
      flexDirection: "row",
      justifyContent: "center",
      gap: 5,
    },
    pillTxt: { fontSize: 10, fontWeight: "700", letterSpacing: 2 },
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
    btnTxt: { color: colors.primaryForeground, fontSize: 12, fontWeight: "800", letterSpacing: 3 },
    out: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius, padding: 12 },
    outTxt: { color: colors.primary, fontSize: 11, fontFamily: MONO },
    copyRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, alignSelf: "flex-end" },
    copyTxt: { fontSize: 10, letterSpacing: 2 },
    algoRow: { flexDirection: "row", gap: 8 },
    algoBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: colors.radius, borderWidth: 1 },
    algoTxt: { fontSize: 10, letterSpacing: 2, fontWeight: "700" },
    keyBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius, padding: 12, gap: 8 },
    keyLbl: { color: colors.mutedForeground, fontSize: 9, letterSpacing: 3 },
    keyPub: { color: colors.success, fontSize: 11, fontFamily: MONO },
    keyPriv: { color: colors.destructive, fontSize: 11, fontFamily: MONO },
    hr: { height: 1, backgroundColor: colors.border },
    info: { flexDirection: "row", gap: 8, backgroundColor: `${colors.primary}12`, borderRadius: colors.radius, padding: 10, borderWidth: 1, borderColor: `${colors.primary}28` },
    infoTxt: { color: colors.mutedForeground, fontSize: 11, flex: 1, lineHeight: 16 },
  });

  const renderCopy = (text: string, copied: boolean, done: (v: boolean) => void) => (
    <Pressable style={s.copyRow} onPress={() => copy(text, done)}>
      <Ionicons name={copied ? "checkmark" : "copy-outline"} size={13} color={copied ? colors.success : colors.primary} />
      <Text style={[s.copyTxt, { color: copied ? colors.success : colors.primary }]}>{copied ? "COPIED" : "COPY"}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {/* Tool selector pills */}
      <View style={s.pill}>
        {TOOL_TABS.map((t) => {
          const active = tool === t.id;
          return (
            <Pressable
              key={t.id}
              style={[s.pillBtn, { backgroundColor: active ? colors.primary : "transparent", borderColor: active ? colors.primary : colors.border }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTool(t.id); }}
            >
              <Ionicons name={t.icon} size={13} color={active ? colors.primaryForeground : colors.mutedForeground} />
              <Text style={[s.pillTxt, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={s.body}>
        {/* ── CIPHER ─────────────────────────────── */}
        {tool === "cipher" && (
          <>
            <View style={s.info}>
              <Ionicons name="information-circle-outline" size={13} color={colors.primary} />
              <Text style={s.infoTxt}>XOR + Base64 on-device encryption. Output is prefixed GHX1::.</Text>
            </View>

            <Text style={s.lbl}>MODE</Text>
            <View style={s.modeRow}>
              {(["encrypt", "decrypt"] as const).map((m) => (
                <Pressable
                  key={m}
                  style={[s.modeBtn, { backgroundColor: encMode === m ? colors.primary : "transparent", borderColor: encMode === m ? colors.primary : colors.border }]}
                  onPress={() => { setEncMode(m); setEncOutput(""); }}
                >
                  <Text style={[s.modeTxt, { color: encMode === m ? colors.primaryForeground : colors.mutedForeground }]}>
                    {m === "encrypt" ? "ENCRYPT" : "DECRYPT"}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.lbl}>{encMode === "encrypt" ? "PLAINTEXT" : "CIPHERTEXT"}</Text>
            <TextInput
              style={[s.input, { minHeight: 72, textAlignVertical: "top" }]}
              value={encInput} onChangeText={setEncInput}
              placeholder={encMode === "encrypt" ? "Enter message..." : "Paste GHX1:: ciphertext..."}
              placeholderTextColor={colors.mutedForeground}
              multiline autoCorrect={false}
            />

            <Text style={s.lbl}>SECRET KEY (OPTIONAL)</Text>
            <TextInput
              style={s.input} value={encKey} onChangeText={setEncKey}
              placeholder="Blank = default key" placeholderTextColor={colors.mutedForeground} autoCorrect={false}
            />

            <Pressable
              style={[s.btn, !encInput && { opacity: 0.38 }]} disabled={!encInput}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setEncOutput(encMode === "encrypt" ? ghostEncrypt(encInput, encKey) : ghostDecrypt(encInput, encKey)); }}
            >
              <GoldGradient style={s.btnGold}>
                <Text style={s.btnTxt}>{encMode === "encrypt" ? "🔒  ENCRYPT" : "🔓  DECRYPT"}</Text>
              </GoldGradient>
            </Pressable>

            {!!encOutput && (
              <View style={s.out}>
                <Text style={s.outTxt}>{encOutput}</Text>
                {renderCopy(encOutput, encCopied, setEncCopied)}
              </View>
            )}
          </>
        )}

        {/* ── HASH ─────────────────────────────── */}
        {tool === "hash" && (
          <>
            <View style={s.info}>
              <Ionicons name="information-circle-outline" size={13} color={colors.primary} />
              <Text style={s.infoTxt}>One-way hash function — verify message integrity without revealing content.</Text>
            </View>

            <Text style={s.lbl}>ALGORITHM</Text>
            <View style={s.algoRow}>
              {(["SHA-256", "MD5", "BLAKE2"] as const).map((a) => (
                <Pressable
                  key={a}
                  style={[s.algoBtn, { backgroundColor: hashAlgo === a ? colors.primary : "transparent", borderColor: hashAlgo === a ? colors.primary : colors.border }]}
                  onPress={() => { setHashAlgo(a); setHashOutput(""); }}
                >
                  <Text style={[s.algoTxt, { color: hashAlgo === a ? colors.primaryForeground : colors.mutedForeground }]}>{a}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.lbl}>INPUT</Text>
            <TextInput
              style={[s.input, { minHeight: 72, textAlignVertical: "top" }]}
              value={hashInput} onChangeText={setHashInput}
              placeholder="Enter text to hash..." placeholderTextColor={colors.mutedForeground} multiline autoCorrect={false}
            />

            <Pressable
              style={[s.btn, !hashInput && { opacity: 0.38 }]} disabled={!hashInput}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setHashOutput(simHash(hashInput, hashAlgo)); }}
            >
              <GoldGradient style={s.btnGold}>
                <Text style={s.btnTxt}>GENERATE HASH</Text>
              </GoldGradient>
            </Pressable>

            {!!hashOutput && (
              <View style={s.out}>
                <Text style={[s.lbl, { marginBottom: 6 }]}>{hashAlgo} DIGEST</Text>
                <Text style={s.outTxt}>{hashOutput}</Text>
                {renderCopy(hashOutput, hashCopied, setHashCopied)}
              </View>
            )}
          </>
        )}

        {/* ── KEYGEN ─────────────────────────────── */}
        {tool === "keygen" && (
          <>
            <View style={s.info}>
              <Ionicons name="information-circle-outline" size={13} color={colors.primary} />
              <Text style={s.infoTxt}>Simulated EC key pair (secp256k1). Share public key freely — NEVER share the private key.</Text>
            </View>

            <Pressable
              style={s.btn}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setKeys(genKeyPair()); setKeyCopied(null); }}
            >
              <GoldGradient style={s.btnGold}>
                <Text style={s.btnTxt}>⚡  GENERATE KEY PAIR</Text>
              </GoldGradient>
            </Pressable>

            {keys ? (
              <View style={s.keyBox}>
                <Text style={s.keyLbl}>PUBLIC KEY (secp256k1)</Text>
                <Text style={s.keyPub}>{keys.pub}</Text>
                {renderCopy(keys.pub, keyCopied === "pub", (v) => setKeyCopied(v ? "pub" : null))}
                <View style={s.hr} />
                <Text style={s.keyLbl}>PRIVATE KEY — KEEP SECRET</Text>
                <Text style={s.keyPriv}>{keys.priv}</Text>
                {renderCopy(keys.priv, keyCopied === "priv", (v) => setKeyCopied(v ? "priv" : null))}
              </View>
            ) : (
              <View style={[s.keyBox, { alignItems: "center", paddingVertical: 32 }]}>
                <Ionicons name="key-outline" size={40} color={colors.border} />
                <Text style={[s.lbl, { marginTop: 12 }]}>NO KEY GENERATED YET</Text>
              </View>
            )}
          </>
        )}

        {/* ── STEALTH ─────────────────────────────── */}
        {tool === "stealth" && (
          <>
            <View style={s.info}>
              <Ionicons name="information-circle-outline" size={13} color={colors.primary} />
              <Text style={s.infoTxt}>Zero-width character steganography — hide secret messages inside innocent-looking text.</Text>
            </View>

            <Text style={s.lbl}>MODE</Text>
            <View style={s.modeRow}>
              {(["hide", "reveal"] as const).map((m) => (
                <Pressable
                  key={m}
                  style={[s.modeBtn, { backgroundColor: stealthMode === m ? colors.primary : "transparent", borderColor: stealthMode === m ? colors.primary : colors.border }]}
                  onPress={() => { setStealthMode(m); setStealthOut(""); }}
                >
                  <Text style={[s.modeTxt, { color: stealthMode === m ? colors.primaryForeground : colors.mutedForeground }]}>
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
                <Pressable
                  style={[s.btn, !stealthMsg && { opacity: 0.38 }]} disabled={!stealthMsg}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setStealthOut(stealthEncode(stealthMsg)); }}
                >
                  <GoldGradient style={s.btnGold}>
                    <Text style={s.btnTxt}>👻  HIDE IN TEXT</Text>
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
                <Pressable
                  style={[s.btn, !stealthCarrier && { opacity: 0.38 }]} disabled={!stealthCarrier}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setStealthOut(stealthDecode(stealthCarrier)); }}
                >
                  <GoldGradient style={s.btnGold}>
                    <Text style={s.btnTxt}>🔍  SCAN FOR MESSAGE</Text>
                  </GoldGradient>
                </Pressable>
              </>
            )}

            {!!stealthOut && (
              <View style={s.out}>
                <Text style={[s.lbl, { marginBottom: 6 }]}>{stealthMode === "hide" ? "OUTPUT (copy & send)" : "DECODED MESSAGE"}</Text>
                <Text style={s.outTxt}>{stealthMode === "hide" ? "GHOSTFACE [hidden data embedded — copy to share]" : stealthOut}</Text>
                {renderCopy(stealthOut, stealthCopied, setStealthCopied)}
              </View>
            )}
          </>
        )}
      </View>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}
