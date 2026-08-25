/**
 * Thin typed wrapper around the native VPNTunnelModule
 * (native/vpn-tunnel/VPNTunnelModule.swift), which drives the
 * `networkpackettunnel` extension via NETunnelProviderManager.
 *
 * iOS only — Android has no equivalent module yet. Callers should check
 * isVpnTunnelAvailable() before use rather than assuming iOS.
 */
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

export type VPNTunnelStatus =
  | "invalid"
  | "disconnected"
  | "connecting"
  | "connected"
  | "reasserting"
  | "disconnecting"
  | "unknown";

// Field names/shape must match VPNTunnelModule.swift's VPNTunnelConfig and,
// beneath that, PacketTunnelProvider.swift's providerConfiguration contract.
export interface VPNTunnelConfig {
  privateKey: string;
  serverPublicKey: string;
  endpoint: string; // "host:port"
  tunnelAddress: string; // e.g. "10.66.0.2" or "10.66.0.2/32"
  allowedIPs: string; // comma-separated CIDRs, e.g. "0.0.0.0/0,::/0"
  dns?: string; // comma-separated IPs
  mtu?: number;
  persistentKeepalive?: number;
}

export class VpnTunnelUnavailableError extends Error {
  constructor() {
    super("VPNTunnelModule native module is not available (not iOS, or a dev client rebuild is needed)");
    this.name = "VpnTunnelUnavailableError";
  }
}

interface NativeVpnTunnelModule {
  connect(config: VPNTunnelConfig): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<VPNTunnelStatus>;
  getLastError(): Promise<string | null>;
  getRuntimeConfiguration(): Promise<string | null>;
}

const native = NativeModules.VPNTunnelModule as NativeVpnTunnelModule | undefined;

function requireNative(): NativeVpnTunnelModule {
  if (!native) throw new VpnTunnelUnavailableError();
  return native;
}

export function isVpnTunnelAvailable(): boolean {
  return Platform.OS === "ios" && !!native;
}

/** Installs (or updates) the VPN configuration and starts the tunnel. */
export async function connect(config: VPNTunnelConfig): Promise<void> {
  await requireNative().connect(config);
}

export async function disconnect(): Promise<void> {
  await requireNative().disconnect();
}

export async function getStatus(): Promise<VPNTunnelStatus> {
  return requireNative().getStatus();
}

/** Reason the last start attempt failed, if any — see the extension's App-Group error write. */
export async function getLastError(): Promise<string | null> {
  return requireNative().getLastError();
}

/** wg(8) UAPI-format runtime stats (handshake time, rx/tx bytes), or null if not connected. */
export async function getRuntimeConfiguration(): Promise<string | null> {
  return requireNative().getRuntimeConfiguration();
}

/** Subscribes to NEVPNStatusDidChange. Returns an unsubscribe function. */
export function subscribeToStatusChanges(listener: (status: VPNTunnelStatus) => void): () => void {
  if (!native) return () => {};
  const emitter = new NativeEventEmitter(NativeModules.VPNTunnelModule);
  const subscription = emitter.addListener("VPNTunnelStatusDidChange", (event: { status: VPNTunnelStatus }) => {
    listener(event.status);
  });
  return () => subscription.remove();
}
