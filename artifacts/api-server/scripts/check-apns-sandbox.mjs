#!/usr/bin/env node
/**
 * check-apns-sandbox.mjs — guard for task #171.
 *
 * A dev server that forgets APNS_USE_SANDBOX=1 pushes dev-build VoIP tokens
 * at the *production* APNs host, which rejects them as BadDeviceToken —
 * silently from the app's perspective. This script asserts the wiring that
 * catches the misconfiguration stays in place:
 *
 *   1. nativeCallPushSender.ts exports apnsSandboxMismatch() implementing
 *      NODE_ENV !== "production" && APNS_USE_SANDBOX !== "1".
 *   2. warnIfApnsSandboxMismatch() logs a warning naming BadDeviceToken and
 *      the APNS_USE_SANDBOX fix.
 *   3. The warning is invoked at server startup (index.ts) AND defensively
 *      on the APNs send path (sendNativeCallPush).
 *
 * Exit 0 → wiring intact. Exit 1 → regression.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.resolve(__dirname, "..", "src", p), "utf8");

const sender = src("lib/nativeCallPushSender.ts");
const index = src("index.ts");

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
}

check(
  "apnsSandboxMismatch() exported and checks NODE_ENV !== 'production'",
  /export function apnsSandboxMismatch\(\)[\s\S]{0,200}NODE_ENV !== "production"/.test(sender),
);
check(
  "apnsSandboxMismatch() checks APNS_USE_SANDBOX !== '1'",
  /export function apnsSandboxMismatch\(\)[\s\S]{0,200}APNS_USE_SANDBOX !== "1"/.test(sender),
);
check(
  "warnIfApnsSandboxMismatch() exists and warns via logger",
  /export function warnIfApnsSandboxMismatch\(\)[\s\S]{0,600}logger\.warn/.test(sender),
);
check(
  "warning message names BadDeviceToken symptom",
  sender.includes("BadDeviceToken"),
);
check(
  "warning message names the APNS_USE_SANDBOX=1 fix",
  sender.includes("Set APNS_USE_SANDBOX=1"),
);
check(
  "warning invoked on the APNs send path",
  /export async function sendNativeCallPush[\s\S]{0,800}warnIfApnsSandboxMismatch\(\);/.test(sender),
);
check(
  "warning invoked at server startup (index.ts)",
  index.includes("warnIfApnsSandboxMismatch()"),
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed — APNs sandbox misconfig guard regressed.`);
  process.exit(1);
}
console.log("\nAll APNs sandbox misconfig guard checks passed.");
