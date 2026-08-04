#!/usr/bin/env node
/**
 * check-disappearing-messages.mjs
 *
 * Guards the v4 sealed-envelope disappearing-message semantics:
 *
 *   1. TTL travels INSIDE the encrypted payload (`x`) — wrapPayload embeds
 *      it, unwrapPayload recovers it, and a reaction envelope never carries
 *      one.
 *   2. The sender-generated stable message id (`i`) round-trips verbatim, so
 *      both devices agree on one id.
 *   3. expiresAt is only ever set AFTER a message is actually viewed:
 *      markMessagesViewed derives it from viewedAt + ttlMs, and neither
 *      receive path (established session or X3DH bootstrap) stamps expiresAt
 *      when constructing an incoming message.
 *   4. Duplicate reaction delivery is idempotent — applyReaction SETS
 *      membership from explicit intent, never toggles, so a retried/replayed
 *      envelope cannot silently reverse a reaction.
 *   5. An incoming id colliding with an existing message never clobbers it —
 *      both receive paths carry an id-collision guard.
 *
 * Runs the REAL wrapPayload / unwrapPayload / applyReaction / isValidAttachment
 * from context/AppContext.tsx by extracting them from source and transpiling
 * at runtime (the repo has no JS test runner), plus source-level checks for
 * the state-update paths that live inside the React component.
 *
 * Exit 0 → semantics intact, Exit 1 → violation.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ghostDir = path.resolve(__dirname, "..");
const appCtxPath = path.join(ghostDir, "context", "AppContext.tsx");
const chatPath = path.join(ghostDir, "app", "chat", "[id].tsx");

const src = fs.readFileSync(appCtxPath, "utf8");
const chatSrc = fs.readFileSync(chatPath, "utf8");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures += 1;
  }
}

// ── Extract the pure top-level pieces from AppContext.tsx ────────────────────
function extractFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name} not found in AppContext.tsx`);
  // The function BODY's opening brace is the first `{` at paren depth 0
  // outside any brace nesting (type literals in the param list live inside
  // parens; a return-type object literal is brace-balanced before the body).
  // From there, plain brace counting finds the end of the declaration.
  let parenDepth = 0;
  let braceDepth = 0;
  let bodyStart = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") parenDepth += 1;
    else if (ch === ")") parenDepth -= 1;
    else if (ch === "{") {
      braceDepth += 1;
      if (bodyStart === -1 && parenDepth === 0) {
        // A return-type object literal also matches here; the real body is
        // the one NOT followed (after balancing) by more signature text.
        // Distinguish: the body brace is preceded (ignoring whitespace) by
        // `)` or a simple return-type keyword line ending in `{`, and the
        // preceding non-space char is not `:`.
        const before = src.slice(start, i).trimEnd();
        if (!before.endsWith(":")) bodyStart = i;
      }
    } else if (ch === "}") {
      braceDepth -= 1;
      if (bodyStart !== -1 && braceDepth === 0) return src.slice(start, i + 1) + "\n";
    }
  }
  throw new Error(`end of function ${name} not found`);
}
function extractConst(name) {
  const re = new RegExp(`^(?:export )?const ${name}(?:\\s*:[^=\\n]*)?\\s*=.*;\\s*$`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`const ${name} not found in AppContext.tsx`);
  return m[0].replace(/^export /, "");
}

const consts = [
  "ATTACHMENT_ENVELOPE_VERSION",
  "ATTACHMENT_ENVELOPE_PREFIX",
  "SEALED_ENVELOPE_VERSION",
  "SEALED_ENVELOPE_PREFIX",
  "DATA_IMAGE_URI_RE",
  "DATA_AUDIO_URI_RE",
  "DATA_FILE_URI_RE",
  "MAX_ATTACHMENT_NAME_LEN",
  "MAX_ATTACHMENT_B64_CHARS",
  "BLOB_ID_RE",
  "BLOB_KEY_RE",
  "IMAGE_MIME_RE",
].map(extractConst);

const fns = ["isValidAttachment", "wrapPayload", "unwrapPayload", "applyReaction"].map(
  extractFunction,
);

const snippet =
  consts.join("\n") +
  "\n" +
  fns.join("\n") +
  "\nexport { wrapPayload, unwrapPayload, applyReaction, isValidAttachment, SEALED_ENVELOPE_VERSION };\n";

const transpiled = ts.transpileModule(snippet, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;

const tmp = path.join(ghostDir, "context", `.disappearing_check_${process.pid}.mjs`);
fs.writeFileSync(tmp, transpiled);
let mod;
try {
  mod = await import(`${tmp}?t=${Date.now()}`);
} finally {
  fs.unlinkSync(tmp);
}
const { wrapPayload, unwrapPayload, applyReaction } = mod;

// ── 1. TTL travels inside the envelope ───────────────────────────────────────
console.log("\n[1] TTL travels inside the encrypted envelope (`x`)");
{
  const wire = wrapPayload("ALICE", "msg-1", "hello", undefined, 30_000);
  const parsed = JSON.parse(wire);
  assert(parsed._gf === mod.SEALED_ENVELOPE_VERSION, "envelope is v" + mod.SEALED_ENVELOPE_VERSION);
  assert(parsed.x === 30_000, "TTL embedded as `x` (duration in ms)");
  const un = unwrapPayload(wire);
  assert(un.ttlMs === 30_000, "unwrapPayload recovers ttlMs");
  assert(un.from === "ALICE" && un.text === "hello", "sender + body recovered");

  const noTtl = JSON.parse(wrapPayload("ALICE", "msg-2", "hi"));
  assert(!("x" in noTtl), "no `x` field when no timer applies");
  assert(unwrapPayload(JSON.stringify(noTtl)).ttlMs === undefined, "no ttlMs recovered when absent");

  // A reaction envelope never carries a TTL, even if one is passed.
  const rWire = wrapPayload("ALICE", "rid-1", "ignored", undefined, 30_000, {
    m: "msg-1",
    e: "🔥",
    o: true,
  });
  const rParsed = JSON.parse(rWire);
  assert(!("x" in rParsed), "reaction envelope carries no `x`");
  assert(rParsed.t === "", "reaction envelope forces empty text");
  const rUn = unwrapPayload(rWire);
  assert(
    rUn.reaction && rUn.reaction.m === "msg-1" && rUn.reaction.e === "🔥" && rUn.reaction.o === true,
    "reaction target/emoji/intent round-trip",
  );

  // Malformed TTLs are rejected (falls back to plain text).
  const bad = JSON.stringify({ _gf: mod.SEALED_ENVELOPE_VERSION, f: "A", i: "x", t: "y", x: -5 });
  assert(unwrapPayload(bad).ttlMs === undefined, "non-positive `x` rejected");
}

// ── 2. Sender-generated id round-trips ───────────────────────────────────────
console.log("\n[2] Sender-generated stable message id round-trips");
{
  const id = "1754300000000abc123def";
  const un = unwrapPayload(wrapPayload("BOB", id, "yo"));
  assert(un.id === id, "receiver recovers the sender's id verbatim");
  const noId = JSON.stringify({ _gf: mod.SEALED_ENVELOPE_VERSION, f: "A", t: "y" });
  assert(unwrapPayload(noId).id === undefined, "envelope missing `i` rejected (no id trusted)");
}

// ── 3. expiresAt only after viewing ──────────────────────────────────────────
console.log("\n[3] expiresAt is only set after the message is viewed");
{
  // markMessagesViewed derives expiresAt from viewedAt + ttlMs and skips
  // already-viewed messages.
  assert(
    /expiresAt:\s*viewedAt\s*\+\s*m\.ttlMs/.test(src),
    "markMessagesViewed derives expiresAt = viewedAt + ttlMs",
  );
  assert(
    /if\s*\(!idSet\.has\(m\.id\)\s*\|\|\s*!m\.ttlMs\s*\|\|\s*m\.viewedAt\)\s*return m;/.test(src),
    "markMessagesViewed is idempotent (skips already-viewed / no-TTL messages)",
  );

  // Neither incoming-message constructor stamps expiresAt; they only carry
  // the envelope TTL. Find every `ttlMs: unwrapped*.ttlMs` message spread and
  // verify no expiresAt appears in the same object literal.
  const incomingSpreads = src.match(/\.\.\.\((unwrapped|unwrappedFirst)\.ttlMs \? \{ ttlMs: \1\.ttlMs \} : \{\}\),/g) || [];
  assert(incomingSpreads.length >= 2, "both receive paths adopt TTL from the envelope (found " + incomingSpreads.length + ")");
  for (const spread of incomingSpreads) {
    const idx = src.indexOf(spread);
    // Look back to the start of the object literal this spread belongs to.
    const objStart = src.lastIndexOf(": Message = {", idx);
    const block = src.slice(objStart, idx + spread.length);
    assert(!/expiresAt/.test(block.replace(/\/\/[^\n]*/g, "")), "incoming message constructor sets no expiresAt");
  }

  // Reaction receipt never starts the timer.
  assert(
    (src.match(/Never touches viewedAt\/expiresAt/g) || []).length >= 2 &&
      !/applyReaction\([^)]*\)[^}]*expiresAt/.test(src),
    "reaction receipt paths never touch viewedAt/expiresAt",
  );

  // Chat screen actually stamps viewedAt for visible TTL'd messages.
  assert(
    /m\.ttlMs && !m\.viewedAt/.test(chatSrc) && /markMessagesViewed\(/.test(chatSrc),
    "chat screen stamps viewedAt via markMessagesViewed for unviewed TTL messages",
  );
}

