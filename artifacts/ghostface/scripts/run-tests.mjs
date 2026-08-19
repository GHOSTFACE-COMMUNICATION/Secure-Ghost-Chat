#!/usr/bin/env node
/**
 * Runs lib/*.test.ts under Node's built-in test runner.
 *
 * These are plain .ts files (node:test + node:assert/strict), so they need a
 * TS-stripping loader. Node >= 22.6 can do that itself via
 * --experimental-strip-types; older Node needs tsx's --test wrapper instead.
 * Picking this at run time (rather than hardcoding one or the other in
 * package.json) keeps the script working across whatever Node version CI or
 * a given machine happens to have installed.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const [major, minor] = process.versions.node.split(".").map(Number);
const supportsStripTypes = major > 22 || (major === 22 && minor >= 6);

// Manual glob (not fs.globSync) — that API itself needs Node 22+, and this
// script has to run correctly on the pre-22.6 fallback path too.
const testFiles = readdirSync("lib")
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => `lib/${f}`)
  .sort();

const [cmd, args] = supportsStripTypes
  ? ["node", ["--experimental-strip-types", "--test", ...testFiles]]
  : ["npx", ["tsx", "--test", ...testFiles]];

console.log(`[run-tests] Node ${process.version} — using: ${cmd} ${args.join(" ")}`);

const result = spawnSync(cmd, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
