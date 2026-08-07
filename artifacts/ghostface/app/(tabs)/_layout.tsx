import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

// NOTE: Every tab screen added here must wrap its root view in <TabScreenWrapper>
// (see components/TabScreenWrapper.tsx) to get the consistent slide-up transition.

function PulseIcon({
  children,
  focused,
}: {
  children: React.ReactNode;
  focused: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!focused) return;
    scale.setValue(0.85);
    Animated.timing(scale, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [focused]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {children}
    </Animated.View>
  );
}

export default function TabLayout() {
  const colors = useColors();
  const safeAreaInsets = useSafeAreaInsets();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          paddingBottom: safeAreaInsets.bottom,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
        tabBarLabelStyle: {
          fontSize: 10,
          letterSpacing: 1,
          fontWeight: "700",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "HOME",
          tabBarStyle: { display: "none" },
          tabBarIcon: ({ color, focused }) => (
            <PulseIcon focused={focused}>
              <Feather name="home" size={20} color={color} />
            </PulseIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "MESSAGES",
          tabBarIcon: ({ color, focused }) => (
            <PulseIcon focused={focused}>
              <Ionicons name="chatbubble-outline" size={20} color={color} />
            </PulseIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "WALLET",
          tabBarIcon: ({ color, focused }) => (
            <PulseIcon focused={focused}>
              <Ionicons name="wallet-outline" size={20} color={color} />
            </PulseIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="vpn"
        options={{
          title: "VPN",
          tabBarIcon: ({ color, focused }) => (
            <PulseIcon focused={focused}>
              <Ionicons name="shield-outline" size={20} color={color} />
            </PulseIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="ghostpad"
        options={{
          title: "GHOSTPAD",
          tabBarIcon: ({ color, focused }) => (
            <PulseIcon focused={focused}>
              <Ionicons name="document-text-outline" size={20} color={color} />
            </PulseIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="ghostnumber"
        options={{
          title: "NUMBER",
          tabBarIcon: ({ color, focused }) => (
            <PulseIcon focused={focused}>
              <Ionicons name="phone-portrait-outline" size={20} color={color} />
            </PulseIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "SETTINGS",
          tabBarIcon: ({ color, focused }) => (
            <PulseIcon focused={focused}>
              <Ionicons name="settings-outline" size={20} color={color} />
            </PulseIcon>
          ),
        }}
      />
    </Tabs>
  );
}