// ── 4. Duplicate reaction delivery is idempotent ─────────────────────────────
console.log("\n[4] Duplicate reaction delivery doesn't toggle");
{
  const r1 = applyReaction(undefined, "🔥", "ALICE", true);
  assert(r1 && r1["🔥"].includes("ALICE"), "add sets membership");
  const r2 = applyReaction(r1, "🔥", "ALICE", true);
  assert(r2 === r1, "duplicate add is a no-op (same reference)");
  const r3 = applyReaction(r2, "🔥", "ALICE", false);
  assert(r3 === undefined, "remove clears membership (and empty map collapses)");
  const r4 = applyReaction(r3, "🔥", "ALICE", false);
  assert(r4 === undefined, "duplicate remove is a no-op");
  const multi = applyReaction(applyReaction(undefined, "🔥", "ALICE", true), "🔥", "BOB", true);
  const afterDup = applyReaction(multi, "🔥", "BOB", true);
  assert(afterDup === multi && afterDup["🔥"].length === 2, "replay never flips another alias's state");

  // Receive paths pass explicit intent (`o`) straight through — no toggling.
  const receiveUses = src.match(/applyReaction\(m\.reactions,\s*emoji,\s*[^,]+,\s*add\)/g) || [];
  assert(receiveUses.length >= 2, "receive paths apply explicit envelope intent, not a toggle");
}

// ── 5. ID collisions never clobber existing messages ────────────────────────
console.log("\n[5] Incoming id collisions never clobber existing messages");
{
  assert(
    /unwrapped\.id && conv\.messages\.some\(\(m\) => m\.id === unwrapped\.id\)/.test(src),
    "established-session path drops colliding incoming ids (ratchet still commits)",
  );
  assert(
    /unwrappedFirst\.id && alreadyExists\.messages\.some\(\(m\) => m\.id === unwrappedFirst\.id\)/.test(src),
    "bootstrap path drops colliding incoming ids (session still commits)",
  );
  // Receiver adopts the sender id rather than minting its own.
  assert(
    /id:\s*unwrapped\.id \?\?/.test(src) && /id:\s*unwrappedFirst\.id \?\?/.test(src),
    "receiver adopts the sender-generated id on both paths",
  );
}

console.log("");
if (failures > 0) {
  console.error(`FAILED: ${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("All disappearing-message checks passed.");
