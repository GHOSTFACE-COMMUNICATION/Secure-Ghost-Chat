const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo so Metro can see workspace packages + the root store
config.watchFolders = [monorepoRoot];

// Resolve from both the app's and the monorepo root's node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Block server-only packages and @solana temp dirs from Metro's file watcher.
config.resolver.blockList = [
  /web3\.js_tmp_\d+/,
  /node_modules\/@solana\/web3\.js\//,
  /node_modules\/@solana\/spl-token\//,
  /node_modules\/@solana\/buffer-layout\//,
  /node_modules\/rpc-websockets\//,
  /node_modules\/borsh\//,
];

module.exports = config;
