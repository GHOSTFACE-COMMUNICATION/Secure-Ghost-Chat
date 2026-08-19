/**
 * Unit tests for lib/smsFallback.ts. Pure JS — no React Native or
 * Linking in scope. The native Linking handoff is tested manually on
 * device (the OS composer requires real hardware).
 */

import {
  DEFAULT_SMS_FALLBACK_MESSAGE,
  MAX_SMS_FALLBACK_MESSAGE_LEN,
  MAX_SMS_FALLBACK_NUMBERS,
  buildSmsUrl,
  isValidE164,
  normalizeE164,
  parseStoredNumbers,
  sanitizeFallbackMessage,
} from "./smsFallback.ts";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`ASSERT FAILED: ${msg} (got ${String(a)}, want ${String(b)})`);
}

// ── E.164 validation ──────────────────────────────────────────────────────────
eq(normalizeE164("+14155551234"), "+14155551234", "plain E.164 ok");
eq(normalizeE164("+1 (415) 555-1234"), "+14155551234", "human-formatted normalized");
eq(normalizeE164("+1.415.555.1234"), "+14155551234", "dots stripped");
eq(normalizeE164("4155551234"), null, "missing + rejected");
eq(normalizeE164("+0123456789"), null, "leading 0 country code rejected");
eq(normalizeE164("+"), null, "lone plus rejected");
eq(normalizeE164(""), null, "empty rejected");
eq(normalizeE164("+1234"), null, "too short rejected");
eq(normalizeE164("+" + "1".repeat(16)), null, "too long rejected");
// @ts-expect-error — runtime safety
eq(normalizeE164(null), null, "null rejected");
// @ts-expect-error — runtime safety
eq(normalizeE164(12345), null, "non-string rejected");

assert(isValidE164("+14155551234"), "isValidE164 true for valid");
assert(!isValidE164("not a number"), "isValidE164 false for garbage");

// ── Message sanitization ──────────────────────────────────────────────────────
eq(sanitizeFallbackMessage(""), DEFAULT_SMS_FALLBACK_MESSAGE, "empty → default");
eq(sanitizeFallbackMessage("   "), DEFAULT_SMS_FALLBACK_MESSAGE, "whitespace → default");
eq(sanitizeFallbackMessage("hello   world"), "hello world", "whitespace collapsed");
eq(sanitizeFallbackMessage("hi\nthere"), "hi there", "newline → space");
const long = "x".repeat(MAX_SMS_FALLBACK_MESSAGE_LEN + 50);
eq(sanitizeFallbackMessage(long).length, MAX_SMS_FALLBACK_MESSAGE_LEN, "truncated to cap");

// ── parseStoredNumbers ────────────────────────────────────────────────────────
eq(parseStoredNumbers(null).length, 0, "null → []");
eq(parseStoredNumbers("not json").length, 0, "garbage → []");
eq(parseStoredNumbers('{"not":"array"}').length, 0, "non-array → []");
const parsed = parseStoredNumbers(
  JSON.stringify(["+14155551234", "bad", "+14155551234", "+447911123456", "+33612345678", "+4915112345678"]),
);
eq(parsed.length, MAX_SMS_FALLBACK_NUMBERS, "cap enforced");
eq(parsed[0], "+14155551234", "first preserved");
assert(!parsed.includes("bad"), "invalid dropped");
// dedup
const deduped = parseStoredNumbers(JSON.stringify(["+14155551234", "+1 (415) 555-1234"]));
eq(deduped.length, 1, "normalized duplicates collapse");

// ── buildSmsUrl ───────────────────────────────────────────────────────────────
eq(
  buildSmsUrl("+14155551234", "hi", "ios"),
  "sms:+14155551234&body=hi",
  "ios separator is &",
);
eq(
  buildSmsUrl("+14155551234", "hi", "android"),
  "sms:+14155551234?body=hi",
  "android separator is ?",
);
eq(
  buildSmsUrl("+14155551234", "a b&c=d", "ios"),
  "sms:+14155551234&body=a%20b%26c%3Dd",
  "body is url-encoded",
);
// Multi-recipient: a single SMS URL must carry every number joined by
// commas so the OS composer pops up at most once during panic (Task #113
// privacy fix — no per-recipient composer churn).
eq(
  buildSmsUrl(["+14155551234", "+447911123456"], "hi", "ios"),
  "sms:+14155551234,+447911123456&body=hi",
  "multi-recipient ios uses comma join",
);
eq(
  buildSmsUrl(["+14155551234", "+447911123456"], "hi", "android"),
  "sms:+14155551234,+447911123456?body=hi",
  "multi-recipient android uses comma join",
);

console.log("All smsFallback tests passed.");
