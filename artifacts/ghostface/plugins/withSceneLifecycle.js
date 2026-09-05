const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

// iOS 27 made UIScene lifecycle adoption MANDATORY: UIKit evaluates
// __UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption at launch and
// traps (EXC_BREAKPOINT) if the app has neither a UIApplicationSceneManifest
// nor application(_:configurationForConnecting:options:). GHOSTFACE had
// neither, so it crashed ~2.4s into launch on iOS 27 while running fine on
// 26.5.
//
// Expo does not do this for us. The bare-minimum AppDelegate template still
// ships `window = UIWindow(frame: UIScreen.main.bounds)` in
// didFinishLaunchingWithOptions as of SDK 55, 56 AND 57 (checked against the
// published templates), so upgrading the SDK does not fix it and this plugin
// is not a stopgap for something landing upstream soon.
//
// The manifest ALONE is not enough, and that failure is silent: adding it
// stops the trap but the app renders nothing, because a window built with
// UIWindow(frame:) is never associated with the UIWindowScene and so is never
// presented. Verified — black framebuffer, no Window node in the accessibility
// hierarchy. Window creation has to move into the scene delegate too, which is
// what this plugin does.
const MARKER = "UIWindowSceneDelegate";

// The window block the SDK 54 template emits, which we replace wholesale.
const WINDOW_BLOCK = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

// React Native's root view is created by startReactNative(in:), so it cannot
// run until a scene hands us a window. We keep the factory/delegate wiring in
// didFinishLaunchingWithOptions (one-time app setup) and stash launchOptions
// for the scene to consume.
const WINDOW_BLOCK_REPLACEMENT = `    // Window creation moved to SceneDelegate.scene(_:willConnectTo:options:) —
    // see plugins/withSceneLifecycle.js. RN's root view needs a scene-attached
    // window, so startReactNative cannot run here any more.
    self.launchOptions = launchOptions`;

const SCENE_DELEGATE = `
// MARK: - UIScene lifecycle (see plugins/withSceneLifecycle.js for why this exists)

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    // UIWindow(windowScene:) is what associates the window with the scene.
    // UIWindow(frame:) does not, and an unassociated window never displays.
    let window = UIWindow(windowScene: windowScene)
    self.window = window

    // Mirrored onto AppDelegate because native modules in this app's
    // dependency tree reach for UIApplication.shared.delegate.window
    // (react-native-callkeep and the VoIP path among them). Ownership is the
    // scene's; this is a compatibility alias, not a second window.
    appDelegate.window = window

    // didFinishLaunchingWithOptions receives nil launchOptions once an app
    // adopts scenes, so a cold launch's URL arrives here instead. Re-inject it
    // so RCTLinkingManager's initial-URL path still resolves and invite deep
    // links keep working on a cold start.
    var launchOptions = appDelegate.launchOptions ?? [:]
    if let url = connectionOptions.urlContexts.first?.url {
      launchOptions[.url] = url
    }

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
  }

  // Under the scene lifecycle UIKit stops calling
  // application(_:open:options:) and application(_:continue:...), so warm deep
  // links and universal links have to be forwarded from here or they are
  // silently dropped.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in })
  }
}
`;

function withSceneLifecycleInfoPlist(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            // Swift classes are module-qualified here; PRODUCT_MODULE_NAME is
            // substituted at build time. No UISceneStoryboardFile — RN sets
            // the root view controller programmatically.
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return config;
  });
}

function withSceneLifecycleAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    let contents = config.modResults.contents;

    if (contents.includes(MARKER)) {
      return config;
    }

    if (!contents.includes(WINDOW_BLOCK)) {
      throw new Error(
        "[withSceneLifecycle] Could not find the expected UIWindow(frame:) block in " +
          "AppDelegate.swift. The Expo template has changed — re-check the anchor " +
          "against the new template before trusting this plugin, because a silent " +
          "no-op here reintroduces the iOS 27 launch crash.",
      );
    }

    contents = contents.replace(WINDOW_BLOCK, WINDOW_BLOCK_REPLACEMENT);

    // Stash launchOptions so the scene can pass them to startReactNative.
    contents = contents.replace(
      "  var window: UIWindow?",
      "  var window: UIWindow?\n  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?",
    );

    contents = contents.trimEnd() + "\n" + SCENE_DELEGATE;

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = function withSceneLifecycle(config) {
  config = withSceneLifecycleInfoPlist(config);
  config = withSceneLifecycleAppDelegate(config);
  return config;
};
