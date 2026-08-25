import Foundation
import NetworkExtension
import os
import WireGuardKit

// The containing app supplies the tunnel's WireGuard config via
// NETunnelProviderProtocol.providerConfiguration when it builds the
// NETunnelProviderManager (not yet written — see STATUS.md/TRACKER.md's
// "native bridge module" item). Expected keys, all strings:
//   privateKey         base64, generated on-device, never sent to the server
//   serverPublicKey    base64 -- from api-server's /vpn/:userId/register
//   endpoint           "host:port" -- same
//   tunnelAddress      "10.66.0.x" or "10.66.0.x/32" -- api-server's tunnelIp
//   allowedIPs         comma-separated CIDRs, e.g. "0.0.0.0/0,::/0"
//   dns                comma-separated IPs, optional
//   mtu                optional
//   persistentKeepalive  optional, defaults to 25s (needed for mobile NAT)

private let logger = Logger(subsystem: "com.ghostface.app.tunnel", category: "PacketTunnelProvider")

private let appGroupIdentifier = "group.com.ghostface.app"
private let lastErrorDefaultsKey = "vpnLastTunnelError"

enum TunnelConfigurationError: LocalizedError {
    case missingProviderConfiguration
    case missingField(String)
    case invalidPrivateKey
    case invalidPublicKey
    case invalidEndpoint(String)
    case invalidTunnelAddress(String)
    case invalidAllowedIP(String)
    case invalidDNSServer(String)

    var errorDescription: String? {
        switch self {
        case .missingProviderConfiguration:
            return "No providerConfiguration was supplied by the containing app"
        case .missingField(let field):
            return "providerConfiguration is missing required field \"\(field)\""
        case .invalidPrivateKey:
            return "privateKey is not a valid WireGuard base64 private key"
        case .invalidPublicKey:
            return "serverPublicKey is not a valid WireGuard base64 public key"
        case .invalidEndpoint(let value):
            return "endpoint \"\(value)\" is not a valid host:port"
        case .invalidTunnelAddress(let value):
            return "tunnelAddress \"\(value)\" is not a valid IP address"
        case .invalidAllowedIP(let value):
            return "allowedIPs contains an invalid entry: \"\(value)\""
        case .invalidDNSServer(let value):
            return "dns contains an invalid entry: \"\(value)\""
        }
    }
}

class PacketTunnelProvider: NEPacketTunnelProvider {

    private lazy var adapter: WireGuardAdapter = WireGuardAdapter(with: self) { logLevel, message in
        switch logLevel {
        case .error:
            logger.error("\(message, privacy: .public)")
        case .verbose:
            logger.debug("\(message, privacy: .public)")
        }
    }

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        let tunnelConfiguration: TunnelConfiguration
        do {
            let providerConfiguration = (protocolConfiguration as? NETunnelProviderProtocol)?.providerConfiguration
            tunnelConfiguration = try Self.makeTunnelConfiguration(from: providerConfiguration)
        } catch {
            logger.error("Invalid tunnel configuration: \(error.localizedDescription, privacy: .public)")
            Self.recordLastError(error.localizedDescription)
            completionHandler(error)
            return
        }

        adapter.start(tunnelConfiguration: tunnelConfiguration) { [weak self] adapterError in
            guard let adapterError = adapterError else {
                logger.info("Tunnel interface is \(self?.adapter.interfaceName ?? "unknown", privacy: .public)")
                Self.recordLastError(nil)
                completionHandler(nil)
                return
            }
            logger.error("Failed to start tunnel: \(String(describing: adapterError), privacy: .public)")
            Self.recordLastError(String(describing: adapterError))
            completionHandler(adapterError)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        adapter.stop { error in
            if let error = error {
                logger.error("Failed to stop WireGuard adapter cleanly: \(error.localizedDescription, privacy: .public)")
            }
            completionHandler()
        }
    }

