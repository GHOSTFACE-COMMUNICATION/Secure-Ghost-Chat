import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Export-compliance guard.
 *
 * ITSAppUsesNonExemptEncryption has flip-flopped six times since 6 Aug 2026
 * (true -> false -> true -> exempt), because it lived in config with no
 * rationale attached to it. Build 63 shipped the wrong value, and so did build
 * 74 — verified by reading the compiled Info.plist out of the .ipa, not the
 * config.
 *
 * The value is not a preference. It follows from the classification in
 * COMPLIANCE.md: the app DOES use encryption, and relies on the mass-market
 * exemption (ECCN 5D992.c) declared separately in the App Store questionnaire —
 * see the MinterEllisonRuddWatts memo of 31 Aug 2026 (matter 1056841) at §7.8.
 *
 * Answering "false" here asserts the app uses no non-exempt encryption, which
 * is untrue and contradicts the advice on file. This test exists so that can
 * never silently happen again.
 */

const appJson = JSON.parse(
  readFileSync(new URL("../app.json", import.meta.url), "utf8"),
) as {
  expo?: { ios?: { infoPlist?: Record<string, unknown> } };
};

test("ITSAppUsesNonExemptEncryption is true (see COMPLIANCE.md)", () => {
  const value = appJson.expo?.ios?.infoPlist?.ITSAppUsesNonExemptEncryption;

  assert.notEqual(
    value,
    undefined,
    "ITSAppUsesNonExemptEncryption is missing from app.json ios.infoPlist. " +
      "Apple then prompts per-submission and the answer goes unrecorded. " +
      "Set it to true — see COMPLIANCE.md §5.",
  );

  assert.equal(
    value,
    true,
    `ITSAppUsesNonExemptEncryption is ${JSON.stringify(value)}, must be true.\n` +
      "GHOSTFACE uses encryption (ChaCha20-Poly1305, X25519, Ed25519, ML-KEM-768, " +
      "HKDF, PBKDF2, argon2id). Declaring false asserts the opposite.\n" +
      "The mass-market exemption is claimed in the App Store questionnaire via the " +
      "ECCN 5D992.c self-classification, NOT by setting this flag to false.\n" +
      "Authority: MinterEllisonRuddWatts memo, 31 Aug 2026, matter 1056841, §7.8.\n" +
      "See COMPLIANCE.md before changing this.",
  );
});

test("the encryption declaration has a compliance record to point at", () => {
  // A guard that cites a missing document is worse than no guard: whoever hits
  // the failure above needs somewhere to read WHY, or they will just flip the
  // flag back.
  const compliance = readFileSync(
    new URL("../../../COMPLIANCE.md", import.meta.url),
    "utf8",
  );

  assert.match(
    compliance,
    /5D992\.c/,
    "COMPLIANCE.md exists but no longer states the ECCN. The flag guard above " +
      "cites it as the authority, so that statement has to stay.",
  );
});
