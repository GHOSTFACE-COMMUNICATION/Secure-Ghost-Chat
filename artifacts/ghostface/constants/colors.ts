const colors = {
  dark: {
    text: "#FFFFFF",
    tint: "#F5D26B",

    background: "#000000",
    foreground: "#FFFFFF",

    card: "#0A0A0A",
    cardForeground: "#FFFFFF",

    primary: "#F5D26B",
    primaryForeground: "#000000",

    secondary: "#0F0F0F",
    secondaryForeground: "#FFFFFF",

    muted: "#161616",
    mutedForeground: "#6B6B6B",

    accent: "#F5D26B",
    accentForeground: "#000000",

    destructive: "#FF3B30",
    destructiveForeground: "#FFFFFF",

    border: "#1C1C1C",
    input: "#0F0F0F",

    success: "#7dd3fc",
    warning: "#F5D26B",
    ghost: "#FFFFFF",
  },

  // Real light theme — not a duplicate of dark. Gold (primary/accent/tint)
  // and the destructive red stay constant across both themes (brand
  // identity, and both already have solid contrast against either
  // background); success/warning are darkened from dark mode's pastel
  // values since those read as near-invisible on white.
  light: {
    text: "#0A0A0A",
    tint: "#F5D26B",

    background: "#FFFFFF",
    foreground: "#0A0A0A",

    card: "#F7F7F8",
    cardForeground: "#0A0A0A",

    primary: "#F5D26B",
    primaryForeground: "#000000",

    secondary: "#F0F0F0",
    secondaryForeground: "#0A0A0A",

    muted: "#EDEDED",
    mutedForeground: "#6B6B6B",

    accent: "#F5D26B",
    accentForeground: "#000000",

    destructive: "#FF3B30",
    destructiveForeground: "#FFFFFF",

    border: "#E2E2E4",
    input: "#F0F0F0",

    success: "#0891B2",
    warning: "#B45309",
    ghost: "#0A0A0A",
  },

  radius: 6,
};

export default colors;
