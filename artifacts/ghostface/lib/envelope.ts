// Message-envelope layer, extracted verbatim from context/AppContext.tsx.
// Pure (no React/React Native imports) so it can be unit-tested directly.
// The sealed-sender wire format and its validation rules live here;
// AppContext re-exports the public pieces to keep its import surface stable.

export type Attachment =
  | {
      kind: "image";
      uri: string;
      width?: number;
      height?: number;
      mimeType?: string;
    }
  | {
      // Photo stored as an encrypted blob on the server. The wire envelope
      // carries only `blobId` + per-blob symmetric `key`; the receiver
      // fetches and decrypts the bytes locally before rendering. `uri` is
      // local-only (sender's preview before send, or receiver's decrypted
      // cache) and is stripped by `wrapPayload`.
      kind: "image-ref";
      blobId: string;
      key: string;
      mimeType?: string;
      width?: number;
      height?: number;
      uri?: string;
    }
  | {
      kind: "file";
      uri: string;
      name: string;
      size?: number;
      mimeType?: string;
    }
  | {
      kind: "audio";
      uri: string;
      durationMs?: number;
      mimeType?: string;
    };

// Legacy attachment envelope (v1) — carried no sender. Still parsed on receive
// for backward compatibility, but never emitted anymore.
const ATTACHMENT_ENVELOPE_VERSION = 1;
const ATTACHMENT_ENVELOPE_PREFIX = `{"_gfa":${ATTACHMENT_ENVELOPE_VERSION}`;

// Sealed-sender envelope (v4). Every outgoing message is now wrapped in this
// envelope BEFORE encryption so the sender's alias travels only inside the
// ciphertext — never as a plaintext wire field or stored column. The receiver
// recovers the sender after a successful decrypt (`f`). `t` is the text body,
// `a` an optional attachment.
//
// v3 added `x` — the disappearing-message TTL in ms, sender-authoritative.
// It's a DURATION, never an absolute timestamp: absolute timestamps would
// leak/rely on clock-skew between the two devices. The receiver starts its
// own local expiry countdown from `x` only once the message is actually
// viewed (see `markMessagesViewed`); the sender starts its own copy's
// countdown at send time.
//
// v4 adds:
//   `i` — sender-generated stable message id, REQUIRED. Sender and receiver
//   previously minted independent ids for the same logical message; the
//   receiver now adopts `i` verbatim instead of minting its own, so both
//   sides agree on one id (needed for reactions to target a message, and for
//   read/delete state to mean the same thing on both devices).
//
//   `r` — a reaction: `{ m: target message id, e: emoji, o: true=add /
//   false=remove }`. Explicit intent, not a toggle: the receiver SETS
//   membership from `o` and must never flip/toggle on receipt, or a
//   duplicate delivery (retry, outbox replay) would silently reverse the
//   reaction. `t` is forced to "" whenever `r` is present, and a reaction
//   envelope carries no `a`/`x` — it isn't rendered as a message at all (see
//   the reaction branch in the WS receive handlers).
//
// Hard version bump, no v3 compat shim: `unwrapPayload` gates on an exact
// `_gf === SEALED_ENVELOPE_VERSION` match (via the version-stamped prefix
// below), so a v3-only build receiving a v4 envelope fails the prefix check
// and falls through to the plain-text branch rather than partially trusting
// a v4 envelope it doesn't understand — it never silently drops just the
// id-agreement/reaction semantics while rendering the rest normally.
const SEALED_ENVELOPE_VERSION = 4;
const SEALED_ENVELOPE_PREFIX = `{"_gf":${SEALED_ENVELOPE_VERSION}`;

interface SealedEnvelope {
  _gf: number;
  f: string;
  /** Sender-generated stable message id. Meaningless/unused for a reaction envelope. */
  i: string;
  t: string;
  a?: Attachment;
  /** Disappearing-message TTL in ms. Omitted entirely when no timer applies. */
  x?: number;
  /** Reaction: target message id, emoji, and explicit add(true)/remove(false) intent. */
  r?: { m: string; e: string; o: boolean };
  /** Profile photo control message: a small `data:image/jpeg;base64,...` avatar
   *  (or "" to clear). When present this is a silent control message — never
   *  rendered as a Message; the recipient stores it as this contact's avatar. */
  p?: string;
}

