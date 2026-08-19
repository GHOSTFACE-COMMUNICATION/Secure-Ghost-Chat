import { test } from "node:test";
import assert from "node:assert/strict";

import {
  encodeHeaderAD,
  generateKemKeyPair,
  generateOneTimePreKeys,
  generateSigningKeyPair,
  initSessionAliceWithHeader,
  initSessionBobFromHeader,
  ratchetDecrypt,
  ratchetEncrypt,
  signKemPreKey,
  signSPK,
  toHex,
  type PreKeyBundle,
  type RatchetHeader,
} from "./doubleRatchet.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DH_HEX = "aa".repeat(32); // 32 bytes of 0xaa
const PQPUB_HEX = "bb".repeat(1184);
const PQCT_HEX = "cc".repeat(1088);

/** Build a full Alice/Bob session pair via a real X3DH handshake, so encrypt/decrypt exercise the actual wire path (not hand-built state). PQ enabled when both KEM args are supplied. */
function setupSessionPair(pq: boolean) {
  const aliceIK = generateOneTimePreKeys(1)[0];
  const bobIK = generateOneTimePreKeys(1)[0];
  const bobSPK = generateOneTimePreKeys(1)[0];
  const bobIkSign = generateSigningKeyPair();

  const bundle: PreKeyBundle = {
    ikPublicKey: bobIK.pub,
    spkPublicKey: bobSPK.pub,
    opkPublicKey: null,
    spkSignature: signSPK(bobSPK.pub, bobIkSign.priv),
    ikSignPublicKey: bobIkSign.pub,
  };

  let bobKem: { pub: string; priv: string } | undefined;
  if (pq) {
    bobKem = generateKemKeyPair();
    bundle.pqkemPublicKey = bobKem.pub;
    bundle.pqkemSignature = signKemPreKey(bobKem.pub, bobIkSign.priv);
  }

  const { session: aliceSession, x3dhHeader } = initSessionAliceWithHeader(bundle, aliceIK.priv, aliceIK.pub);
  const bobSession = initSessionBobFromHeader(
    x3dhHeader,
    bobIK.priv,
    bobIK.pub,
    bobSPK.priv,
    bobSPK.pub,
    undefined,
    bobKem?.priv,
  );

  // Convention (see doubleRatchet.ts): `.alice` always holds the CURRENT
  // DEVICE's real ratchet state, on both sides.
  return { aliceState: aliceSession.alice, bobState: bobSession.alice };
}

// ── Test 1: known-answer test ──────────────────────────────────────────────────
// Independently reconstructs the expected byte layout (not by calling
// encodeHeaderAD) and checks encodeHeaderAD produces exactly those bytes.

test("encodeHeaderAD: known-answer — fixed header produces the documented byte layout", () => {
  const header: RatchetHeader = { dh: DH_HEX, n: 1, pn: 0 };

  const expectedHex =
    "47464452" + // magic "GFDR"
    "01" +       // protocol_version
    "05" +       // field_count
    "01" + DH_HEX + // field_id DH + 32 raw bytes
    "02" + "00000001" + // field_id N + u32BE(1)
    "03" + "00000000" + // field_id PN + u32BE(0)
    "04" + "00" + "0000" + // field_id PQPUB + absent + zero length
    "05" + "00" + "0000";  // field_id PQCT + absent + zero length

  assert.equal(toHex(encodeHeaderAD(header)), expectedHex);
});

test("encodeHeaderAD: known-answer — PQ fields present, explicit presence+length framing", () => {
  const header: RatchetHeader = { dh: DH_HEX, n: 42, pn: 7, pqPub: PQPUB_HEX, pqCt: PQCT_HEX };

  const expectedHex =
    "47464452" +
    "01" +
    "05" +
    "01" + DH_HEX +
    "02" + "0000002a" + // 42
    "03" + "00000007" + // 7
    "04" + "01" + "04a0" + PQPUB_HEX + // present, length 1184 = 0x04a0
    "05" + "01" + "0440" + PQCT_HEX;   // present, length 1088 = 0x0440

  assert.equal(toHex(encodeHeaderAD(header)), expectedHex);
});

// ── Test 2: determinism ──────────────────────────────────────────────────────

test("encodeHeaderAD: deterministic across repeated calls", () => {
  const header: RatchetHeader = { dh: DH_HEX, n: 5, pn: 3, pqPub: PQPUB_HEX };
  const a = toHex(encodeHeaderAD(header));
  const b = toHex(encodeHeaderAD(header));
  const c = toHex(encodeHeaderAD({ ...header })); // fresh object, same values, different key insertion order path
  assert.equal(a, b);
  assert.equal(a, c);
});

// ── Test 3: distinct headers → distinct AD ───────────────────────────────────

