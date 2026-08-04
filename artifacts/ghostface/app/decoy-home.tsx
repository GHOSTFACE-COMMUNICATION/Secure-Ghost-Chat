import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable } from "react-native";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import GhostpadScreen from "@/app/ghostpad";

/**
 * Rendered in place of the real tab navigator when the decoy PIN was used
 * to unlock. Deliberately self-contained: it never imports or mounts the
 * real (tabs) screens, so conversation/wallet/VPN state can't be reached
 * from here even by accident.
 *
 * This is just GhostpadScreen in its normal idle state — no fake UI needed.
 * An empty, unpaired Ghostpad already looks exactly like a boring notes app,
 * and it's a real, working feature rather than dressing.
 */
export default function DecoyHomeScreen() {
  const colors = useColors();
  const { setLocked } = useApp();

  return (
    <GhostpadScreen
      embedded
      headerRight={
        <Pressable onPress={() => setLocked(true)} hitSlop={12}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.mutedForeground} />
        </Pressable>
      }
    />
  );
}
