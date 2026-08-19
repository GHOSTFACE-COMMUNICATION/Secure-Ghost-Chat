/**
 * Minimal in-memory stand-in for "@react-native-async-storage/async-storage",
 * used only when running lib/*.test.ts under Node's test runner (see
 * rn-test-loader.mjs). __getRaw/__setRaw/__reset are test-only extras, not
 * part of the real package's API — used by lib/secureStorage.test.ts to seed
 * legacy-format data directly and to inspect what got written back.
 */
const store = new Map();

export default {
  async getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async setItem(key, value) {
    store.set(key, value);
  },
  async removeItem(key) {
    store.delete(key);
  },
};

export function __reset() {
  store.clear();
}

export function __getRaw(key) {
  return store.has(key) ? store.get(key) : null;
}

export function __setRaw(key, value) {
  store.set(key, value);
}
