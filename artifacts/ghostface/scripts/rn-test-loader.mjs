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

/**
 * Node module-resolution hook (registered by run-tests.mjs) that redirects
 * any `import ... from "react-native"` to rn-test-stub.mjs during test runs
 * (see rn-test-stub.mjs for why), and resolves the "@/" path alias.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react-native") {
    return {
      url: new URL("./rn-test-stub.mjs", import.meta.url).href,
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
