import colors from "@/constants/colors";
import { useApp } from "@/context/AppContext";

type Palette = typeof colors.light;

// Manual in-app preference (Settings > THEME), not the OS's system
// dark-mode setting — this app defaults to dark regardless of device
// theme, and only switches on an explicit user choice.
export function useColors(): Palette & { radius: number } {
  const { themePreference } = useApp();
  const palette: Palette = themePreference === "light" ? colors.light : colors.dark;
  return { ...palette, radius: colors.radius };
}
