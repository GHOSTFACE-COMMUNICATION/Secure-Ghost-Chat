import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// tsconfig.json maps "@/*" -> "./*" (project root); Metro and tsc both
// understand that, but Node's own ESM resolver doesn't, so lib/*.ts files
// that import a sibling via "@/lib/..." (the codebase's normal convention —
// see e.g. lib/recoveryPhrase.ts) fail to resolve under node --test without
// this. Resolving it here keeps the alias out of source files instead of
// forcing them into an inconsistent relative-with-extension style just for
// testability.
const projectRoot = new URL("../", import.meta.url);

// Native-module packages redirected to in-memory stubs during test runs —
// see each stub file for why the real package can't be imported under
// node --test (Flow syntax, platform-specific native bindings, etc).
const STUBS = {
  "react-native": "./rn-test-stub.mjs",
  "@react-native-async-storage/async-storage": "./asyncstorage-test-stub.mjs",
  "expo-secure-store": "./securestore-test-stub.mjs",
};

/**
 * Node module-resolution hook (registered by run-tests.mjs) that redirects
 * native-module imports to their stubs during test runs, and resolves the
 * "@/" path alias.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier in STUBS) {
    return {
      url: new URL(STUBS[specifier], import.meta.url).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith("@/")) {
    const target = new URL(specifier.slice(2), projectRoot);
    if (!existsSync(fileURLToPath(target)) && !/\.[a-zA-Z]+$/.test(target.pathname)) {
      target.pathname += ".ts";
    }
    return { url: target.href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
