import Constants from "expo-constants";

/**
 * Whether the WireGuard VPN ships in this build.
 *
 * Set by app.config.js from the same `EAS_BUILD_PROFILE === "production"`
 * check that strips the container's VPN entitlements and drops the
 * `networkpackettunnel` target — so the UI hides on exactly the condition
 * under which the native side is absent, rather than on a second flag that
 * could drift.
 *
 * Cut from production for 1.0.2 because App Store distribution of a
 * packet-tunnel provider needs Apple's formal Network Extension entitlement
 * request, which has not been submitted. Dev, preview and local builds keep
 * the feature and this stays true.
 *
 * Defaults to false when `extra` is missing, so a build with no config
 * hides the feature rather than showing a control that cannot work.
 */
export const VPN_ENABLED: boolean =
  Constants.expoConfig?.extra?.vpnEnabled === true;
