/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "network-packet-tunnel",
  // -> com.ghostface.app.tunnel, matching the App ID registered in the
  // Apple Developer portal for this extension (see STATUS.md / session
  // history — Network Extensions + Personal VPN capabilities enabled there).
  bundleIdentifier: ".tunnel",
  deploymentTarget: "16.0",
  entitlements: {
    // Shared with the main app (see app.json ios.entitlements) so the
    // extension and the app can pass the tunnel config back and forth via
    // a shared UserDefaults suite instead of IPC.
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
    // Grants the actual NEPacketTunnelProvider capability used to
    // implement a custom VPN client (WireGuard) — see
    // .agents/skills/apple-targets/network-packet-tunnel.md for the full
    // reference. Requires the Personal VPN capability enabled on this
    // target's App ID; Apple additionally requires a separate formal
    // Network Extension entitlement request
    // (https://developer.apple.com/contact/request/network-extension/)
    // for App Store distribution — not yet submitted as of this commit.
    "com.apple.developer.networking.networkextension": ["packet-tunnel-provider"],
  },
});