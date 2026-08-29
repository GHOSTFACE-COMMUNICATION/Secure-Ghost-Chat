import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeCallId } from "@/lib/callId";
import { markCallEnded, wasCallEnded } from "@/lib/endedCalls";

// A callId is a lowercase UUID when the caller mints it, and uppercase by the
// time CallKit hands it back through NSUUID. Anything keyed by callId has to
// treat those as the same call, or a lookup misses and the miss is
// indistinguishable from "never tracked" — which is how a CallKit-answered
// call lost its payload (joining with no call mode) and how a hangup left the
// native call UI on screen.

const LOWER = "6f1a2b3c-4d5e-4f60-8123-456789abcdef";
const UPPER = LOWER.toUpperCase();

test("normalizeCallId collapses the two casings CallKit round-trips between", () => {
  assert.equal(normalizeCallId(UPPER), LOWER);
  assert.equal(normalizeCallId(LOWER), LOWER);
  assert.equal(normalizeCallId(UPPER), normalizeCallId(LOWER));
});

test("normalizeCallId leaves an already-canonical id untouched", () => {
  assert.equal(normalizeCallId(normalizeCallId(UPPER)), LOWER);
});

test("a call ended under one casing reads as ended under the other", () => {
  markCallEnded(LOWER);
  assert.equal(wasCallEnded(UPPER), true, "CallKit's uppercase UUID must find the lowercase record");

  const other = "11112222-3333-4444-5555-666677778888";
  markCallEnded(other.toUpperCase());
  assert.equal(wasCallEnded(other), true, "and the reverse direction too");
});

test("an unrelated callId is still not ended", () => {
  assert.equal(wasCallEnded("99999999-9999-4999-8999-999999999999"), false);
  assert.equal(wasCallEnded(undefined), false);
  assert.equal(wasCallEnded(null), false);
});
