// Layers over app.json (Expo merges the static config in as `config`).
//
// Why this file exists: the VPN is cut from the 1.0.2 production artifact.
// Not because the entitlements are stray — there is a real
// `networkpackettunnel` target with ~440 lines of Swift behind them — but
// because App Store distribution of a `packet-tunnel-provider` additionally
// requires Apple's formal Network Extension entitlement request, which has
// not been submitted (see targets/network-packet-tunnel/expo-target.config.js).
// Until that clears, a production build can sign but cannot ship the feature.
//
// Everything below is scoped to EAS_BUILD_PROFILE === "production", the same
// conditional plugins/withVoipPushKit.js uses for aps-environment. Local
// builds, `development`, `development:device` and `preview` are untouched and
// keep the full VPN.
module.exports = ({ config }) => {
  const isProduction = process.env.EAS_BUILD_PROFILE === "production";

  // Surfaced to JS via expo-constants so the UI hides on exactly the same
  // condition that strips the native side — one source of truth, no second
  // flag to drift out of sync. See lib/features.ts.
  config.extra = { ...(config.extra || {}), vpnEnabled: !isProduction };

  if (!isProduction) return config;

  // 1. Drop the container app's VPN entitlements. Both are what the build
  //    fails on: the App Store profile carries neither.
  const ent = (config.ios && config.ios.entitlements) || {};
  delete ent["com.apple.developer.networking.networkextension"];
  delete ent["com.apple.developer.networking.vpn.api"];

  // 2. Drop @bacons/apple-targets so targets/network-packet-tunnel is never
  //    generated. Leaving the extension in place while removing the
  //    container's entitlement risks App Store validation rejecting a
  //    container that embeds a packet-tunnel provider it is not entitled to
  //    host — so the target goes too, not just the keys.
  config.plugins = (config.plugins || []).filter(
    (p) => (Array.isArray(p) ? p[0] : p) !== "@bacons/apple-targets",
  );

  return config;
};
