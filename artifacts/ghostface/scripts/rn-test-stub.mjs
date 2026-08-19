/**
 * Minimal stand-in for the "react-native" package, used only when running
 * lib/*.test.ts under Node's test runner (see rn-test-loader.mjs).
 *
 * react-native's real entry point uses Flow syntax that Node's
 * --experimental-strip-types can't parse. None of the lib/*.test.ts files
 * exercise Linking/Platform behavior (native-only paths are tested manually
 * on device), so this just needs to exist without throwing.
 */
export const Platform = {
  OS: "ios",
  select: (obj) => obj.ios ?? obj.default,
};

export const Linking = {
  openURL: async () => {},
};
