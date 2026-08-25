import Foundation
import NetworkExtension
import React

// Native bridge letting the main app drive the `networkpackettunnel`
// extension (targets/network-packet-tunnel/PacketTunnelProvider.swift) via
// NETunnelProviderManager. Config keys passed to `connect(_:)` must match
// that file's `providerConfiguration` contract exactly -- see its header
// comment for the full field list.
private let providerBundleIdentifier = "com.ghostface.app.tunnel"
private let appGroupIdentifier = "group.com.ghostface.app"
private let lastErrorDefaultsKey = "vpnLastTunnelError"

private struct VPNTunnelConfig {
    let privateKey: String
    let serverPublicKey: String
    let endpoint: String
    let tunnelAddress: String
    let allowedIPs: String
    let dns: String?
    let mtu: NSNumber?
    let persistentKeepalive: NSNumber?

    init?(dictionary: NSDictionary) {
        guard
            let privateKey = dictionary["privateKey"] as? String,
            let serverPublicKey = dictionary["serverPublicKey"] as? String,
            let endpoint = dictionary["endpoint"] as? String,
            let tunnelAddress = dictionary["tunnelAddress"] as? String,
            let allowedIPs = dictionary["allowedIPs"] as? String
        else { return nil }
        self.privateKey = privateKey
        self.serverPublicKey = serverPublicKey
        self.endpoint = endpoint
        self.tunnelAddress = tunnelAddress
        self.allowedIPs = allowedIPs
        self.dns = dictionary["dns"] as? String
        self.mtu = dictionary["mtu"] as? NSNumber
        self.persistentKeepalive = dictionary["persistentKeepalive"] as? NSNumber
    }

    var providerConfiguration: [String: Any] {
        var config: [String: Any] = [
            "privateKey": privateKey,
            "serverPublicKey": serverPublicKey,
            "endpoint": endpoint,
            "tunnelAddress": tunnelAddress,
            "allowedIPs": allowedIPs,
        ]
        if let dns = dns { config["dns"] = dns }
        if let mtu = mtu { config["mtu"] = mtu }
        if let persistentKeepalive = persistentKeepalive { config["persistentKeepalive"] = persistentKeepalive }
        return config
    }

    // NETunnelProviderProtocol.serverAddress must be non-empty and is shown
    // to the user in Settings > VPN -- use just the host, not "host:port".
    var endpointHost: String {
        String(endpoint.split(separator: ":").first ?? Substring(endpoint))
    }
}

private enum VPNTunnelError: LocalizedError {
    case invalidConfig
    case startFailed(Error)

    var errorDescription: String? {
        switch self {
        case .invalidConfig:
            return "config is missing one of privateKey/serverPublicKey/endpoint/tunnelAddress/allowedIPs"
        case .startFailed(let error):
            return "Failed to start the VPN tunnel: \(error.localizedDescription)"
        }
    }
}

@objc(VPNTunnelModule)
class VPNTunnelModule: RCTEventEmitter {
    private var statusObserver: NSObjectProtocol?

    override static func requiresMainQueueSetup() -> Bool { false }

    override func supportedEvents() -> [String]! {
        ["VPNTunnelStatusDidChange"]
    }

    override func startObserving() {
        statusObserver = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let connection = notification.object as? NEVPNConnection else { return }
            self?.sendEvent(withName: "VPNTunnelStatusDidChange", body: ["status": Self.statusString(connection.status)])
        }
    }

    override func stopObserving() {
        if let observer = statusObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        statusObserver = nil
    }

    @objc(connect:resolver:rejecter:)
    func connect(_ configDict: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let config = VPNTunnelConfig(dictionary: configDict) else {
            let error = VPNTunnelError.invalidConfig
            reject("invalid_config", error.localizedDescription, error)
            return
        }

        Self.loadOrCreateManager { result in
            switch result {
            case .failure(let error):
                reject("load_failed", error.localizedDescription, error)
            case .success(let manager):
                let proto = NETunnelProviderProtocol()
                proto.providerBundleIdentifier = providerBundleIdentifier
                proto.serverAddress = config.endpointHost
                proto.providerConfiguration = config.providerConfiguration
                manager.protocolConfiguration = proto
                manager.localizedDescription = "GHOSTFACE"
                manager.isEnabled = true

                manager.saveToPreferences { saveError in
                    if let saveError = saveError {
                        reject("save_failed", saveError.localizedDescription, saveError)
                        return
                    }
                    // Reload after saving, before starting -- the system can
                    // mutate saved state (e.g. assign identifiers), and
                    // Apple's documented pattern re-loads to pick that up.
                    manager.loadFromPreferences { loadError in
                        if let loadError = loadError {
                            reject("load_failed", loadError.localizedDescription, loadError)
                            return
                        }
                        do {
                            try manager.connection.startVPNTunnel()
                            resolve(nil)
                        } catch {
                            let wrapped = VPNTunnelError.startFailed(error)
                            reject("start_failed", wrapped.localizedDescription, error)
                        }
                    }
                }
            }
        }
    }

    @objc(disconnect:rejecter:)
    func disconnect(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Self.loadExistingManager { manager in
            guard let manager = manager else {
                resolve(nil) // Nothing installed -- already disconnected.
                return
            }
            manager.connection.stopVPNTunnel()
            resolve(nil)
        } onError: { error in
            reject("load_failed", error.localizedDescription, error)
        }
    }

    @objc(getStatus:rejecter:)
    func getStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Self.loadExistingManager { manager in
            resolve(Self.statusString(manager?.connection.status ?? .invalid))
        } onError: { error in
            reject("load_failed", error.localizedDescription, error)
        }
    }

    @objc(getLastError:rejecter:)
    func getLastError(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(UserDefaults(suiteName: appGroupIdentifier)?.string(forKey: lastErrorDefaultsKey))
    }

    // Sends the single-zero-byte "give me runtime stats" message the
    // extension's handleAppMessage expects (wg(8) UAPI text format back) --
    // see PacketTunnelProvider.swift.
    @objc(getRuntimeConfiguration:rejecter:)
    func getRuntimeConfiguration(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Self.loadExistingManager { manager in
            guard
                let manager = manager,
                let session = manager.connection as? NETunnelProviderSession,
                manager.connection.status == .connected
            else {
                resolve(nil)
                return
            }
            do {
                try session.sendProviderMessage(Data([0])) { data in
                    resolve(data.flatMap { String(data: $0, encoding: .utf8) })
                }
            } catch {
                reject("message_failed", error.localizedDescription, error)
            }
        } onError: { error in
            reject("load_failed", error.localizedDescription, error)
        }
    }

    private static func loadOrCreateManager(completion: @escaping (Result<NETunnelProviderManager, Error>) -> Void) {
        loadExistingManager { existing in
            completion(.success(existing ?? NETunnelProviderManager()))
        } onError: { error in
            completion(.failure(error))
        }
    }

    private static func loadExistingManager(
        _ completion: @escaping (NETunnelProviderManager?) -> Void,
        onError: @escaping (Error) -> Void
    ) {
        NETunnelProviderManager.loadAllFromPreferences { managers, error in
            if let error = error {
                onError(error)
                return
            }
            let match = managers?.first {
                ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == providerBundleIdentifier
            }
            completion(match)
        }
    }

    private static func statusString(_ status: NEVPNStatus) -> String {
        switch status {
        case .invalid: return "invalid"
        case .disconnected: return "disconnected"
        case .connecting: return "connecting"
        case .connected: return "connected"
        case .reasserting: return "reasserting"
        case .disconnecting: return "disconnecting"
        @unknown default: return "unknown"
        }
    }
}