test("encodeHeaderAD: headers differing in one field produce different AD", () => {
  const base: RatchetHeader = { dh: DH_HEX, n: 1, pn: 0 };
  const diffN: RatchetHeader = { ...base, n: 2 };
  const diffPn: RatchetHeader = { ...base, pn: 1 };
  const diffDh: RatchetHeader = { ...base, dh: "bb".repeat(32) };

  const baseAD = toHex(encodeHeaderAD(base));
  assert.notEqual(baseAD, toHex(encodeHeaderAD(diffN)));
  assert.notEqual(baseAD, toHex(encodeHeaderAD(diffPn)));
  assert.notEqual(baseAD, toHex(encodeHeaderAD(diffDh)));
});

// ── Test 4: decrypt fails when a header field is tampered after encryption ──

test("ratchetEncrypt/ratchetDecrypt: tampering with a header field after encryption breaks decryption", () => {
  const { aliceState, bobState } = setupSessionPair(false);

  const { message } = ratchetEncrypt(aliceState, "hello bob");

  const tampered = { ...message, header: { ...message.header, n: message.header.n + 1 } };
  assert.throws(() => ratchetDecrypt(bobState, tampered));

  // Sanity: the untampered message still decrypts fine with the same starting state.
  const { plaintext } = ratchetDecrypt(bobState, message);
  assert.equal(plaintext, "hello bob");
});

// ── Test 5: existing ratchet round-trip still passes (classical + PQ) ───────

test("ratchetEncrypt/ratchetDecrypt: round-trip, classical-only session", () => {
  const { aliceState, bobState } = setupSessionPair(false);

  const enc1 = ratchetEncrypt(aliceState, "first message");
  const dec1 = ratchetDecrypt(bobState, enc1.message);
  assert.equal(dec1.plaintext, "first message");

  // Reply from Bob → Alice triggers a DH ratchet step, exercising header.dh change.
  const enc2 = ratchetEncrypt(dec1.state, "reply from bob");
  const dec2 = ratchetDecrypt(enc1.state, enc2.message);
  assert.equal(dec2.plaintext, "reply from bob");
});

test("ratchetEncrypt/ratchetDecrypt: round-trip, PQ-enabled session (pqPub/pqCt populated)", () => {
  const { aliceState, bobState } = setupSessionPair(true);

  const enc1 = ratchetEncrypt(aliceState, "pq hello");
  assert.ok(enc1.message.header.pqPub, "expected pqPub to be set on a PQ-enabled sending chain");
  const dec1 = ratchetDecrypt(bobState, enc1.message);
  assert.equal(dec1.plaintext, "pq hello");

  const enc2 = ratchetEncrypt(dec1.state, "pq reply");
  const dec2 = ratchetDecrypt(enc1.state, enc2.message);
  assert.equal(dec2.plaintext, "pq reply");
});

// ── Test 6: n/pn encode throws on non-integer, negative, or > 0xFFFFFFFF ─────

test("encodeHeaderAD: n/pn throw on non-integer, negative, or out-of-range — never silently truncate", () => {
  const base = { dh: DH_HEX, pn: 0 };
  assert.throws(() => encodeHeaderAD({ ...base, n: -1 }));
  assert.throws(() => encodeHeaderAD({ ...base, n: 1.5 }));
  assert.throws(() => encodeHeaderAD({ ...base, n: 0x100000000 })); // 2^32, one past u32 max
  assert.throws(() => encodeHeaderAD({ ...base, n: NaN }));
  assert.throws(() => encodeHeaderAD({ ...base, n: Infinity }));

  const baseN = { dh: DH_HEX, n: 0 };
  assert.throws(() => encodeHeaderAD({ ...baseN, pn: -1 }));
  assert.throws(() => encodeHeaderAD({ ...baseN, pn: 1.5 }));
  assert.throws(() => encodeHeaderAD({ ...baseN, pn: 0x100000000 }));

  // Boundary values must NOT throw.
  assert.doesNotThrow(() => encodeHeaderAD({ dh: DH_HEX, n: 0, pn: 0xffffffff }));
  assert.doesNotThrow(() => encodeHeaderAD({ dh: DH_HEX, n: 0xffffffff, pn: 0 }));
});

// ── Test 7: strict hex validation on dh/pqPub/pqCt ───────────────────────────

test("encodeHeaderAD: rejects malformed hex — wrong length, non-hex chars, and mixed/uppercase case", () => {
  assert.throws(() => encodeHeaderAD({ dh: DH_HEX.slice(0, -2), n: 0, pn: 0 }), /64 hex chars/);
  assert.throws(() => encodeHeaderAD({ dh: "zz".repeat(32), n: 0, pn: 0 }));
  assert.throws(() => encodeHeaderAD({ dh: "AA".repeat(32), n: 0, pn: 0 }), /lowercase/);
  assert.throws(() => encodeHeaderAD({ dh: DH_HEX, n: 0, pn: 0, pqPub: PQPUB_HEX.slice(0, -2) }));
  assert.throws(() => encodeHeaderAD({ dh: DH_HEX, n: 0, pn: 0, pqCt: "AA" + PQCT_HEX.slice(2) }));
});