export function wrapPayload(
  from: string,
  id: string,
  text: string,
  attachment?: Attachment,
  ttlMs?: number,
  reaction?: { m: string; e: string; o: boolean },
  profilePhoto?: string,
): string {
  // A reaction OR a profile-photo update is a control message: no text body,
  // no attachment, no disappear timer.
  const isControl = !!reaction || profilePhoto !== undefined;
  // image-ref carries a local-only `uri` for the sender's own preview that
  // must NOT be sent over the wire — strip it so the recipient only ever
  // sees the blob reference + key. Not applicable to a reaction, which
  // carries no attachment.
  let wireAttachment: Attachment | undefined;
  if (!isControl && attachment) {
    if (attachment.kind === "image-ref") {
      const { kind, blobId, key, mimeType, width, height } = attachment;
      wireAttachment = { kind, blobId, key, mimeType, width, height };
    } else {
      wireAttachment = attachment;
    }
  }
  const env: SealedEnvelope = { _gf: SEALED_ENVELOPE_VERSION, f: from, i: id, t: isControl ? "" : text };
  if (wireAttachment) env.a = wireAttachment;
  if (!isControl && ttlMs) env.x = ttlMs;
  if (reaction) env.r = reaction;
  if (profilePhoto !== undefined) env.p = profilePhoto;
  return JSON.stringify(env);
}

// Only allow inline base64 data URIs as attachment payloads. This is the
// only transport we control end-to-end through E2EE — any other URI scheme
// (http(s), file, content) would either leak the recipient's IP via a silent
// network fetch when rendered or reference attacker-controlled local
// content. Reject anything else as plain text rather than render it.
const DATA_IMAGE_URI_RE = /^data:image\/(png|jpe?g|gif|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/i;
const DATA_AUDIO_URI_RE = /^data:audio\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i;
const DATA_FILE_URI_RE  = /^data:[a-zA-Z0-9.+/-]+;base64,[A-Za-z0-9+/=]+$/i;
const MAX_ATTACHMENT_NAME_LEN = 200;
// Hard cap on the base64-encoded payload of any attachment. 5 MiB decoded is
// ~6.99 MiB encoded; we round up to 7.5 MiB of base64 chars to leave a small
// margin and still bound memory/decode work. Anything larger is rejected at
// validation time (both on send and on receive) so a malicious peer cannot
// force the client to decode an arbitrarily large blob.
export const MAX_ATTACHMENT_B64_CHARS = 7 * 1024 * 1024 + 512 * 1024;

// Profile-photo avatars are resized to ~128px JPEG (a few KB); cap the E2E
// data URI generously at 400 KB of base64 so a peer cannot ship a huge image.
export const MAX_PROFILE_PHOTO_CHARS = 400 * 1024;

// Validates a blob reference for the image-ref attachment kind.
const BLOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BLOB_KEY_RE = /^[0-9a-f]{64}$/i;
const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|heic|heif)$/i;

export function isValidAttachment(a: unknown): a is Attachment {
  if (!a || typeof a !== "object") return false;
  const att = a as Record<string, unknown>;

  // image-ref carries blob references instead of an inline data URI.
  if (att.kind === "image-ref") {
    if (typeof att.blobId !== "string" || !BLOB_ID_RE.test(att.blobId)) return false;
    if (typeof att.key !== "string" || !BLOB_KEY_RE.test(att.key)) return false;
    if (att.mimeType !== undefined) {
      if (typeof att.mimeType !== "string" || !IMAGE_MIME_RE.test(att.mimeType)) return false;
    }
    if (att.width !== undefined && typeof att.width !== "number") return false;
    if (att.height !== undefined && typeof att.height !== "number") return false;
    // `uri` is local-only for the sender's preview. A wire payload that
    // contains it is malformed — and if we silently accepted it, a peer
    // could inject any URL (e.g. https://attacker.example/track.png) and
    // force <Image> to fetch it on the receiver, leaking IP/metadata. So
    // any incoming `uri` field is a hard reject; the sender's own copy
    // already passed through `wrapPayload`, which strips it on its way
    // out and never re-runs validation.
    if (att.uri !== undefined) return false;
    return true;
  }

  if (typeof att.uri !== "string") return false;
  if (att.uri.length > MAX_ATTACHMENT_B64_CHARS) return false;
  if (att.mimeType !== undefined && typeof att.mimeType !== "string") return false;

  if (att.kind === "image") {
    if (!DATA_IMAGE_URI_RE.test(att.uri)) return false;
    if (att.width !== undefined && typeof att.width !== "number") return false;
    if (att.height !== undefined && typeof att.height !== "number") return false;
    return true;
  }
  if (att.kind === "audio") {
    if (!DATA_AUDIO_URI_RE.test(att.uri)) return false;
    if (att.durationMs !== undefined && typeof att.durationMs !== "number") return false;
    return true;
  }
  if (att.kind === "file") {
    if (!DATA_FILE_URI_RE.test(att.uri)) return false;
    if (typeof att.name !== "string" || att.name.length === 0 || att.name.length > MAX_ATTACHMENT_NAME_LEN) return false;
    if (att.size !== undefined && typeof att.size !== "number") return false;
    return true;
  }
  return false;
}

