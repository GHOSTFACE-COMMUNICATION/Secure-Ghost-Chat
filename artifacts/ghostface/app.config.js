// Dynamic config layered on app.json. Expo reads app.json first and passes it
// in as `config`; anything returned here wins.
//
// WHY THIS FILE EXISTS: plugins/withSceneLifecycle.js cannot be registered
// unconditionally in app.json, because it is incompatible with
// expo-dev-client.
//
// ROOT CAUSE, recorded verbatim so nobody re-derives it. The plugin moves
// window creation (and therefore `startReactNative`) out of
// `application(_:didFinishLaunchingWithOptions:)` and into
// `SceneDelegate.scene(_:willConnectTo:options:)`, which is what iOS 27's
// scene-lifecycle enforcement requires. But expo-dev-launcher assumes the
// pre-scene ordering:
//
//   * `ExpoDevLauncherAppDelegateSubscriber.application(_:didFinishLaunchingWithOptions:)`
//     runs during didFinishLaunching and calls
//     `EXDevLauncherController.autoSetupStart:`.
//   * `autoSetupStart:` throws unless `autoSetupPrepare:` has already run:
//     "[EXDevLauncherController autoSetupStart:] was called before
//      autoSetupPrepare:. Make sure you've set up expo-modules correctly in
//      AppDelegate and are using ReactDelegate to create a bridge before
//      calling [super application:didFinishLaunchingWithOptions:]."
//   * `autoSetupPrepare:` is only called from
//     `ExpoDevLauncherReactDelegateHandler.createReactRootView`, i.e. from
//     `startReactNative` — which the plugin has just moved to the scene, AFTER
//     didFinishLaunching.
//
// So the subscriber always throws in a dev-client build. Verified 5 Sep 2026
// on an iOS **26.5** simulator (on DIOR, which shares this plugin), not just
// iOS 27 — the breakage is NOT OS-version-specific, unlike the crash the
// plugin fixes. A `#if DEBUG` placeholder window was tried and does not work:
// it satisfies the subscriber's `guard let window` and merely moves the failure
// from a Swift fatalError to the ObjC exception above. It is an ordering
// problem, not a missing window.
//
// Hence: ship the plugin in Release/TestFlight builds, omit it everywhere a
// dev client is involved. Re-evaluate when expo-dev-launcher supports scenes.

/** EAS profiles that produce shipping builds with no dev client attached. */
const SCENE_PROFILES = new Set(["preview", "production"]);

/**
 * ⚠️ ORDER MATTERS. The plugin must run AFTER `withVoipPushKit`, which is what
 * app.json documented when the registration lived there. It is spliced back in
 * at that position rather than appended, so it does not end up after
 * `apple-targets` (which configures the VPN network-extension target).
 */
function withSceneAfterVoip(plugins) {
  const list = [...(plugins ?? [])];
  const nameOf = (p) => (typeof p === "string" ? p : Array.isArray(p) ? p[0] : "");
  const voipIdx = list.findIndex((p) => nameOf(p).includes("withVoipPushKit"));
  const entry = "./plugins/withSceneLifecycle";
  if (voipIdx === -1) {
    // Anchor missing — fail loudly rather than silently shipping the wrong
    // order, the same posture the plugin itself takes about its AppDelegate
    // anchor.
    throw new Error(
      "[app.config] withVoipPushKit not found in plugins; withSceneLifecycle " +
        "ordering cannot be preserved. Check app.json before shipping.",
    );
  }
  list.splice(voipIdx + 1, 0, entry);
  return list;
}

module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;

  // Escape hatch for deliberately testing the scene build locally, e.g.
  //   WITH_SCENE_LIFECYCLE=1 npx expo prebuild -p ios --clean
  const forced = process.env.WITH_SCENE_LIFECYCLE === "1";

  const enabled = forced || (profile ? SCENE_PROFILES.has(profile) : false);

  if (!enabled) return config;

  return { ...config, plugins: withSceneAfterVoip(config.plugins) };
};
