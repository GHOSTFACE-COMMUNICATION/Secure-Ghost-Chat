import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { type } from "@/constants/typography";
import { GoldGradient } from "@/components/GoldGradient";
import { ghostDecrypt, ghostEncrypt, stealthDecode, stealthEncode } from "@/lib/stealthCrypto";


export default function EncryptionTools() {
  const colors = useColors();
  const { themePreference } = useApp();
  const isLight = themePreference === "light";

  const [stealthMsg, setStealthMsg] = useState("");
  const [stealthKey, setStealthKey] = useState("");
  const [stealthCarrier, setStealthCarrier] = useState("");
  const [stealthOut, setStealthOut] = useState("");
  const [stealthError, setStealthError] = useState("");
  const [stealthMode, setStealthMode] = useState<"hide" | "reveal">("hide");
  const [stealthCopied, setStealthCopied] = useState(false);
  const [stealthUsedDefaultKey, setStealthUsedDefaultKey] = useState(false);

  const stealthKeyMissing = !stealthKey.trim();

  const copy = async (text: string, done: (v: boolean) => void) => {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    done(true);
    setTimeout(() => done(false), 1500);
  };

  const s = StyleSheet.create({
    body: { padding: 16, gap: 14 },
    lbl: { ...type.micro, color: colors.mutedForeground, fontSize: 10 },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      color: colors.foreground,
      ...type.mono,
      padding: 12,
    },
    modeRow: { flexDirection: "row", gap: 8 },
    modeBtn: { flex: 1, borderRadius: colors.radius, overflow: "hidden" as const },
    modeBtnInner: { paddingVertical: 10, alignItems: "center" as const, borderRadius: colors.radius },
    modeTxt: { ...type.labelStrong },
    btn: { borderRadius: colors.radius, overflow: "hidden" },
    btnGold: { borderRadius: colors.radius, paddingVertical: 13, alignItems: "center" },
    btnTxt: { ...type.labelStrong, color: isLight ? colors.primaryForeground : "#FFFFFF", fontSize: 12 },
    out: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius, padding: 12 },
    outTxt: { ...type.monoSmall, color: colors.primary },
    copyRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, alignSelf: "flex-end" },
    copyTxt: { ...type.micro, fontSize: 10 },
    info: { flexDirection: "row", gap: 8, backgroundColor: `${colors.primary}12`, borderRadius: colors.radius, padding: 10, borderWidth: 1, borderColor: `${colors.primary}28` },
    infoTxt: { ...type.caption, color: colors.mutedForeground, fontSize: 11, flex: 1, lineHeight: 16 },
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
    // Button is disabled while stealthKeyMissing, so this should be
    // unreachable — ghostEncrypt's own throw is the backstop, this catch
    // just keeps a race (or a future caller) from crashing the screen.
    try {
      const ciphertext = ghostEncrypt(stealthMsg, stealthKey);
      setStealthOut(stealthEncode(ciphertext));
    } catch {
      setStealthOut("");
      setStealthError("A passphrase is required to encrypt.");
    }
  };

  const runReveal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStealthUsedDefaultKey(false);
    const hidden = stealthDecode(stealthCarrier);
    if (!hidden) {
      setStealthOut("");
      setStealthError("NO HIDDEN MESSAGE FOUND");
      return;
    }
    const result = ghostDecrypt(hidden, stealthKey);
    if (result === null) {
      setStealthOut("");
      setStealthError("DECRYPTION FAILED — wrong key or corrupted data");
      return;
    }
    setStealthError("");
    setStealthOut(result.plaintext);
    setStealthUsedDefaultKey(result.usedDefaultPassphrase);
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
              style={s.modeBtn}
              onPress={() => { setStealthMode(m); setStealthOut(""); setStealthError(""); setStealthUsedDefaultKey(false); }}
            >
              <GoldGradient
                style={[s.modeBtnInner, stealthMode === m && { borderColor: colors.primary }]}
              >
                <Text style={[s.modeTxt, { color: stealthMode === m ? (isLight ? colors.primaryForeground : "#FFFFFF") : colors.mutedForeground }]}>
                  {m === "hide" ? "HIDE MESSAGE" : "REVEAL MESSAGE"}
                </Text>
              </GoldGradient>
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
            <Text style={s.lbl}>SECRET KEY (REQUIRED)</Text>
            <TextInput
              style={s.input} value={stealthKey} onChangeText={setStealthKey}
              placeholder="Required — choose a passphrase to share with the recipient"
              placeholderTextColor={colors.mutedForeground} autoCorrect={false}
            />
            {!!stealthMsg && stealthKeyMissing && (
              <Text style={[s.infoTxt, { color: colors.destructive }]}>A passphrase is required to encrypt.</Text>
            )}
            <Pressable
              style={[s.btn, (!stealthMsg || stealthKeyMissing) && { opacity: 0.38 }]}
              disabled={!stealthMsg || stealthKeyMissing}
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
            {stealthMode === "reveal" && stealthUsedDefaultKey && (
              <Text style={[s.infoTxt, { color: colors.destructive, marginTop: 6 }]}>
                HIDDEN WITH THE DEFAULT KEY — anyone with this app can reveal it
              </Text>
            )}
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
