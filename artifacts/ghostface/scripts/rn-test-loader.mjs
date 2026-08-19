/**
 * Node module-resolution hook (registered by run-tests.mjs) that redirects
 * any `import ... from "react-native"` to rn-test-stub.mjs during test runs.
 * See rn-test-stub.mjs for why.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "react-native") {
    return {
      url: new URL("./rn-test-stub.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
