/**
 * Single approved source of cryptographic randomness for GHOSTFACE
 * (audit finding #5).
 *
 * Every key, nonce, and ML-KEM encapsulation in this app must be generated
 * through this module — never by importing @noble/*'s randomBytes directly.
 *
 * Underlying chain: index.js installs react-native-get-random-values as its
 * very first statement (before any app/lib code is evaluated), which backs
 * globalThis.crypto.getRandomValues with:
 *   - iOS:     SecRandomCopyBytes(kSecRandomDefault, ...)
 *   - Android: java.security.SecureRandom
 * @noble/hashes' randomBytes() reads that global and throws if it's absent
 * — but react-native-get-random-values itself has one silent fallback: if
 * none of its native surfaces can be found, isRemoteDebuggingInChrome()
 * (dev-only) routes to a Math.random()-backed shim with only a
 * console.warn, never a throw. Nothing upstream of this module verifies
 * that fallback was never taken. This module is the chokepoint that does:
 * it refuses to trust the global unless the native module is directly
 * observable, and self-tests actual output before any identity/key
 * material is created.
 */
import { NativeModules } from "react-native";
import { randomBytes as nobleRandomBytes } from "@noble/hashes/utils.js";

export class InsecureCsprngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecureCsprngError";
  }
}

/**
 * True only if one of the native surfaces react-native-get-random-values
 * itself branches on (see that package's index.js) is actually present.
 * Mirrors that library's own detection so this stays accurate across
 * Expo SDK / old-vs-new-architecture changes, rather than inferring
 * nativeness indirectly from output shape alone.
 */
export function hasNativeCsprng(): boolean {
  const g = globalThis as unknown as {
    ExpoModules?: { ExpoRandom?: unknown };
    expo?: { modules?: { ExpoCrypto?: { getRandomValues?: unknown } } };
  };
  return !!(
    NativeModules.RNGetRandomValues ||
    NativeModules.ExpoRandom ||
    g.ExpoModules?.ExpoRandom ||
    g.expo?.modules?.ExpoCrypto?.getRandomValues
  );
}

/**
 * The approved randomness source. Throws InsecureCsprngError instead of
 * ever silently drawing from a non-native fallback.
 */
export function randomBytes(byteLength: number = 32) {
  if (!hasNativeCsprng()) {
    throw new InsecureCsprngError(
      "No native CSPRNG module found (RNGetRandomValues/ExpoRandom/ExpoCrypto). " +
        "Refusing to generate randomness from a non-native fallback.",
    );
  }
  return nobleRandomBytes(byteLength);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isAllZero(a: Uint8Array): boolean {
  return a.every((byte) => byte === 0);
}

/**
 * Startup self-test. Must run — and pass — before any identity or key
 * material is created (see index.js). Fails closed: throws
 * InsecureCsprngError rather than letting the app continue on unverified
 * randomness.
 */
export function assertCsprngHealthy(): void {
  if (!hasNativeCsprng()) {
    throw new InsecureCsprngError(
      "CSPRNG self-test failed: no native module backing crypto.getRandomValues. " +
        "Refusing to create identity/key material.",
    );
  }
  const a = randomBytes(32);
  const b = randomBytes(32);
  if (isAllZero(a) || isAllZero(b)) {
    throw new InsecureCsprngError("CSPRNG self-test failed: generated an all-zero buffer.");
  }
  if (bytesEqual(a, b)) {
    throw new InsecureCsprngError("CSPRNG self-test failed: two independent draws were identical.");
  }
}
