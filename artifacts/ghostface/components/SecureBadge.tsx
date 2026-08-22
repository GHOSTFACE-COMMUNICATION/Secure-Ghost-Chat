import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { type } from "@/constants/typography";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type BadgeType = "e2ee" | "vpn" | "no-trace" | "encrypted" | "double-ratchet";

interface SecureBadgeProps {
  type: BadgeType;
  size?: "sm" | "md";
}

export function SecureBadge({ type, size = "sm" }: SecureBadgeProps) {
  const colors = useColors();

  const config: Record<
    BadgeType,
    { label: string; icon: IoniconName; color: string }
  > = {
    e2ee: {
      label: "E2EE",
      icon: "lock-closed",
      color: colors.primary,
    },
    vpn: {
      label: "VPN",
      icon: "shield-checkmark",
      color: colors.success,
    },
    "no-trace": {
      label: "NO TRACE",
      icon: "eye-off",
      color: colors.primary,
    },
    encrypted: {
      label: "ENCRYPTED",
      icon: "key",
      color: colors.success,
    },
    "double-ratchet": {
      label: "DR",
      icon: "refresh-circle",
      color: colors.success,
    },
  };

  const { label, icon, color } = config[type];
  const isSmall = size === "sm";

  return (
    <View
      style={[
        styles.badge,
        {
          borderColor: color,
          paddingHorizontal: isSmall ? 6 : 10,
          paddingVertical: isSmall ? 2 : 4,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={isSmall ? 9 : 12}
        color={color}
        style={{ marginRight: 3 }}
      />
      <Text
        style={[
          styles.label,
          { color, fontSize: isSmall ? 9 : 11 },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
  },
  label: {
    ...type.micro,
  },
});
