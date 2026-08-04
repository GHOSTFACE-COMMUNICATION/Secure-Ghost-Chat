const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Block server-only packages and @solana temp dirs from Metro's file watcher.
// @solana/web3.js creates _tmp_ directories during init that confuse Metro.
config.resolver = {
  ...config.resolver,
  blockList: [
    // Temp directories created by @solana/web3.js during initialization
    /web3\.js_tmp_\d+/,
    // Server-only: prevent these from being bundled into the mobile app
    /node_modules\/@solana\/web3\.js\//,
    /node_modules\/@solana\/spl-token\//,
    /node_modules\/@solana\/buffer-layout\//,
    /node_modules\/rpc-websockets\//,
    /node_modules\/borsh\//,
  ],
};

module.exports = config;
