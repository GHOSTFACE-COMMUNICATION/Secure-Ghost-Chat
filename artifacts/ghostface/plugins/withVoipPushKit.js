const { withAppDelegate, withEntitlementsPlist, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

// react-native-voip-push-notification sets AppDelegate itself as the
// PKPushRegistry's delegate (RNVoipPushNotificationManager.m:
// `voipRegistry.delegate = (RNVoipPushNotificationManager *)RCTSharedApplication().delegate`).
// Without AppDelegate actually conforming to PKPushRegistryDelegate, the first
// PushKit callback after `registerVoipToken()` crashes with "unrecognized
// selector sent to instance" — this plugin adds the missing conformance so it
// survives prebuild instead of living only in the (gitignored) native project.
const MARKER = "PKPushRegistryDelegate";

const DELEGATE_METHODS = `
  // MARK: - PKPushRegistryDelegate (see plugins/withVoipPushKit.js for why this exists)

  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)
    completion()
  }
`;

function withVoipPushKitAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes(MARKER)) {
      if (!contents.includes("import PushKit")) {
        contents = contents.replace(
          "import ReactAppDependencyProvider",
          "import ReactAppDependencyProvider\nimport PushKit",
        );
      }

      contents = contents.replace(
        "public class AppDelegate: ExpoAppDelegate {",
        "public class AppDelegate: ExpoAppDelegate, PKPushRegistryDelegate {",
      );

      const anchor =
        "    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result\n  }\n}";
      if (contents.includes(anchor)) {
        contents = contents.replace(
          anchor,
          `    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result\n  }\n${DELEGATE_METHODS}}`,
        );
      }
    }

    config.modResults.contents = contents;
    return config;
  });
}

function withVoipPushKitEntitlements(config) {
  return withEntitlementsPlist(config, (config) => {
    // EAS sets this during cloud builds; store/production builds need the
    // production APNs entitlement, dev/internal builds need the sandbox one.
    config.modResults["aps-environment"] =
      process.env.EAS_BUILD_PROFILE === "production" ? "production" : "development";
    return config;
  });
}

function withVoipPushKitBridgingHeader(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const bridgingHeaderPath = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        `${config.modRequest.projectName}-Bridging-Header.h`,
      );
      if (fs.existsSync(bridgingHeaderPath)) {
        const contents = fs.readFileSync(bridgingHeaderPath, "utf8");
        if (!contents.includes("RNVoipPushNotificationManager.h")) {
          fs.writeFileSync(
            bridgingHeaderPath,
            contents + `\n#import <PushKit/PushKit.h>\n#import "RNVoipPushNotificationManager.h"\n`,
          );
        }
      }
      return config;
    },
  ]);
}

module.exports = function withVoipPushKit(config) {
  config = withVoipPushKitAppDelegate(config);
  config = withVoipPushKitEntitlements(config);
  config = withVoipPushKitBridgingHeader(config);
  return config;
};