    // The containing app sends a single zero byte to request the current
    // WireGuard runtime stats (handshake time, rx/tx bytes, in wg(8)'s UAPI
    // text format) -- everything else is ignored. Matches the convention the
    // official WireGuard app uses, so any future WireGuardKit upgrade stays
    // compatible.
    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)? = nil) {
        guard let completionHandler = completionHandler else { return }
        guard messageData.count == 1, messageData[0] == 0 else {
            completionHandler(nil)
            return
        }
        adapter.getRuntimeConfiguration { settings in
            completionHandler(settings?.data(using: .utf8))
        }
    }
}

private extension PacketTunnelProvider {
    // NEVPNConnection exposes only coarse status (connected/disconnected) to
    // the containing app, not *why* a start attempt failed -- there's no
    // completion-handler error visible outside the extension process. Stash
    // the last failure in the shared App Group container so the not-yet-built
    // native bridge module has something to surface to the user beyond
    // "disconnected". Cleared on a successful start.
    static func recordLastError(_ message: String?) {
        let defaults = UserDefaults(suiteName: appGroupIdentifier)
        if let message = message {
            defaults?.set(message, forKey: lastErrorDefaultsKey)
        } else {
            defaults?.removeObject(forKey: lastErrorDefaultsKey)
        }
    }

    static func makeTunnelConfiguration(from providerConfiguration: [String: Any]?) throws -> TunnelConfiguration {
        guard let config = providerConfiguration else {
            throw TunnelConfigurationError.missingProviderConfiguration
        }

        func requiredString(_ key: String) throws -> String {
            guard let value = config[key] as? String, !value.isEmpty else {
                throw TunnelConfigurationError.missingField(key)
            }
            return value
        }

        guard let privateKey = PrivateKey(base64Key: try requiredString("privateKey")) else {
            throw TunnelConfigurationError.invalidPrivateKey
        }
        guard let serverPublicKey = PublicKey(base64Key: try requiredString("serverPublicKey")) else {
            throw TunnelConfigurationError.invalidPublicKey
        }
        let endpointString = try requiredString("endpoint")
        guard let endpoint = Endpoint(from: endpointString) else {
            throw TunnelConfigurationError.invalidEndpoint(endpointString)
        }
        let tunnelAddressString = try requiredString("tunnelAddress")
        guard let tunnelAddress = IPAddressRange(from: tunnelAddressString) else {
            throw TunnelConfigurationError.invalidTunnelAddress(tunnelAddressString)
        }

        var interface = InterfaceConfiguration(privateKey: privateKey)
        interface.addresses = [tunnelAddress]
        if let mtu = (config["mtu"] as? NSNumber)?.uint16Value ?? (config["mtu"] as? String).flatMap(UInt16.init) {
            interface.mtu = mtu
        }
        interface.dns = try splitList(config["dns"] as? String).map { value in
            guard let server = DNSServer(from: value) else {
                throw TunnelConfigurationError.invalidDNSServer(value)
            }
            return server
        }

        let allowedIPsString = try requiredString("allowedIPs")
        let allowedIPs = try splitList(allowedIPsString).map { value -> IPAddressRange in
            guard let range = IPAddressRange(from: value) else {
                throw TunnelConfigurationError.invalidAllowedIP(value)
            }
            return range
        }

        var peer = PeerConfiguration(publicKey: serverPublicKey)
        peer.endpoint = endpoint
        peer.allowedIPs = allowedIPs
        peer.persistentKeepAlive = (config["persistentKeepalive"] as? NSNumber)?.uint16Value
            ?? (config["persistentKeepalive"] as? String).flatMap(UInt16.init)
            ?? 25 // Keeps the NAT mapping alive on mobile networks between handshakes.

        return TunnelConfiguration(name: "GHOSTFACE", interface: interface, peers: [peer])
    }

    static func splitList(_ value: String?) -> [String] {
        (value ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }
}
