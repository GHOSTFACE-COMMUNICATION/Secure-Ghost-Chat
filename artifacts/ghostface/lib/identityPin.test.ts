import { test } from "node:test";
import assert from "node:assert/strict";

import { checkIdentityPin, normalizeIdentityKey } from "./identityPin.ts";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

test("first contact yields first-use so the caller pins", () => {
  for (const empty of [undefined, null, ""]) {
    const r = checkIdentityPin(empty, KEY_A);
    assert.equal(r.verdict, "first-use");
    assert.equal(r.normalized, KEY_A);
  }
});

test("the same key matches", () => {
  assert.equal(checkIdentityPin(KEY_A, KEY_A).verdict, "match");
});

test("a substituted key is a mismatch — the whole point of the pin", () => {
  const r = checkIdentityPin(KEY_A, KEY_B);
  assert.equal(r.verdict, "mismatch");
  // The presented key is still returned so the UI can show what was offered,
  // but the caller must NOT write it over the pin without explicit consent.
  assert.equal(r.normalized, KEY_B);
});

test("case and surrounding whitespace do not cause a false mismatch", () => {
  // A false mismatch hard-blocks a legitimate contact: a denial of service
  // wearing a security badge. Bundle hex and wire-header hex reach the two
  // call sites from different sources.
  assert.equal(checkIdentityPin(KEY_A, KEY_A.toUpperCase()).verdict, "match");
  assert.equal(checkIdentityPin(KEY_A.toUpperCase(), KEY_A).verdict, "match");
  assert.equal(checkIdentityPin(KEY_A, `  ${KEY_A}  `).verdict, "match");
});

test("an unreadable stored pin blocks rather than silently re-pinning", () => {
  // Corrupted local state must not resolve to "no pin, so pin whatever
  // arrived" — that would let anything able to damage the blob clear the pin.
  for (const corrupt of ["zz", KEY_A.slice(0, 63), "not-hex-at-all"]) {
    assert.equal(checkIdentityPin(corrupt, KEY_B).verdict, "mismatch");
  }
});

test("a malformed presented key throws instead of producing a verdict", () => {
  for (const bad of [undefined, null, "", "xyz", KEY_A.slice(0, 63), KEY_A + "a", 123, {}]) {
    assert.throws(() => checkIdentityPin(KEY_A, bad), /64 hex chars/);
  }
});

test("normalizeIdentityKey lowercases, trims, and rejects junk", () => {
  assert.equal(normalizeIdentityKey(`  ${KEY_A.toUpperCase()} `), KEY_A);
  assert.throws(() => normalizeIdentityKey("g".repeat(64)), /64 hex chars/);
  assert.throws(() => normalizeIdentityKey(KEY_A.slice(0, 10)), /64 hex chars/);
});
