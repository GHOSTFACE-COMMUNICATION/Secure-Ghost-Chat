import assert from "node:assert/strict";
import { test } from "node:test";

import { NativeModules } from "react-native";
import { InsecureCsprngError, assertCsprngHealthy, hasNativeCsprng, randomBytes } from "./csprng.ts";

// The test-runner stub (scripts/rn-test-stub.mjs) starts with
// NativeModules.RNGetRandomValues present, mirroring a real device. Tests
// that need the "no native backing" branch delete/restore that property
// directly on the imported object rather than reassigning the import (ES
// module bindings can't be reassigned from outside their module).
function withoutNativeModule<T>(fn: () => T): T {
  const saved = NativeModules.RNGetRandomValues;
  delete (NativeModules as Record<string, unknown>).RNGetRandomValues;
  try {
    return fn();
  } finally {
    (NativeModules as Record<string, unknown>).RNGetRandomValues = saved;
  }
}

test("hasNativeCsprng: true when RNGetRandomValues is present", () => {
  assert.equal(hasNativeCsprng(), true);
});

test("hasNativeCsprng: false when no native surface is present", () => {
  withoutNativeModule(() => {
    assert.equal(hasNativeCsprng(), false);
  });
});

test("hasNativeCsprng: true via ExpoRandom NativeModule as an alternate surface", () => {
  withoutNativeModule(() => {
    (NativeModules as Record<string, unknown>).ExpoRandom = {};
    try {
      assert.equal(hasNativeCsprng(), true);
    } finally {
      delete (NativeModules as Record<string, unknown>).ExpoRandom;
    }
  });
});

test("randomBytes: returns a buffer of the requested length when native-backed", () => {
  const bytes = randomBytes(32);
  assert.equal(bytes.length, 32);
});

test("randomBytes: two draws are not identical (sanity, not a statistical proof)", () => {
  const a = randomBytes(32);
  const b = randomBytes(32);
  assert.notDeepEqual(a, b);
});

test("randomBytes: throws InsecureCsprngError instead of silently falling back when native backing is absent", () => {
  withoutNativeModule(() => {
    assert.throws(() => randomBytes(32), InsecureCsprngError);
  });
});

test("assertCsprngHealthy: passes when native-backed", () => {
  assert.doesNotThrow(() => assertCsprngHealthy());
});

test("assertCsprngHealthy: fails closed (throws) when native backing is absent", () => {
  withoutNativeModule(() => {
    assert.throws(() => assertCsprngHealthy(), InsecureCsprngError);
  });
});
