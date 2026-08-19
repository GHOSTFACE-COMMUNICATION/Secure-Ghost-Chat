/**
 * Minimal in-memory stand-in for "expo-secure-store", used only when running
 * lib/*.test.ts under Node's test runner (see rn-test-loader.mjs).
 */
const store = new Map();

export async function getItemAsync(key) {
  return store.has(key) ? store.get(key) : null;
}

export async function setItemAsync(key, value) {
  store.set(key, value);
}

export async function deleteItemAsync(key) {
  store.delete(key);
}

export function __reset() {
  store.clear();
}
