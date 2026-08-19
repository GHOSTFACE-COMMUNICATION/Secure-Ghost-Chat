/**
 * Minimal stand-in for the "react-native" package, used only when running
 * lib/*.test.ts under Node's test runner (see rn-test-loader.mjs).
 *
 * react-native's real entry point uses Flow syntax that Node's
 * --experimental-strip-types can't parse. None of the lib/*.test.ts files
 * exercise Linking/Platform behavior (native-only paths are tested manually
 * on device), so this just needs to exist without throwing.
 *
 * NativeModules.RNGetRandomValues defaults present (mirroring a real device)
 * so lib/csprng.test.ts can exercise its "native backing detected" path.
 * That test deletes/restores the property directly on this same object to
 * exercise the "no native backing" path too — see that file for why a
 * plain mutable object (not a re-exported binding) is required here.
 */
export const Platform = {
  OS: "ios",
  select: (obj) => obj.ios ?? obj.default,
};

export const Linking = {
  openURL: async () => {},
};

export const NativeModules = {
  RNGetRandomValues: {},
};