export function unwrapPayload(plaintext: string): {
  text: string;
  attachment?: Attachment;
  from?: string;
  ttlMs?: number;
  /** Sender-generated stable message id. Absent only for a non-v4/malformed
   *  payload falling through to the plain-text branch — there's nothing to
   *  recover an id from in that case. */
  id?: string;
  reaction?: { m: string; e: string; o: boolean };
  /** Present for a profile-photo control message: a data:image/jpeg URI, or ""
   *  to clear. Distinct from `undefined` (no profile-photo field at all). */
  profilePhoto?: string;
} {
  // v4 sealed-sender envelope — recovers the sender alias (`f`), stable
  // message id (`i`), body, optional attachment, optional disappearing TTL
  // (`x`), and optional reaction (`r`). This is the only format emitted now.
  if (plaintext.startsWith(SEALED_ENVELOPE_PREFIX)) {
    try {
      const parsed = JSON.parse(plaintext) as {
        _gf?: unknown; f?: unknown; i?: unknown; t?: unknown; a?: unknown; x?: unknown;
        r?: { m?: unknown; e?: unknown; o?: unknown }; p?: unknown;
      };
      const reactionOk =
        parsed.r === undefined ||
        (typeof parsed.r.m === "string" && typeof parsed.r.e === "string" && typeof parsed.r.o === "boolean");
      const photoOk =
        parsed.p === undefined ||
        (typeof parsed.p === "string" &&
          (parsed.p === "" ||
            (parsed.p.length <= MAX_PROFILE_PHOTO_CHARS && DATA_IMAGE_URI_RE.test(parsed.p))));
      if (
        parsed._gf === SEALED_ENVELOPE_VERSION &&
        typeof parsed.f === "string" &&
        typeof parsed.i === "string" &&
        typeof parsed.t === "string" &&
        (parsed.a === undefined || isValidAttachment(parsed.a)) &&
        (parsed.x === undefined || (typeof parsed.x === "number" && parsed.x > 0)) &&
        reactionOk &&
        photoOk
      ) {
        return {
          text: parsed.t,
          from: parsed.f,
          id: parsed.i,
          ...(parsed.a !== undefined ? { attachment: parsed.a as Attachment } : {}),
          ...(parsed.x !== undefined ? { ttlMs: parsed.x as number } : {}),
          ...(parsed.r !== undefined ? { reaction: parsed.r as { m: string; e: string; o: boolean } } : {}),
          ...(parsed.p !== undefined ? { profilePhoto: parsed.p as string } : {}),
        };
      }
    } catch {
      // fall through — treat as plain text
    }
    return { text: plaintext };
  }
  // v1 legacy attachment envelope (no sender). Retained for back-compat.
  if (plaintext.startsWith(ATTACHMENT_ENVELOPE_PREFIX)) {
    try {
      const parsed = JSON.parse(plaintext) as { _gfa?: unknown; t?: unknown; a?: unknown };
      // Strict schema: any deviation falls back to plain text so legitimate
      // user-typed JSON cannot be reinterpreted as an attachment envelope.
      if (
        parsed._gfa === ATTACHMENT_ENVELOPE_VERSION &&
        typeof parsed.t === "string" &&
        isValidAttachment(parsed.a)
      ) {
        return { text: parsed.t, attachment: parsed.a };
      }
    } catch {
      // fall through — treat as plain text
    }
  }
  return { text: plaintext };
}

/**
 * Pure: set or clear `alias` in `reactions[emoji]`. Never a toggle — the
 * caller decides add vs remove. On receive, `add` comes directly from the
 * envelope's `o` (explicit intent); toggling here based on prior presence
 * would let a duplicate/retried delivery silently reverse the reaction. The
 * sender's UI computes `add` itself (by checking its own current state)
 * before calling this for its local optimistic update.
 */
export function applyReaction(
  reactions: Record<string, string[]> | undefined,
  emoji: string,
  alias: string,
  add: boolean,
): Record<string, string[]> | undefined {
  const current = reactions?.[emoji] ?? [];
  const has = current.includes(alias);
  if (add === has) return reactions;
  const nextList = add ? [...current, alias] : current.filter((a) => a !== alias);
  const next = { ...(reactions ?? {}) };
  if (nextList.length === 0) delete next[emoji];
  else next[emoji] = nextList;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function previewForMessage(text: string, attachment?: Attachment): string {
  if (text && text.trim()) return text;
  if (!attachment) return text;
  if (attachment.kind === "image" || attachment.kind === "image-ref") return "📷 Photo";
  if (attachment.kind === "audio") return "🎙 Voice note";
  if (attachment.kind === "file") return `📎 ${attachment.name}`;
  return text;
}
