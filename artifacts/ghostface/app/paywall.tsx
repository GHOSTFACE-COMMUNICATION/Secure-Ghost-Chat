import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GhostLogo } from "@/components/GhostLogo";
import { useColors } from "@/hooks/useColors";

// Phase 5: RevenueCat paywall — this file is replaced in Phase 5 with the
// full subscription UI (offerings fetch, SPECTER/PHANTOM cards, restore button,
// Terms/Privacy links). Placeholder keeps the /paywall route valid so the
// Settings UPGRADE button and Phase 4 gate prompts don't 404 before Phase 5.
export default function PaywallScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[s.container, { backgroundColor: colors.background, paddingTop: insets.top + 24 }]}>
      <GhostLogo size={52} />
      <Text style={[s.title, { color: colors.foreground }]}>GHOST PLANS</Text>
      <Text style={[s.sub, { color: colors.mutedForeground }]}>SUBSCRIPTION COMING SOON</Text>
      <Pressable onPress={() => router.back()} style={s.back}>
        <Text style={[s.backTxt, { color: colors.mutedForeground }]}>CLOSE</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: 6 },
  sub: { fontSize: 11, letterSpacing: 3 },
  back: { marginTop: 24, paddingVertical: 10, paddingHorizontal: 24 },
  backTxt: { fontSize: 12, letterSpacing: 3 },
});
