import { evaluateExpiredHandshake } from "@/lib/expiry";
import { readEncryptedString, writeEncryptedString } from "@/lib/secureStorage";
import { getApiBase } from "@/lib/apiBase";
import {
  DEVICE_TOKEN_KEY,
  secureGet,
  secureSet,
  secureDelete,
} from "@/lib/deviceAuth";
import { normalizeAlias } from "@/utils/alias";
import { notifyCallEnded } from "@/hooks/usePushNotifications";
import { markCallEnded } from "@/lib/endedCalls";
export { getApiBase } from "@/lib/apiBase";
import {
  classifyLinkQuality,
  isLowBandwidthActive,
  wsPingIntervalMs,
  wsReconnectDelayMs,
  outboxDrainDebounceMs,
  compressFrameIfBeneficial,
  LBW_ATTACHMENT_REFUSAL_REASON,
  type LinkQuality,
  type LinkStats,
  type LowBandwidthMode,
} from "@/lib/lowBandwidth";
import {
  backoffDelayMs,
  earliestDeferredAt,
  sortByCompose,
} from "@/lib/outbox";
import {
  DEFAULT_SMS_FALLBACK_MESSAGE,
  MAX_SMS_FALLBACK_NUMBERS,
  handoffSmsFallback,
  normalizeE164,
  parseStoredNumbers,
  sanitizeFallbackMessage,
} from "@/lib/smsFallback";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Notifications from "expo-notifications";
import { Alert, AppState as RNAppState } from "react-native";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  generateSafetyNumber,
} from "@/lib/crypto";
import {
  initSessionAliceWithHeader,
  initSessionBobFromHeader,
  generateOneTimePreKeys,
  generateKemKeyPair,
  signKemPreKey,
  ratchetEncrypt,
  ratchetDecrypt,
  isValidDRSession,
  PqDowngradeError,
  type DRSession,
  type PreKeyBundle,
  type X3DHHeader,
  type RatchetMessage,
} from "@/lib/doubleRatchet";
import { x25519, ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@/lib/csprng";
import { keyToRecoveryPhrase, recoveryPhraseToKey } from "@/lib/recoveryPhrase";
// Stricter than the regex this file used to carry: verifies the address
// actually base58-decodes to 32 bytes, so a well-formed-looking string of the
// right length but wrong decoded size can't be linked as a wallet.
import { isValidSolanaAddress } from "@/lib/base58";
import {
  createWallet,
  walletFromPhrase,
  walletFromPrivateKeyHex,
  isValidWalletPhrase,
} from "@/lib/solanaWallet";

const toHex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/.{2}/g)!.map(b => parseInt(b, 16)));

function generateHexKeypair(): { pub: string; priv: string } {
  const priv = randomBytes(32);
  const pub  = x25519.getPublicKey(priv);
  return { pub: toHex(pub), priv: toHex(priv) };
}

function generateEd25519Keypair(): { pub: string; priv: string } {
  const priv = randomBytes(32);
  const pub  = ed25519.getPublicKey(priv);
  return { pub: toHex(pub), priv: toHex(priv) };
}

function signSPKLocal(spkPubHex: string, ikSignPrivHex: string): string {
  const fromHex = (h: string) => Uint8Array.from(h.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const sig = ed25519.sign(fromHex(spkPubHex), fromHex(ikSignPrivHex));
  return toHex(sig);
}

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

export interface Message {
  id: string;
  text: string;
  fromMe: boolean;
  timestamp: number;
  encrypted: boolean;
  sealed: boolean;
  ciphertext?: string;
  fingerprint?: string;
  /**
   * Disappearing-message duration in ms, sender-authoritative — travels
   * inside the encrypted envelope (`SealedEnvelope.x`). Present on both
   * sender's and receiver's copies once a disappear timer applies. Absent
   * `expiresAt` alongside a present `ttlMs` means "not yet viewed" on the
   * receiver's side — the timer hasn't started.
   */
  ttlMs?: number;
  /** Local receipt of the first view. Stamped once, on first render. */
  viewedAt?: number;
  expiresAt?: number;
  pending?: boolean;
  failed?: boolean;
  attachment?: Attachment;
  /**
   * Non-user system event injected into the timeline (e.g. peer self-
   * destructed, invite/key material expired). Rendered as a centered,
   * muted notice — never long-pressable, never editable, never re-sent.
   */
  system?: boolean;
  /**
   * emoji -> reactor aliases. Applying/removing a reaction never touches
   * this message's `viewedAt`/`expiresAt` — a reaction on an unviewed
   * disappearing message must not start its timer (see the reaction
   * branches in the WS receive handlers and `sendReaction`).
   */
  reactions?: Record<string, string[]>;
}

export interface OutboxItem {
  id: string;
  conversationId: string;
  text: string;
  attempts?: number;
  attachment?: Attachment;
  /**
   * Original compose timestamp (ms since epoch). Drives the ordering
   * invariant — drainOutbox always processes oldest-composed first,
   * regardless of how many times any individual item has been retried.
   * Set when the item is first pushed onto the outbox; never mutated.
   */
  createdAt: number;
  /**
   * Earliest moment (ms since epoch) at which this item should next be
   * attempted. Set after a delivery failure to the exponential-backoff
   * computed time. The drain loop skips items whose nextAttemptAt is in
   * the future and reschedules the timer accordingly. Absent → "drain
   * immediately when the loop reaches this item."
   */
  nextAttemptAt?: number;
  /**
   * Present only for a queued reaction send — mutually exclusive with real
   * message content (`text` is "" alongside this). Lets drainOutbox build a
   * reaction envelope instead of a text envelope at actual send time, while
   * reusing all the same backoff/retry/ordering machinery as text messages.
   */
  reaction?: { m: string; e: string; o: boolean };
}

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
}

function wrapPayload(
  from: string,
  id: string,
  text: string,
  attachment?: Attachment,
  ttlMs?: number,
  reaction?: { m: string; e: string; o: boolean },
): string {
  // image-ref carries a local-only `uri` for the sender's own preview that
  // must NOT be sent over the wire — strip it so the recipient only ever
  // sees the blob reference + key. Not applicable to a reaction, which
  // carries no attachment.
  let wireAttachment: Attachment | undefined;
  if (!reaction && attachment) {
    if (attachment.kind === "image-ref") {
      const { kind, blobId, key, mimeType, width, height } = attachment;
      wireAttachment = { kind, blobId, key, mimeType, width, height };
    } else {
      wireAttachment = attachment;
    }
  }
  const env: SealedEnvelope = { _gf: SEALED_ENVELOPE_VERSION, f: from, i: id, t: reaction ? "" : text };
  if (wireAttachment) env.a = wireAttachment;
  if (!reaction && ttlMs) env.x = ttlMs;
  if (reaction) env.r = reaction;
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

// Validates a blob reference for the image-ref attachment kind.
const BLOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BLOB_KEY_RE = /^[0-9a-f]{64}$/i;
const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|heic|heif)$/i;

function isValidAttachment(a: unknown): a is Attachment {
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

function unwrapPayload(plaintext: string): {
  text: string;
  attachment?: Attachment;
  from?: string;
  ttlMs?: number;
  /** Sender-generated stable message id. Absent only for a non-v4/malformed
   *  payload falling through to the plain-text branch — there's nothing to
   *  recover an id from in that case. */
  id?: string;
  reaction?: { m: string; e: string; o: boolean };
} {
  // v4 sealed-sender envelope — recovers the sender alias (`f`), stable
  // message id (`i`), body, optional attachment, optional disappearing TTL
  // (`x`), and optional reaction (`r`). This is the only format emitted now.
  if (plaintext.startsWith(SEALED_ENVELOPE_PREFIX)) {
    try {
      const parsed = JSON.parse(plaintext) as {
        _gf?: unknown; f?: unknown; i?: unknown; t?: unknown; a?: unknown; x?: unknown;
        r?: { m?: unknown; e?: unknown; o?: unknown };
      };
      const reactionOk =
        parsed.r === undefined ||
        (typeof parsed.r.m === "string" && typeof parsed.r.e === "string" && typeof parsed.r.o === "boolean");
      if (
        parsed._gf === SEALED_ENVELOPE_VERSION &&
        typeof parsed.f === "string" &&
        typeof parsed.i === "string" &&
        typeof parsed.t === "string" &&
        (parsed.a === undefined || isValidAttachment(parsed.a)) &&
        (parsed.x === undefined || (typeof parsed.x === "number" && parsed.x > 0)) &&
        reactionOk
      ) {
        return {
          text: parsed.t,
          from: parsed.f,
          id: parsed.i,
          ...(parsed.a !== undefined ? { attachment: parsed.a as Attachment } : {}),
          ...(parsed.x !== undefined ? { ttlMs: parsed.x as number } : {}),
          ...(parsed.r !== undefined ? { reaction: parsed.r as { m: string; e: string; o: boolean } } : {}),
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
function applyReaction(
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

function previewForMessage(text: string, attachment?: Attachment): string {
  if (text && text.trim()) return text;
  if (!attachment) return text;
  if (attachment.kind === "image" || attachment.kind === "image-ref") return "📷 Photo";
  if (attachment.kind === "audio") return "🎙 Voice note";
  if (attachment.kind === "file") return `📎 ${attachment.name}`;
  return text;
}

export interface Conversation {
  id: string;
  alias: string;
  lastMessage: string;
  timestamp: number;
  unread: number;
  messages: Message[];
  /**
   * This device's own default disappear-timer for messages it SENDS in this
   * conversation — travels to the peer inside each envelope as `ttlMs`, not
   * as a standing setting. Purely local and one-directional: it has no
   * effect on incoming messages, whose TTL comes from their own envelope.
   */
  disappearAfterSec?: number;
  /**
   * Local chat wallpaper choice, from CHAT_COLOR_PALETTE (lib/chatColors.ts).
   * `undefined` renders as the app default. Purely device-local — never
   * enters wrapPayload/unwrapPayload or any envelope; a Conversation object
   * is never serialized onto the wire anywhere in this codebase.
   */
  bgColor?: string;
  /**
   * Custom chat wallpaper photo — a file:// URI under the app's own
   * documentDirectory (chat-bg/), copied there at pick time so the image
   * picker's cache URI can't dangle. Mutually exclusive with bgColor.
   * Device-local like bgColor and never transmitted — but note: the image
   * FILE itself lives app-sandboxed yet UNENCRYPTED, unlike the
   * conversation blob. Acceptable for a wallpaper; never reuse this
   * pattern for message content.
   */
  bgImageUri?: string;
  safetyNumber?: string;
  drSession?: DRSession;
  pendingX3DHHeader?: string;
  isRealContact?: boolean;
  verified?: boolean;
  /**
   * Opaque per-recipient routing token (task #128). Messages are addressed to
   * this instead of the human alias so the server never sees who is talking to
   * whom. Captured from the prekey bundle when we initiate, or lazily resolved
   * via /users/exists when we're the replying side of an inbound session.
   */
  recipientDeliveryId?: string;
  /**
   * Set when the peer self-destructed (broadcast a "departed" notice via the
   * server before wiping locally) or their invite/key material has expired
   * with no successful exchange. UI shows a "SELF-DESTRUCTED" badge,
   * disables the composer, and renders a system message in chat.
   */
  destroyedAt?: number;
}

// Pure expiry predicate lives in lib/expiry.ts so it can be unit-tested
// without React Native or AsyncStorage in scope. Re-exported here to keep
// AppContext as the canonical import surface for consumers.
export { evaluateExpiredHandshake };

export interface Transaction {
  id: string;
  type: "send" | "receive";
  token: "FD" | "CASPER";
  amount: number;
  address: string;
  timestamp: number;
}

// Mirrors the shape of GET /api/tokens on the api-server — the mint address
// and network are only present once a token has actually been deployed
// on-chain (see routes/tokens.ts). Fetched live rather than hardcoded so
// the wallet screen tracks whatever's actually deployed without a client
// release every time a mint address changes.
export interface AppToken {
  id: number;
  name: string;
  symbol: string;
  decimals: number;
  mintAddress: string | null;
  network: string | null;
}

export interface VPNServer {
  id: string;
  name: string;
  country: string;
  region: string;
  shortRegion: string;
  flag: string;
}

export interface CallSignal {
  type: string;
  from: string;
  payload?: string;
  callId?: string;
  callMode?: string;
}

export interface GhostpadSignal {
  type: "ghostpad-created" | "ghostpad-paired" | "ghostpad-text" | "ghostpad-wipe" | "ghostpad-ended" | "ghostpad-error";
  code?: string;
  text?: string;
}

/**
 * Session identity only — code + pairing mode. Deliberately excludes the
 * live pad text (that stays per-screen and ephemeral, matching the "nothing
 * lingers" design). Lives in AppState rather than a screen-local useState so
 * a lock/unmount (share sheet, navigation away and back) doesn't strand the
 * user with a fresh idle screen after they've already shared the code.
 */
export interface GhostpadSession {
  mode: "idle" | "creating" | "joining" | "paired";
  code: string | null;
}

export interface IncomingCall {
  callId: string;
  from: string;
  mode: "voice" | "video";
}

/**
 * Local call-history record. Purely device-side, like Conversation — this
 * app is metadata-blind (the server never learns who called whom), so each
 * device builds its own log from the WebRTC signals it directly observed.
 * A caller and callee therefore each get their own independent entry for
 * the same call, not a shared/synced one.
 */
export interface CallLogEntry {
  id: string;
  alias: string;
  direction: "incoming" | "outgoing";
  mode: "voice" | "video";
  outcome: "answered" | "missed" | "declined";
  timestamp: number;
  durationSec?: number;
  /** Cleared when the user views the Calls tab; drives the missed-call badge. */
  seen: boolean;
}

interface AppState {
  alias: string | null;
  deviceToken: string | null;
  /**
   * Active paid-plan entitlement, verified on-chain (Task #133). `null` while
   * on the free tier or once a paid term has lapsed. `activeUntil` is epoch ms.
   */
  activePlan: { plan: string; activeUntil: number } | null;
  biometricEnabled: boolean;
  isLocked: boolean;
  isOnboarded: boolean;
  vpnConnected: boolean;
  vpnServer: VPNServer | null;
  conversations: Conversation[];
  callHistory: CallLogEntry[];
  fdBalance: number;
  casperBalance: number;
  appTokens: AppToken[];
  /**
   * The device's own non-custodial Solana address, or null when no wallet has
   * been created yet. Null is the honest default — this used to hold a
   * hardcoded "GhFc3...x9mKr4" placeholder that users could copy and hand out
   * as a receive address, sending real funds nowhere.
   */
  walletAddress: string | null;
  transactions: Transaction[];
  connectedWalletAddress: string | null;
  solBalance: number;
  autoLockTimeout: number | null;
  duressGracePeriod: number;
  language: string;
  /** Manual override, not tied to the OS's system dark-mode setting. */
  themePreference: "dark" | "light";
  /**
   * Local profile photo for the identity circle in Settings — a file://
   * URI under the app's own documentDirectory (profile/), copied there at
   * pick time so the image picker's cache URI can't dangle (same pattern as
   * Conversation.bgImageUri). Device-local only: never enters an envelope,
   * never shown to contacts — other screens' avatars are keyed by the
   * OTHER party's alias, not this device's own. Wiped (state + file) on
   * panic wipe since a photo is identifying.
   */
  profileImageUri: string | null;
  incomingCall: IncomingCall | null;
  ghostpad: GhostpadSession;
  // Satellite low-bandwidth mode (Task #111). `linkQuality` is the
  // heuristically classified link state, `lowBandwidthMode` is the user
  // override (auto/forceOn/forceOff), and `lowBandwidthActive` is the
  // derived boolean that the rest of the app reads.
  linkQuality: LinkQuality;
  lowBandwidthMode: LowBandwidthMode;
  lowBandwidthActive: boolean;
  /**
   * Trusted E.164 phone numbers that receive a one-line distress SMS when
   * panicWipe/duress fires AND the WS broadcast can't be confirmed (Task
   * #113). Capped at MAX_SMS_FALLBACK_NUMBERS. Never sent over the wire;
   * persisted in SecureStore only.
   */
  smsFallbackNumbers: string[];
  /**
   * User-editable body of the SMS fallback ping. Deliberately
   * information-poor — see lib/smsFallback.ts. Persisted in SecureStore.
   */
  smsFallbackMessage: string;
}

interface AppContextType extends AppState {
  hasPin: boolean;
  hasDuressPin: boolean;
  hasDecoyPin: boolean;
  hasWalletPin: boolean;
  walletUnlocked: boolean;
  decoyMode: boolean;
  loadError: string | null;
  setAlias: (alias: string) => Promise<void>;
  recoverIdentity: (alias: string, phrase: string) => Promise<{ ok: boolean; error?: string }>;
  /** Re-derives the recovery phrase for the currently-stored identity key. Null if none. */
  getRecoveryPhrase: () => Promise<string | null>;
  setPin: (pin: string) => Promise<void>;
  checkPin: (input: string) => Promise<boolean>;
  checkDuressPin: (input: string) => Promise<boolean>;
  checkDecoyPin: (input: string) => Promise<boolean>;
  checkPinWithDuress: (input: string) => Promise<{ correct: boolean; isDuress: boolean; isDecoy: boolean }>;
  captureCurrentPinForTransition: () => Promise<void>;
  checkPreviousMainPin: (candidate: string) => Promise<boolean>;
  setDuressPin: (pin: string) => Promise<void>;
  clearDuressPin: () => Promise<void>;
  setDecoyPin: (pin: string) => Promise<void>;
  clearDecoyPin: () => Promise<void>;
  setWalletPin: (pin: string) => Promise<void>;
  checkWalletPin: (input: string) => Promise<boolean>;
  clearWalletPin: () => Promise<void>;
  enterDecoyMode: () => void;
  exitDecoyMode: () => void;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  setLocked: (locked: boolean) => void;
  connectVPN: (server: VPNServer) => void;
  disconnectVPN: () => void;
  sendMessage: (conversationId: string, text: string, attachment?: Attachment) => { queued: boolean };
  sendReaction: (conversationId: string, targetMessageId: string, emoji: string) => void;
  retryMessage: (conversationId: string, messageId: string) => void;
  addConversation: (alias: string) => Promise<{ ok: boolean; error?: string }>;
  deleteMessage: (conversationId: string, messageId: string) => void;
  clearConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  markConversationRead: (conversationId: string) => void;
  setDisappearTimer: (conversationId: string, seconds: number) => void;
  setConversationBgColor: (conversationId: string, color: string | undefined) => void;
  /** Set/clear a custom photo wallpaper (file:// URI). Clears bgColor. */
  setConversationBgImage: (conversationId: string, uri: string | undefined) => void;
  markMessagesViewed: (conversationId: string, messageIds: string[]) => void;
  verifyConversation: (conversationId: string) => void;
  panicWipe: () => Promise<void>;
  connectWallet: (address: string) => Promise<{ error?: string }>;
  disconnectWallet: () => Promise<void>;
  /**
   * Create the device's own non-custodial wallet. Returns the 24-word phrase
   * exactly once — it is never persisted, so this is the only opportunity the
   * user has to record it. Refuses if a wallet already exists.
   */
  createLocalWallet: () => Promise<{ phrase: string } | { error: string }>;
  /** Restore a wallet from its 24-word phrase, replacing any current one. */
  restoreLocalWallet: (phrase: string) => Promise<{ error?: string }>;
  refreshAppTokenBalances: () => Promise<void>;
  setAutoLockTimeout: (ms: number | null) => Promise<void>;
  setDuressGracePeriod: (seconds: number) => Promise<void>;
  setLanguage: (code: string) => Promise<void>;
  setThemePreference: (theme: "dark" | "light") => Promise<void>;
  /** Pass an already-copied documentDirectory file:// URI, or null to clear. Deletes the previous file best-effort. */
  setProfileImage: (uri: string | null) => Promise<void>;
  setLowBandwidthMode: (mode: LowBandwidthMode) => Promise<void>;
  setSmsFallbackNumbers: (numbers: string[]) => Promise<void>;
  setSmsFallbackMessage: (message: string) => Promise<void>;
  /** Re-fetch the on-chain-verified plan entitlement from the server. */
  refreshEntitlement: () => Promise<void>;
  sendCallSignal: (msg: object) => void;
  registerCallListener: (fn: ((s: CallSignal) => void) | null) => void;
  logCall: (entry: Omit<CallLogEntry, "id" | "seen">) => void;
  markCallsSeen: () => void;
  /** Wipe the call log — state and the encrypted at-rest copy. */
  clearCallHistory: () => void;
  /**
   * Forces an immediate WS reconnect attempt, bypassing the backgrounded
   * gate and any pending reconnect backoff. Used by the CallKeep "answerCall"
   * path so a call answered before the AppState "active" transition has
   * fired doesn't sit on a closed socket for the rest of that transition.
   */
  forceReconnect: () => void;
  sendGhostpadSignal: (msg: object) => void;
  registerGhostpadListener: (fn: ((s: GhostpadSignal) => void) | null) => void;
  setGhostpadMode: (mode: GhostpadSession["mode"]) => void;
  resetGhostpad: () => void;
  dismissIncomingCall: () => void;
  /** alias -> currently connected to the server. Absent key means unknown (not subscribed yet). */
  presence: Record<string, boolean>;
  subscribePresence: (alias: string) => void;
  unsubscribePresence: (alias: string) => void;
  wsConnected: boolean;
  loaded: boolean;
  vpnAutoReconnecting: boolean;
}

/**
 * Build a local, non-transported system/status Message (e.g. the
 * "secure channel established" banner). These messages never cross the
 * wire and carry no ciphertext — they are purely informational UI rows.
 */
function buildSystemMessage(
  text: string,
  disappearAfterSec?: number,
): Message {
  const expiresAt = disappearAfterSec
    ? Date.now() + disappearAfterSec * 1000
    : undefined;

  return {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    text,
    fromMe: false,
    timestamp: Date.now(),
    encrypted: true,
    sealed: true,
    expiresAt,
  };
}

/**
 * Build the default conversations with fresh DR sessions each call.
 * Called on first launch and after panic wipe — ensures all default
 * conversations are always DR-enabled from the first render.
 */
function createDefaultConversations(): Conversation[] {
  return [];
}

// ── Disappearing messages: always on ────────────────────────────────────────
// Policy (Benji, 19 Aug 2026): every conversation has a disappear timer,
// no OFF setting. Range 5s–7d, default 1h. clampDisappearSec is the single
// place that enforces it — applied to loads (migration of pre-policy
// conversations), local setting changes, and peer-synced "disappear-timer"
// signals (whose sender may be an older build that still knows about OFF /
// undefined).
export const DISAPPEAR_MIN_SEC = 5;
export const DISAPPEAR_MAX_SEC = 7 * 24 * 3600;
export const DEFAULT_DISAPPEAR_SEC = 3600;

export function clampDisappearSec(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DISAPPEAR_SEC;
  return Math.min(DISAPPEAR_MAX_SEC, Math.max(DISAPPEAR_MIN_SEC, Math.round(value)));
}

const CALL_SIGNAL_TYPES = new Set([
  "call-ring", "call-accept", "call-hangup",
  "call-offer", "call-answer", "call-ice",
]);

const GHOSTPAD_SIGNAL_TYPES = new Set([
  "ghostpad-created", "ghostpad-paired", "ghostpad-text", "ghostpad-wipe", "ghostpad-ended", "ghostpad-error",
]);

const DEFAULT_TRANSACTIONS: Transaction[] = [];

const VPN_SERVERS: VPNServer[] = [
  { id: "1", name: "US East", country: "United States", region: "New York", shortRegion: "NYC", flag: "🇺🇸" },
  { id: "2", name: "EU West", country: "Germany", region: "Frankfurt", shortRegion: "FRA", flag: "🇩🇪" },
  { id: "3", name: "Asia Pacific", country: "Japan", region: "Tokyo", shortRegion: "TYO", flag: "🇯🇵" },
  { id: "4", name: "Nordic", country: "Sweden", region: "Stockholm", shortRegion: "ARN", flag: "🇸🇪" },
  { id: "5", name: "Offshore", country: "Iceland", region: "Reykjavik", shortRegion: "KEF", flag: "🇮🇸" },
  { id: "6", name: "SE Asia", country: "Singapore", region: "Singapore", shortRegion: "SIN", flag: "🇸🇬" },
];

export { VPN_SERVERS };

const SECURE_PIN_KEY = "ghostface_pin";
const SECURE_DURESS_PIN_KEY = "ghostface_duress_pin";
const SECURE_DECOY_PIN_KEY = "ghostface_decoy_pin";
const SECURE_WALLET_PIN_KEY = "ghostface_wallet_pin";
const CONVERSATIONS_KEY = "ghostface_conversations";
const CALL_HISTORY_KEY = "ghostface_call_history";
const OUTBOX_KEY = "ghostface_outbox";
const CONNECTED_WALLET_KEY = "ghostface_connected_wallet";
const OPK_STORE_KEY = "ghostface_opk_store";
const OPK_BATCH_SIZE = 10;
const AUTO_LOCK_TIMEOUT_KEY = "ghostface_auto_lock_timeout";
const DURESS_GRACE_KEY = "ghostface_duress_grace_period";
const LANGUAGE_KEY = "ghostface_language";
const THEME_KEY = "ghostface_theme_preference";
const PROFILE_IMAGE_KEY = "ghostface_profile_image_uri";
const LAST_VPN_SERVER_KEY = "ghostface_last_vpn_server_id";
const LOW_BW_MODE_KEY = "ghostface_low_bandwidth_mode";
const SMS_FALLBACK_NUMBERS_KEY = "ghostface_sms_fallback_numbers";
const SMS_FALLBACK_MESSAGE_KEY = "ghostface_sms_fallback_message";
const MY_IK_PRIV_KEY = "ghostface_my_ik_priv";
const MY_IK_PUB_KEY = "ghostface_my_ik_pub";
const MY_SPK_PRIV_KEY = "ghostface_my_spk_priv";
const MY_SPK_PUB_KEY = "ghostface_my_spk_pub";
// Post-quantum ML-KEM (Kyber) secret prekey, stored device-side only. The
// public half + its signature are published to the server; Bob decapsulates
// Alice's handshake ciphertext with this private key.
const MY_PQKEM_PRIV_KEY = "ghostface_my_pqkem_priv";
const MY_PQKEM_PUB_KEY = "ghostface_my_pqkem_pub";
// Non-custodial Solana wallet private key (32-byte ed25519 seed, hex).
// Written with writeEncryptedString — i.e. encrypted-at-rest in AsyncStorage,
// NOT SecureStore — so it is wiped via APP_STORAGE_KEYS below rather than
// secureDelete(). Getting that wrong would leave a funds-bearing key alive
// after a panic wipe.
const LOCAL_WALLET_PRIV_KEY = "ghostface_local_wallet_priv";
const APP_STORAGE_KEYS = [
  "alias",
  "isOnboarded",
  "biometricEnabled",
  CONVERSATIONS_KEY,
  CALL_HISTORY_KEY,
  OUTBOX_KEY,
  CONNECTED_WALLET_KEY,
  OPK_STORE_KEY,
  AUTO_LOCK_TIMEOUT_KEY,
  DURESS_GRACE_KEY,
  LANGUAGE_KEY,
  THEME_KEY,
  PROFILE_IMAGE_KEY,
  LAST_VPN_SERVER_KEY,
  LOW_BW_MODE_KEY,
  // Destroys the wallet along with everything else. Only the user's written
  // recovery phrase can bring it back — which is why wallet creation forces
  // an explicit "I have written this down" acknowledgement.
  LOCAL_WALLET_PRIV_KEY,
] as const;

/**
 * Load the local OPK private-key store from AsyncStorage.
 * The store is a map of { publicKeyHex: privateKeyHex } for unused OPKs.
 */
async function loadOPKStore(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(OPK_STORE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function saveOPKStore(store: Record<string, string>): Promise<void> {
  try {
    await AsyncStorage.setItem(OPK_STORE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn("[OPK] Failed to save OPK store:", err);
  }
}

/**
 * Register a user's identity with the server.
 * Generates IK (X25519 DH) + SPK (X25519 DH) + ikSign (Ed25519 signing).
 * Signs the SPK with the ikSign private key (Signal X3DH §2.4).
 * Returns the device token and all key material or null on failure.
 */
type RegisterResult =
  | {
      ok: true;
      token:        string;
      ikPriv:       string;
      ikPub:        string;
      spkPriv:      string;
      spkPub:       string;
      ikSignPriv:   string;
      ikSignPub:    string;
      spkSignature: string;
      pqkemPriv:    string;
      pqkemPub:     string;
    }
  // conflict = alias already registered server-side (409, first-writer-wins).
  // No token was issued and none can be — see the comment on POST
  // /prekeys/register. Distinct from `error` so callers can tell "this
  // alias is permanently unusable on this device" apart from "transient
  // network/server failure, maybe retry."
  | { ok: false; conflict: boolean };

// Same lookup onboarding.tsx uses to warn about a taken alias before
// registration — reused here so the mount self-heal path (which sees "no
// local device token" on every cold start where SecureStore lost the key,
// not just a genuinely-never-registered alias) can tell "safe to register"
// apart from "already claimed — registering again would just 409," instead
// of finding out the hard way via a failed POST /prekeys/register.
async function checkAliasExists(alias: string): Promise<boolean | null> {
  const apiBase = getApiBase();
  if (!apiBase) return null;
  try {
    const res = await fetch(`${apiBase}/users/exists/${encodeURIComponent(alias)}`);
    if (res.status === 404) return false;
    if (!res.ok) return null;
    return true;
  } catch {
    return null;
  }
}

async function registerWithServer(userId: string): Promise<RegisterResult | null> {
  const apiBase = getApiBase();
  if (!apiBase) return null;
  try {
    const ik     = generateHexKeypair();
    const spk    = generateHexKeypair();
    const ikSign = generateEd25519Keypair();
    const spkSig = signSPKLocal(spk.pub, ikSign.priv);
    // Post-quantum: generate a signed ML-KEM prekey alongside the classical keys.
    const pqkem    = generateKemKeyPair();
    const pqkemSig = signKemPreKey(pqkem.pub, ikSign.priv);

    const res = await fetch(`${apiBase}/prekeys/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        ikPublicKey:     ik.pub,
        spkPublicKey:    spk.pub,
        ikSignPublicKey: ikSign.pub,
        spkSignature:    spkSig,
        pqkemPublicKey:  pqkem.pub,
        pqkemSignature:  pqkemSig,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      console.warn("[REGISTER] Server registration failed:", err.error ?? res.status);
      return { ok: false, conflict: res.status === 409 };
    }

    const data = await res.json() as { token: string; userId: string };
    return {
      ok:           true,
      token:        data.token,
      ikPriv:       ik.priv,
      ikPub:        ik.pub,
      spkPriv:      spk.priv,
      spkPub:       spk.pub,
      ikSignPriv:   ikSign.priv,
      ikSignPub:    ikSign.pub,
      spkSignature: spkSig,
      pqkemPriv:    pqkem.priv,
      pqkemPub:     pqkem.pub,
    };
  } catch (err) {
    console.warn("[REGISTER] Failed to register with server:", err);
    return { ok: false, conflict: false };
  }
}

/**
 * Rotate identity keys for an existing registration.
 * Called when the device token is present but the private keys were lost
 * (e.g. SecureStore cleared on Expo Go reset). Generates fresh IK/SPK,
 * uploads new public keys via PUT /prekeys/:userId/rekey, and returns the
 * new key material for the caller to store.
 */
async function rekeyWithServer(
  userId: string,
  token: string,
): Promise<{
  ikPriv: string; ikPub: string;
  spkPriv: string; spkPub: string;
  ikSignPriv: string; ikSignPub: string;
  spkSignature: string;
  pqkemPriv: string; pqkemPub: string;
} | null> {
  const apiBase = getApiBase();
  if (!apiBase) return null;
  try {
    const ik     = generateHexKeypair();
    const spk    = generateHexKeypair();
    const ikSign = generateEd25519Keypair();
    const spkSig = signSPKLocal(spk.pub, ikSign.priv);
    const pqkem    = generateKemKeyPair();
    const pqkemSig = signKemPreKey(pqkem.pub, ikSign.priv);

    const res = await fetch(`${apiBase}/prekeys/${encodeURIComponent(userId)}/rekey`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ikPublicKey:     ik.pub,
        spkPublicKey:    spk.pub,
        ikSignPublicKey: ikSign.pub,
        spkSignature:    spkSig,
        pqkemPublicKey:  pqkem.pub,
        pqkemSignature:  pqkemSig,
      }),
    });
    if (!res.ok) {
      console.warn("[REKEY] Server rekey failed:", res.status);
      return null;
    }
    return { ikPriv: ik.priv, ikPub: ik.pub, spkPriv: spk.priv, spkPub: spk.pub, ikSignPriv: ikSign.priv, ikSignPub: ikSign.pub, spkSignature: spkSig, pqkemPriv: pqkem.priv, pqkemPub: pqkem.pub };
  } catch (e) {
    console.warn("[REKEY] Failed:", e);
    return null;
  }
}

/**
 * Reclaim an alias using an IK private key recovered from a recovery phrase
 * — the full-device-loss case rekeyWithServer doesn't cover (that needs a
 * still-valid Bearer token; this needs none). Two round trips:
 *   1. /reclaim/challenge — server hands back an ephemeral X25519 public key
 *      + nonce.
 *   2. Compute ss = X25519(recoveredIkPriv, serverEphPub), send back
 *      HMAC-SHA256(ss, nonce) as proof, along with fresh SPK/ikSign/PQKEM
 *      (the recovered device has none of its own — same as a rekey).
 * See lib/db's reclaim.ts schema comment for why this proves ownership
 * without the private key ever crossing the wire.
 */
async function reclaimWithServer(
  userId: string,
  recoveredIkPrivHex: string,
): Promise<{
  ok: true;
  token: string; deliveryId: string | null;
  ikPriv: string; ikPub: string;
  spkPriv: string; spkPub: string;
  ikSignPriv: string; ikSignPub: string;
  spkSignature: string;
  pqkemPriv: string; pqkemPub: string;
} | { ok: false; error: string }> {
  const apiBase = getApiBase();
  if (!apiBase) return { ok: false, error: "server_unreachable" };
  try {
    const ikPub = toHex(x25519.getPublicKey(fromHex(recoveredIkPrivHex)));

    const challengeRes = await fetch(
      `${apiBase}/prekeys/${encodeURIComponent(userId)}/reclaim/challenge`,
      { method: "POST" },
    );
    if (!challengeRes.ok) {
      return { ok: false, error: challengeRes.status === 404 ? "not_found" : "server_unreachable" };
    }
    const challenge = (await challengeRes.json()) as {
      challengeId: string; serverEphPub: string; nonce: string;
    };

    const sharedSecret = x25519.getSharedSecret(fromHex(recoveredIkPrivHex), fromHex(challenge.serverEphPub));
    const proof = toHex(hmac(sha256, sharedSecret, fromHex(challenge.nonce)));

    const spk      = generateHexKeypair();
    const ikSign   = generateEd25519Keypair();
    const spkSig   = signSPKLocal(spk.pub, ikSign.priv);
    const pqkem    = generateKemKeyPair();
    const pqkemSig = signKemPreKey(pqkem.pub, ikSign.priv);

    const verifyRes = await fetch(
      `${apiBase}/prekeys/${encodeURIComponent(userId)}/reclaim/verify`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          proof,
          spkPublicKey:    spk.pub,
          ikSignPublicKey: ikSign.pub,
          spkSignature:    spkSig,
          pqkemPublicKey:  pqkem.pub,
          pqkemSignature:  pqkemSig,
        }),
      },
    );
    if (!verifyRes.ok) {
      return { ok: false, error: verifyRes.status === 403 ? "proof_failed" : "server_unreachable" };
    }
    const result = (await verifyRes.json()) as { token: string; deliveryId: string | null };

    return {
      ok: true,
      token: result.token,
      deliveryId: result.deliveryId,
      ikPriv: recoveredIkPrivHex, ikPub,
      spkPriv: spk.priv, spkPub: spk.pub,
      ikSignPriv: ikSign.priv, ikSignPub: ikSign.pub,
      spkSignature: spkSig,
      pqkemPriv: pqkem.priv, pqkemPub: pqkem.pub,
    };
  } catch (e) {
    console.warn("[RECLAIM] Failed:", e);
    return { ok: false, error: "server_unreachable" };
  }
}

/**
 * Releases this device's server-side registration for userId — called from
 * panicWipe before it wipes the local device token, since that token is the
 * only proof of ownership the server accepts (no reissue path otherwise; see
 * DELETE /prekeys/:userId). Best-effort and silent by design: self-destruct
 * must still fully wipe local state even if this fails (offline, server
 * down, timeout) — a failed unregister just means the alias stays claimed
 * server-side until someone can reach the server, it never blocks the wipe.
 */
async function unregisterFromServer(userId: string, token: string): Promise<void> {
  const apiBase = getApiBase();
  if (!apiBase) return;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${apiBase}/prekeys/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.warn("[UNREGISTER] Server unregister failed:", res.status);
    }
  } catch (e) {
    console.warn("[UNREGISTER] Failed:", e);
  }
}

/**
 * Generate a batch of OPKs, save private keys locally, and upload public keys
 * to the server with device-token authentication.
 */
async function generateAndUploadOPKs(userId: string, deviceToken: string): Promise<void> {
  const apiBase = getApiBase();
  if (!apiBase) return;
  try {
    const opks = generateOneTimePreKeys(OPK_BATCH_SIZE);
    const store = await loadOPKStore();
    for (const opk of opks) {
      store[opk.pub] = opk.priv;
    }
    await saveOPKStore(store);

    const res = await fetch(`${apiBase}/prekeys/${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({ keys: opks.map((k) => k.pub) }),
    });
    if (!res.ok) {
      console.warn(`[OPK] Upload returned ${res.status} for ${userId}`);
    }
  } catch (err) {
    console.warn("[OPK] Failed to upload OPKs:", err);
  }
}

/**
 * Check whether the user's OPK supply is low and replenish if needed.
 */
async function replenishOPKsIfNeeded(userId: string, deviceToken: string): Promise<void> {
  const apiBase = getApiBase();
  if (!apiBase) return;
  try {
    const res = await fetch(`${apiBase}/prekeys/${encodeURIComponent(userId)}/count`, {
      headers: { "Authorization": `Bearer ${deviceToken}` },
    });
    if (!res.ok) return;
    const data = await res.json() as { remaining: number; lowSupply: boolean };
    if (data.lowSupply) {
      await generateAndUploadOPKs(userId, deviceToken);
    }
  } catch {
    // Non-critical — silently ignore
  }
}

/**
 * Fetch the full X3DH prekey bundle for a contact from the server.
 * Atomically consumes one OPK (4-DH) if available, or returns IK+SPK only (3-DH fallback).
 * Also retrieves contact's private identity keys from the local demo store.
 *
 * Demo simulation note:
 *   In a real Signal deployment, the server returns only public keys and Alice
 *   never sees Bob's private keys.  In this single-device demo we generated Bob's
 *   keys locally and stored both halves, so we can compute both sides of the X3DH
 *   handshake to verify correctness.
 */
async function fetchContactBundle(
  contactAlias: string,
): Promise<(PreKeyBundle & { deliveryId?: string }) | null> {
  const apiBase = getApiBase();
  if (!apiBase) return null;
  try {
    const bundleRes = await fetch(`${apiBase}/prekeys/${encodeURIComponent(contactAlias)}/bundle`);
    if (!bundleRes.ok) {
      console.warn("[BUNDLE] Bundle fetch failed:", bundleRes.status);
      return null;
    }
    const data = await bundleRes.json() as {
      deliveryId?:     string;
      ikPublicKey:     string;
      spkPublicKey:    string;
      opk:             string | null;
      remaining:       number;
      lowSupply:       boolean;
      ikSignPublicKey?: string;
      spkSignature?:   string;
      pqkemPublicKey?: string;
      pqkemSignature?: string;
    };

    // Alice uses the OPK public key for her DH4 computation — no private key needed.
    // 3-DH fallback only when server returns opk: null (Bob exhausted his OPK supply).
    const opkPublicKey = data.opk ?? null;

    const bundle: PreKeyBundle & { deliveryId?: string } = {
      ikPublicKey:     data.ikPublicKey,
      spkPublicKey:    data.spkPublicKey,
      opkPublicKey,
      ikSignPublicKey: data.ikSignPublicKey,
      spkSignature:    data.spkSignature,
      pqkemPublicKey:  data.pqkemPublicKey,
      pqkemSignature:  data.pqkemSignature,
      deliveryId:      data.deliveryId,
    };

    return bundle;
  } catch (err) {
    console.warn("[BUNDLE] Failed to fetch bundle for contact:", contactAlias, err);
    return null;
  }
}

/**
 * Resolve a contact's opaque delivery token (task #128) without consuming a
 * one-time prekey. Used by the replying side of an inbound session, whose
 * conversation was created from a received message and therefore never captured
 * the token from a prekey bundle. Returns null if the user is unknown or the
 * server is unreachable.
 */
async function resolveDeliveryId(contactAlias: string): Promise<string | null> {
  const apiBase = getApiBase();
  if (!apiBase) return null;
  try {
    const res = await fetch(`${apiBase}/users/exists/${encodeURIComponent(contactAlias)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { exists?: boolean; deliveryId?: string };
    return data.deliveryId ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch the identity public key (X3DH ikA) the server has on record for an
 * alias. Used on receive to bind a sealed-sender message's *claimed* sender
 * alias to its cryptographic identity: under sealed sender the alias is
 * self-asserted from inside the decrypted payload, so without this check any
 * authenticated peer could embed someone else's alias and be displayed as
 * them. Returns null if the user is unknown or the lookup fails (fail-closed).
 */
async function resolveIdentityKey(contactAlias: string): Promise<string | null> {
  const apiBase = getApiBase();
  if (!apiBase) return null;
  try {
    const res = await fetch(`${apiBase}/users/exists/${encodeURIComponent(contactAlias)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { exists?: boolean; ikPublicKey?: string };
    return data.ikPublicKey ?? null;
  } catch {
    return null;
  }
}

async function fetchSolBalance(address: string): Promise<number> {
  try {
    const resp = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
    });
    const json = await resp.json();
    return (json?.result?.value ?? 0) / 1e9;
  } catch {
    return 0;
  }
}

function clusterRpcUrl(network: string | null): string {
  return network === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
}

/** Real on-chain SPL token balance for a given owner + mint, via raw
 * JSON-RPC (no @solana/web3.js dependency needed client-side, matching
 * fetchSolBalance's pattern). Returns 0 if the owner has no token account
 * for this mint yet — that's a legitimate "never held any" state, not
 * an error. */
async function fetchSplTokenBalance(
  ownerAddress: string,
  mintAddress: string,
  network: string | null,
): Promise<number> {
  try {
    const resp = await fetch(clusterRpcUrl(network), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [ownerAddress, { mint: mintAddress }, { encoding: "jsonParsed" }],
      }),
    });
    const json = await resp.json();
    const accounts = json?.result?.value ?? [];
    if (accounts.length === 0) return 0;
    const amount =
      accounts[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
    return typeof amount === "number" ? amount : 0;
  } catch {
    return 0;
  }
}

/** Fetches the live token list (name/symbol/mint) from the api-server, and
 * — if a wallet is connected — the real balance of each deployed token for
 * that wallet. Deliberately tolerant of a missing apiBase or a token with
 * no mintAddress yet (still "pending"): those just show as 0 rather than
 * failing the whole screen. */
async function fetchAppTokensAndBalances(
  ownerAddress: string | null,
): Promise<{ tokens: AppToken[]; balances: number[] }> {
  const apiBase = getApiBase();
  if (!apiBase) return { tokens: [], balances: [] };
  try {
    const resp = await fetch(`${apiBase}/tokens`);
    if (!resp.ok) return { tokens: [], balances: [] };
    const json = await resp.json();
    const raw = (json?.data ?? []) as Array<{
      id: number;
      name: string;
      symbol: string;
      decimals: number;
      mintAddress: string | null;
      network: string | null;
    }>;
    const tokens: AppToken[] = raw.map((t) => ({
      id: t.id,
      name: t.name,
      symbol: t.symbol,
      decimals: t.decimals,
      mintAddress: t.mintAddress,
      network: t.network,
    }));
    if (!ownerAddress) return { tokens, balances: tokens.map(() => 0) };
    const balances = await Promise.all(
      tokens.map((t) =>
        t.mintAddress ? fetchSplTokenBalance(ownerAddress, t.mintAddress, t.network) : Promise.resolve(0),
      ),
    );
    return { tokens, balances };
  } catch {
    return { tokens: [], balances: [] };
  }
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);// Safety net: never let the splash hang forever, even if init stalls.
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const [hasDuressPin, setHasDuressPin] = useState(false);
  const [hasDecoyPin, setHasDecoyPin] = useState(false);
  const [hasWalletPin, setHasWalletPin] = useState(false);
  // Session-scoped: cleared whenever the app (re)locks, same as the decoy/
  // duress model — a wallet PIN unlock doesn't outlive the app lock.
  const [walletUnlocked, setWalletUnlocked] = useState(false);
  // In-memory only, never persisted — a decoy session must leave no trace
  // that distinguishes it from a normal one once the app is force-closed.
  const [decoyMode, setDecoyMode] = useState(false);
  const [vpnAutoReconnecting, setVpnAutoReconnecting] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const wsEverConnectedRef = React.useRef(false);
  const [state, setState] = useState<AppState>({
    alias: null,
    deviceToken: null,
    activePlan: null,
    biometricEnabled: false,
    isLocked: true,
    isOnboarded: false,
    vpnConnected: false,
    vpnServer: null,
    conversations: createDefaultConversations(),
    callHistory: [],
    fdBalance: 0,
    casperBalance: 0,
    appTokens: [],
    walletAddress: null,
    incomingCall: null,
    ghostpad: { mode: "idle", code: null },
    transactions: DEFAULT_TRANSACTIONS,
    connectedWalletAddress: null,
    solBalance: 0,
    autoLockTimeout: 5 * 60 * 1000,
    duressGracePeriod: 3,
    language: "en",
    themePreference: "dark",
    profileImageUri: null,
    linkQuality: "unknown",
    lowBandwidthMode: "auto",
    // Derive from the classifier so AUTO+UNKNOWN starts active (per task
    // spec: "constrained or unknown-quality link → enters LBW mode
    // automatically"). Hardcoding `false` here would mean cold start and
    // panic-wipe reset both show INACTIVE until the classifier fires.
    lowBandwidthActive: isLowBandwidthActive("unknown", "auto"),
    smsFallbackNumbers: [],
    smsFallbackMessage: DEFAULT_SMS_FALLBACK_MESSAGE,
  });

  useEffect(() => {
    async function load() {
      try {
        const [alias, pinValue, duressValue, decoyValue, walletPinValue, biometric, onboarded, convData, callHistoryData, connectedWallet, autoLockRaw, storedToken, lastVpnServerId, duressGraceRaw, languageRaw, outboxRaw, lowBwRaw, smsNumbersRaw, smsMessageRaw, localWalletPrivRaw, themeRaw, profileImageRaw] = await Promise.all([
          AsyncStorage.getItem("alias"),
          secureGet(SECURE_PIN_KEY),
          secureGet(SECURE_DURESS_PIN_KEY),
          secureGet(SECURE_DECOY_PIN_KEY),
          secureGet(SECURE_WALLET_PIN_KEY),
          AsyncStorage.getItem("biometricEnabled"),
          AsyncStorage.getItem("isOnboarded"),
          readEncryptedString(CONVERSATIONS_KEY),
          readEncryptedString(CALL_HISTORY_KEY),
          AsyncStorage.getItem(CONNECTED_WALLET_KEY),
          AsyncStorage.getItem(AUTO_LOCK_TIMEOUT_KEY),
          secureGet(DEVICE_TOKEN_KEY),
          AsyncStorage.getItem(LAST_VPN_SERVER_KEY),
          AsyncStorage.getItem(DURESS_GRACE_KEY),
          AsyncStorage.getItem(LANGUAGE_KEY),
          AsyncStorage.getItem(OUTBOX_KEY),
          AsyncStorage.getItem(LOW_BW_MODE_KEY),
          secureGet(SMS_FALLBACK_NUMBERS_KEY),
          secureGet(SMS_FALLBACK_MESSAGE_KEY),
          readEncryptedString(LOCAL_WALLET_PRIV_KEY),
          AsyncStorage.getItem(THEME_KEY),
          AsyncStorage.getItem(PROFILE_IMAGE_KEY),
        ]);

        // Re-derive the wallet address from the stored private key. If the key
        // is absent or fails to derive (corrupt/truncated), stay null rather
        // than showing an address the device cannot actually receive to.
        const localWallet = localWalletPrivRaw
          ? walletFromPrivateKeyHex(localWalletPrivRaw)
          : null;
        if (localWalletPrivRaw && !localWallet) {
          console.warn("[AppContext] stored wallet key did not derive — leaving wallet unset");
        }

        const hasPinValue = !!pinValue;
        setHasDuressPin(!!duressValue);
        setHasDecoyPin(!!decoyValue);
        setHasWalletPin(!!walletPinValue);
        const biometricOn = biometric === "true";
        const isOnboarded = onboarded === "true";

        let conversations: Conversation[] = createDefaultConversations();
        if (convData) {
          try {
            const parsed = JSON.parse(convData);
            if (Array.isArray(parsed)) conversations = parsed;
          } catch (parseErr) {
            console.warn("[AppContext] Failed to parse conversations:", parseErr);
          }
        }
        // Always-on disappearing messages: migrate pre-policy conversations
        // (disappearAfterSec undefined = the old "OFF") to the default, and
        // clamp any out-of-range persisted value. Forward-only, same as a
        // manual timer change — existing messages' expiresAt are untouched.
        conversations = conversations.map((c) =>
          c.disappearAfterSec === clampDisappearSec(c.disappearAfterSec)
            ? c
            : { ...c, disappearAfterSec: clampDisappearSec(c.disappearAfterSec) },
        );

        let callHistory: CallLogEntry[] = [];
        if (callHistoryData) {
          try {
            const parsed = JSON.parse(callHistoryData);
            if (Array.isArray(parsed)) callHistory = parsed;
          } catch (parseErr) {
            console.warn("[AppContext] Failed to parse call history:", parseErr);
          }
        }

        const DEMO_ALIASES = new Set(["PHANTOM_7", "WRAITH_X", "NULL_PTR"]);
        const beforeCount = conversations.length;
        conversations = conversations.filter(
          (c) => !DEMO_ALIASES.has((c.alias ?? "").toUpperCase())
        );
        if (conversations.length !== beforeCount) {
          writeEncryptedString(CONVERSATIONS_KEY, JSON.stringify(conversations)).catch(
            (e) => console.warn("[AppContext] Failed to persist demo cleanup:", e)
          );
        }

        // Ensure every conversation has a valid DR session.
        // Conversations loaded from an older app version (or corrupted storage)
        // may be missing a session or have malformed hex fields. We never
        // fabricate a fake session for these — drop the broken session so the
        // conversation has no usable channel until a real X3DH handshake runs.
        conversations = conversations.map((c) =>
          isValidDRSession(c.drSession) ? c : { ...c, drSession: undefined }
        );

        // Purge disappearing messages that expired while the app was closed,
        // BEFORE `loaded` ever flips true (app/_layout.tsx gates all
        // rendering on it) — an expired message must never flash on screen
        // even for a frame on cold start. Only messages that already carry
        // an `expiresAt` are touched: an unviewed receiver message has
        // `ttlMs` but no `expiresAt` yet, so its timer hasn't started and
        // it's correctly left alone here.
        {
          const now = Date.now();
          let purged = false;
          conversations = conversations.map((c) => {
            const filtered = c.messages.filter((m) => !m.expiresAt || m.expiresAt > now);
            if (filtered.length !== c.messages.length) {
              purged = true;
              return { ...c, messages: filtered };
            }
            return c;
          });
          if (purged) {
            writeEncryptedString(CONVERSATIONS_KEY, JSON.stringify(conversations)).catch(
              (e) => console.warn("[AppContext] Failed to persist hydrate-time expiry purge:", e)
            );
          }
        }

        let autoLockTimeout: number | null = 5 * 60 * 1000;
        if (autoLockRaw === "null") {
          autoLockTimeout = null;
        } else if (autoLockRaw !== null) {
          const parsed = parseInt(autoLockRaw, 10);
          if (!isNaN(parsed)) autoLockTimeout = parsed;
        }

        const VALID_GRACE = [1, 2, 3, 5];
        let duressGracePeriod = 3;
        if (duressGraceRaw !== null) {
          const parsed = parseInt(duressGraceRaw, 10);
          if (VALID_GRACE.includes(parsed)) duressGracePeriod = parsed;
        }

        const restoredVpnServer = lastVpnServerId
          ? (VPN_SERVERS.find((s) => s.id === lastVpnServerId) ?? null)
          : null;

        const VALID_LANGUAGES = ["en","es","fr","de","ja","zh","ar","pt","ru","ko","hi","it"];
        const language = (languageRaw && VALID_LANGUAGES.includes(languageRaw)) ? languageRaw : "en";

        const themePreference: "dark" | "light" = themeRaw === "light" ? "light" : "dark";

        const VALID_LBW_MODES: LowBandwidthMode[] = ["auto", "forceOn", "forceOff"];
        const lowBandwidthMode: LowBandwidthMode =
          lowBwRaw && (VALID_LBW_MODES as string[]).includes(lowBwRaw)
            ? (lowBwRaw as LowBandwidthMode)
            : "auto";
        // Derive activeness from the classifier so AUTO + initial UNKNOWN
        // link starts active immediately (per task spec). The classifier
        // will downgrade to "good" + INACTIVE once we observe a clean
        // auth ack.
        const lowBandwidthActive = isLowBandwidthActive("unknown", lowBandwidthMode);

        // Restore the outbox (queued messages pending WS delivery).
        // Items written by older builds may be missing `createdAt`; fall
        // back to 0 so they sort to the front and drain first. Always
        // re-sort on read so the on-disk order is irrelevant.
        if (outboxRaw) {
          try {
            const parsed = JSON.parse(outboxRaw);
            if (Array.isArray(parsed)) {
              const normalized: OutboxItem[] = parsed.map((item) => ({
                ...item,
                createdAt:
                  typeof item?.createdAt === "number" ? item.createdAt : 0,
              }));
              outboxRef.current = sortByCompose(normalized);
            }
          } catch { outboxRef.current = []; }
        }

        const smsFallbackNumbers = parseStoredNumbers(smsNumbersRaw);
        const smsFallbackMessage = sanitizeFallbackMessage(
          smsMessageRaw ?? DEFAULT_SMS_FALLBACK_MESSAGE,
        );

        setHasPin(hasPinValue);
        setState((prev) => ({
          ...prev,
          alias,
          deviceToken: storedToken ?? null,
          biometricEnabled: biometricOn,
          isOnboarded,
          isLocked: true,
          conversations,
          callHistory,
          connectedWalletAddress: connectedWallet ?? null,
          walletAddress: localWallet?.address ?? null,
          autoLockTimeout,
          duressGracePeriod,
          language,
          themePreference,
          profileImageUri: profileImageRaw ?? null,
          vpnServer: restoredVpnServer,
          // Start disconnected; if a server was saved, show reconnecting for 1.5 s then connect
          vpnConnected: false,
          lowBandwidthMode,
          lowBandwidthActive,
          smsFallbackNumbers,
          smsFallbackMessage,
        }));

        if (restoredVpnServer) {
          setVpnAutoReconnecting(true);
          const reconnectTimer = setTimeout(() => {
            setState((prev) => ({ ...prev, vpnConnected: true }));
            setVpnAutoReconnecting(false);
          }, 1500);
          // Store on globalThis so the effect cleanup can clear it if needed
          (globalThis as Record<string, unknown>).__vpnReconnectTimer = reconnectTimer;
        }

        // Fetch SOL balance in background after state is set
        if (connectedWallet) {
          fetchSolBalance(connectedWallet).then((bal) =>
            setState((prev) => ({ ...prev, solBalance: bal }))
          );
        }

        // Populate app token metadata (name/symbol/mint) regardless of
        // whether a wallet is connected, so the wallet screen's tabs show
        // real symbols instead of placeholders; balances only resolve if a
        // wallet is connected (fetchAppTokensAndBalances handles both).
        fetchAppTokensAndBalances(connectedWallet ?? null).then(({ tokens, balances }) => {
          if (tokens.length === 0) return;
          setState((prev) => ({
            ...prev,
            appTokens: tokens,
            casperBalance: balances[0] ?? prev.casperBalance,
            fdBalance: balances[1] ?? prev.fdBalance,
          }));
        });

        // Self-heal crypto state for returning users.
        // Three cases:
        //   1. No token in SecureStore  → re-register (upserts on the server)
        //   2. Token but no own IK      → rekey
        //   3. Both present             → just top up OPKs if low
        if (alias && onboarded === "true") {
          (async () => {
            try {
              const token = await secureGet(DEVICE_TOKEN_KEY);
              if (!token) {
                // "No local token" doesn't distinguish "never registered"
                // from "registered fine, but the local write got
                // interrupted" (e.g. setAlias's registration was still
                // finishing when the app backgrounded/reloaded) — blindly
                // calling registerWithServer here previously self-inflicted
                // a 409 on this device's OWN just-claimed alias. Check
                // first, and only attempt registration when the alias is
                // confirmed genuinely unclaimed.
                console.warn("[AppContext] No device token on mount — checking alias state", alias);
                const exists = await checkAliasExists(alias);
                if (exists === true) {
                  console.warn(
                    "[AppContext] Alias already registered server-side but no local token — " +
                      "not blindly re-registering (would just 409)",
                    alias,
                  );
                  Alert.alert(
                    "Device not linked to this alias",
                    "This alias is already registered on another device or install. " +
                      "Push notifications, calls, and new messages won't work here until " +
                      "you create a new alias.",
                  );
                  return;
                }
                if (exists === null) {
                  // Couldn't reach the server to check — don't guess either
                  // way. The next mount (or the WS auth-rejected path once
                  // connected) gets another chance.
                  console.warn("[AppContext] Could not determine alias state (offline?) — skipping for now", alias);
                  return;
                }
                const reg = await registerWithServer(alias);
                if (reg?.ok) {
                  await secureSet(DEVICE_TOKEN_KEY, reg.token);
                  await secureSet(MY_IK_PRIV_KEY,  reg.ikPriv);
                  await secureSet(MY_IK_PUB_KEY,   reg.ikPub);
                  await secureSet(MY_SPK_PRIV_KEY, reg.spkPriv);
                  await secureSet(MY_SPK_PUB_KEY,  reg.spkPub);
                  await secureSet(MY_PQKEM_PRIV_KEY, reg.pqkemPriv);
                  await secureSet(MY_PQKEM_PUB_KEY,  reg.pqkemPub);
                  setState((prev) => ({ ...prev, deviceToken: reg.token }));
                  await generateAndUploadOPKs(alias, reg.token);
                } else if (reg && reg.conflict) {
                  // Alias became taken between our exists-check above and
                  // this registration call (race). By design (see POST
                  // /prekeys/register) there is no reissue path — surface
                  // it instead of failing silently forever, since this
                  // device can now never send/receive push, upload
                  // prekeys, or rekey under this alias.
                  console.warn(
                    "[AppContext] Alias became unavailable between check and registration (race)",
                    alias,
                  );
                  Alert.alert(
                    "Device not linked to this alias",
                    "This alias is already registered on another device or install. " +
                      "Push notifications, calls, and new messages won't work here until " +
                      "you create a new alias.",
                  );
                }
                return;
              }
              const ikPriv = await secureGet(MY_IK_PRIV_KEY);
              const pqPriv = await secureGet(MY_PQKEM_PRIV_KEY);
              if (!ikPriv || !pqPriv) {
                console.warn("[AppContext] Token present but own IK/ML-KEM key missing on mount — rekeying", alias);
                const rekey = await rekeyWithServer(alias, token);
                if (rekey) {
                  await secureSet(MY_IK_PRIV_KEY,  rekey.ikPriv);
                  await secureSet(MY_IK_PUB_KEY,   rekey.ikPub);
                  await secureSet(MY_SPK_PRIV_KEY, rekey.spkPriv);
                  await secureSet(MY_SPK_PUB_KEY,  rekey.spkPub);
                  await secureSet(MY_PQKEM_PRIV_KEY, rekey.pqkemPriv);
                  await secureSet(MY_PQKEM_PUB_KEY,  rekey.pqkemPub);
                  await generateAndUploadOPKs(alias, token);
                }
                return;
              }
              await replenishOPKsIfNeeded(alias, token);
            } catch (e) {
              console.warn("[AppContext] Identity self-heal failed:", e);
            }
          })();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[AppContext] Failed to load persisted state:", msg);
        setLoadError(msg);
      } finally {
        setLoaded(true);
      }
    }
    load();
  }, []);

  // Purge expired disappearing messages every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setState((prev) => {
        const now = Date.now();
        let changed = false;
        const conversations = prev.conversations.map((c) => {
          const filtered = c.messages.filter((m) => !m.expiresAt || m.expiresAt > now);
          if (filtered.length !== c.messages.length) {
            changed = true;
            return { ...c, messages: filtered };
          }
          return c;
        });
        return changed ? { ...prev, conversations } : prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const persistConversations = useCallback(async (convs: Conversation[]) => {
    try {
      await writeEncryptedString(CONVERSATIONS_KEY, JSON.stringify(convs));
    } catch (err) {
      console.warn("[AppContext] Failed to persist conversations:", err);
    }
  }, []);

  const persistCallHistory = useCallback(async (history: CallLogEntry[]) => {
    try {
      await writeEncryptedString(CALL_HISTORY_KEY, JSON.stringify(history));
    } catch (err) {
      console.warn("[AppContext] Failed to persist call history:", err);
    }
  }, []);

  // Capped so an unanswered-call storm (or years of daily use) can't grow
  // the encrypted blob unboundedly — same idea as conversations, which are
  // naturally bounded by contact count instead.
  const MAX_CALL_HISTORY = 200;

  const logCall = useCallback((entry: Omit<CallLogEntry, "id" | "seen">) => {
    setState((prev) => {
      const full: CallLogEntry = {
        ...entry,
        id: `${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
        // Only a missed INCOMING call is something the user could have
        // "missed" seeing — outgoing/declined/answered never drive the badge.
        seen: !(entry.direction === "incoming" && entry.outcome === "missed"),
      };
      const callHistory = [full, ...prev.callHistory].slice(0, MAX_CALL_HISTORY);
      persistCallHistory(callHistory);
      return { ...prev, callHistory };
    });
  }, [persistCallHistory]);

  const markCallsSeen = useCallback(() => {
    setState((prev) => {
      if (prev.callHistory.every((c) => c.seen)) return prev;
      const callHistory = prev.callHistory.map((c) => (c.seen ? c : { ...c, seen: true }));
      persistCallHistory(callHistory);
      return { ...prev, callHistory };
    });
  }, [persistCallHistory]);

  const clearCallHistory = useCallback(() => {
    setState((prev) => {
      if (prev.callHistory.length === 0) return prev;
      // Persist the empty list (encrypted, same path as every other write)
      // rather than deleting the storage key — an empty encrypted blob and
      // an absent key are indistinguishable to an observer of AsyncStorage,
      // and this keeps exactly one code path for how call history reaches
      // disk.
      persistCallHistory([]);
      return { ...prev, callHistory: [] };
    });
  }, [persistCallHistory]);

  const persistOutbox = useCallback((items: OutboxItem[]) => {
    AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(items)).catch(console.error);
  }, []);

  const wsRef = React.useRef<WebSocket | null>(null);
  // Gates the WS reconnect-on-close logic below so a backgrounded app stays
  // disconnected (see the AppState effect further down) instead of the
  // generic 5s reconnect timer reopening the socket seconds later while
  // still backgrounded — reconnectNowRef lets that same effect trigger an
  // immediate reconnect the moment the app returns to foreground.
  const backgroundedRef = React.useRef(false);
  const reconnectNowRef = React.useRef<(() => void) | null>(null);
  // Short-lived buffer for call-signal sends (offer/answer/ICE/hangup) made
  // while the WS is closed, e.g. mid-reconnect after backgrounding. Flushed
  // on the next successful open; entries older than CALL_SIGNAL_QUEUE_TTL_MS
  // are dropped there since a stale ICE candidate is worse than a lost one.
  const pendingCallSignalsRef = React.useRef<Array<{ msg: object; queuedAt: number }>>([]);
  const callSignalListenerRef = React.useRef<((s: CallSignal) => void) | null>(null);
  const ghostpadListenerRef = React.useRef<((s: GhostpadSignal) => void) | null>(null);
  const latestStateRef = React.useRef(state);
  const prevMainPinRef = React.useRef<string | null>(null);
  const outboxRef = React.useRef<OutboxItem[]>([]);
  const outboxDrainingRef = React.useRef(false);
  // setTimeout handle for the "wake up and try again" retry scheduler.
  // Cleared and replaced whenever the soonest-due item changes, e.g.
  // after a fresh failure bumps the backoff window or a successful
  // drain empties the queue.
  const outboxRetryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { latestStateRef.current = state; }, [state]);

  // Seal conversations whose X3DH handshake has expired before completing.
  // Runs once on mount and every 5 minutes thereafter so a stale pending
  // session is detected even when the user never opens the chat or attempts
  // to send a new message. The seal predicate lives in
  // evaluateExpiredHandshake — see its docstring for the conditions.
  // Placed AFTER latestStateRef so the ref is in scope when the closure runs.
  useEffect(() => {
    const sweep = () => {
      // Read current conversations from the latest-state ref so the next
      // array is computed deterministically OUTSIDE setState. We commit
      // with a passthrough setState call and persist in the same tick,
      // avoiding StrictMode replay re-running side effects.
      const current = latestStateRef.current.conversations;
      let changed = false;
      const next = current.map((c) => {
        const expiry = evaluateExpiredHandshake(c);
        if (!expiry) return c;
        changed = true;
        return {
          ...c,
          destroyedAt: expiry.destroyedAt,
          lastMessage: expiry.lastMessage,
          timestamp: expiry.timestamp,
          messages: [...c.messages, expiry.systemMsg],
        };
      });
      if (!changed) return;
      setState((prev) => ({ ...prev, conversations: next }));
      writeEncryptedString(CONVERSATIONS_KEY, JSON.stringify(next)).catch((err) =>
        console.warn("[AppContext] Failed to persist expired-handshake seal:", err)
      );
    };
    sweep();
    const interval = setInterval(sweep, 5 * 60_000);
    return () => clearInterval(interval);
  }, []);

  const setAlias = useCallback(async (alias: string) => {
    try {
      await AsyncStorage.setItem("alias", alias);
      await AsyncStorage.setItem("isOnboarded", "true");
      setState((prev) => ({ ...prev, alias, isOnboarded: true, isLocked: false }));
    } catch (err) {
      console.error("[AppContext] Failed to save alias:", err);
      throw err;
    }
    // Awaited (not fire-and-forget) so callers — onboarding — don't navigate
    // away until this has genuinely finished. Previously this ran in an
    // un-awaited inner IIFE: onboarding's `await setAlias(...)` resolved as
    // soon as the AsyncStorage writes above landed, then immediately
    // navigated while registration was still in flight. If the app
    // backgrounded/reloaded in that window, the server registration could
    // have already succeeded (claiming the alias) while the device token
    // never made it into SecureStore locally — leaving this device with no
    // proof it registered. The mount self-heal effect below would then see
    // "no local token" and re-register the same alias, self-inflicting a
    // 409 "already registered" against an alias this same device had
    // legitimately just claimed seconds earlier.
    try {
      // SecureStore is Keychain-backed on iOS, which survives app
      // deletion/reinstall — unlike the AsyncStorage "alias"/"isOnboarded"
      // flags checked above, which get wiped on uninstall. So a device
      // that self-destructed via reinstall (rather than in-app panicWipe,
      // which does clear these) comes back here as a "fresh" onboarding
      // with a brand-new alias, but with the PREVIOUS alias's device
      // token and identity keys still sitting in Keychain. Left
      // unchecked, the `existing` check below finds that stale token,
      // treats this device as already registered, and never calls
      // registerWithServer for the new alias at all — this device
      // silently stays bound to the old alias forever. Any SecureStore
      // identity data at the moment a NEW alias is being set necessarily
      // belongs to a different identity, so always start clean here.
      await Promise.all([
        secureDelete(DEVICE_TOKEN_KEY),
        secureDelete(MY_IK_PRIV_KEY),
        secureDelete(MY_IK_PUB_KEY),
        secureDelete(MY_SPK_PRIV_KEY),
        secureDelete(MY_SPK_PUB_KEY),
        secureDelete(MY_PQKEM_PRIV_KEY),
        secureDelete(MY_PQKEM_PUB_KEY),
      ]);
      const reg = await registerWithServer(alias);
      if (reg?.ok) {
        await secureSet(DEVICE_TOKEN_KEY, reg.token);
        await secureSet(MY_IK_PRIV_KEY, reg.ikPriv);
        await secureSet(MY_IK_PUB_KEY, reg.ikPub);
        await secureSet(MY_SPK_PRIV_KEY, reg.spkPriv);
        await secureSet(MY_SPK_PUB_KEY, reg.spkPub);
        await secureSet(MY_PQKEM_PRIV_KEY, reg.pqkemPriv);
        await secureSet(MY_PQKEM_PUB_KEY, reg.pqkemPub);
        setState((prev) => ({ ...prev, deviceToken: reg.token }));
        await generateAndUploadOPKs(alias, reg.token);
      } else if (reg && reg.conflict) {
        // Alias was taken between onboarding's availability check and
        // this registration call (race, or a stale check). No token
        // was issued, so this device's identity keys were never
        // actually registered — the user is left "onboarded" but
        // silently unable to message/call/receive push until they
        // notice and pick a different alias.
        console.warn(
          "[AppContext] Alias became unavailable during registration (race) — no identity registered",
          alias,
        );
        Alert.alert(
          "Alias already taken",
          "Someone just registered this alias. Please go back and choose a different one — " +
            "messaging, calls, and notifications won't work until you do.",
        );
      }
    } catch (e) {
      console.warn("[AppContext] Background registration failed:", e);
    }
  }, []);

  /**
   * Recover an identity from its alias + a 24-word recovery phrase — for a
   * device with no local keys and no device token (the case setAlias's
   * fresh-registration path and rekeyWithServer's still-has-a-token path
   * both miss). Unlike setAlias, this returns a real result: recovery is an
   * explicit, one-shot user action that needs synchronous success/failure
   * feedback, not fire-and-forget background registration.
   */
  const recoverIdentity = useCallback(async (
    alias: string,
    phrase: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    const recoveredIkPriv = recoveryPhraseToKey(phrase);
    if (!recoveredIkPriv) {
      return { ok: false, error: "invalid_phrase" };
    }

    // Same defensive clear as setAlias — any local SecureStore identity
    // material at this point belongs to whatever was previously on this
    // device, not the identity about to be recovered.
    await Promise.all([
      secureDelete(DEVICE_TOKEN_KEY),
      secureDelete(MY_IK_PRIV_KEY),
      secureDelete(MY_IK_PUB_KEY),
      secureDelete(MY_SPK_PRIV_KEY),
      secureDelete(MY_SPK_PUB_KEY),
      secureDelete(MY_PQKEM_PRIV_KEY),
      secureDelete(MY_PQKEM_PUB_KEY),
    ]);

    const result = await reclaimWithServer(alias, recoveredIkPriv);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    await secureSet(DEVICE_TOKEN_KEY, result.token);
    await secureSet(MY_IK_PRIV_KEY, result.ikPriv);
    await secureSet(MY_IK_PUB_KEY, result.ikPub);
    await secureSet(MY_SPK_PRIV_KEY, result.spkPriv);
    await secureSet(MY_SPK_PUB_KEY, result.spkPub);
    await secureSet(MY_PQKEM_PRIV_KEY, result.pqkemPriv);
    await secureSet(MY_PQKEM_PUB_KEY, result.pqkemPub);

    await AsyncStorage.setItem("alias", alias);
    await AsyncStorage.setItem("isOnboarded", "true");
    setState((prev) => ({ ...prev, alias, isOnboarded: true, isLocked: false, deviceToken: result.token }));

    await generateAndUploadOPKs(alias, result.token);
    return { ok: true };
  }, []);

  const getRecoveryPhrase = useCallback(async (): Promise<string | null> => {
    const ikPriv = await secureGet(MY_IK_PRIV_KEY);
    if (!ikPriv) return null;
    return keyToRecoveryPhrase(ikPriv);
  }, []);

  const setPin = useCallback(async (pin: string) => {
    try {
      await secureSet(SECURE_PIN_KEY, pin);
      setHasPin(true);
    } catch (err) {
      console.error("[AppContext] Failed to save PIN:", err);
      throw err;
    }
  }, []);

  const checkPin = useCallback(async (input: string): Promise<boolean> => {
    try {
      const stored = await secureGet(SECURE_PIN_KEY);
      return stored === input;
    } catch (err) {
      console.error("[AppContext] Failed to check PIN:", err);
      return false;
    }
  }, []);

  const checkDuressPin = useCallback(async (input: string): Promise<boolean> => {
    try {
      const stored = await secureGet(SECURE_DURESS_PIN_KEY);
      return stored !== null && stored === input;
    } catch (err) {
      console.error("[AppContext] Failed to check duress PIN:", err);
      return false;
    }
  }, []);

  const captureCurrentPinForTransition = useCallback(async (): Promise<void> => {
    try {
      prevMainPinRef.current = await secureGet(SECURE_PIN_KEY);
    } catch (err) {
      console.error("[AppContext] Failed to capture PIN for transition:", err);
      prevMainPinRef.current = null;
    }
  }, []);

  const checkPreviousMainPin = useCallback(async (candidate: string): Promise<boolean> => {
    return prevMainPinRef.current !== null && prevMainPinRef.current === candidate;
  }, []);

  const checkPinWithDuress = useCallback(async (input: string): Promise<{ correct: boolean; isDuress: boolean; isDecoy: boolean }> => {
    try {
      const [stored, duress, decoy] = await Promise.all([
        secureGet(SECURE_PIN_KEY),
        secureGet(SECURE_DURESS_PIN_KEY),
        secureGet(SECURE_DECOY_PIN_KEY),
      ]);
      if (stored === input) return { correct: true, isDuress: false, isDecoy: false };
      if (duress && duress === input) return { correct: true, isDuress: true, isDecoy: false };
      if (decoy && decoy === input) return { correct: true, isDuress: false, isDecoy: true };
      return { correct: false, isDuress: false, isDecoy: false };
    } catch (err) {
      console.error("[AppContext] Failed to check PIN with duress:", err);
      return { correct: false, isDuress: false, isDecoy: false };
    }
  }, []);

  const checkDecoyPin = useCallback(async (input: string): Promise<boolean> => {
    try {
      const stored = await secureGet(SECURE_DECOY_PIN_KEY);
      return stored !== null && stored === input;
    } catch (err) {
      console.error("[AppContext] Failed to check decoy PIN:", err);
      return false;
    }
  }, []);

  const setDecoyPin = useCallback(async (pin: string) => {
    try {
      await secureSet(SECURE_DECOY_PIN_KEY, pin);
      setHasDecoyPin(true);
    } catch (err) {
      console.error("[AppContext] Failed to save decoy PIN:", err);
      throw err;
    }
  }, []);

  const clearDecoyPin = useCallback(async () => {
    try {
      await secureDelete(SECURE_DECOY_PIN_KEY);
      setHasDecoyPin(false);
    } catch (err) {
      console.error("[AppContext] Failed to clear decoy PIN:", err);
      throw err;
    }
  }, []);

  const setWalletPin = useCallback(async (pin: string) => {
    try {
      await secureSet(SECURE_WALLET_PIN_KEY, pin);
      setHasWalletPin(true);
      // Setting/changing the PIN counts as unlocking — don't immediately
      // re-prompt for the PIN you just typed.
      setWalletUnlocked(true);
    } catch (err) {
      console.error("[AppContext] Failed to save wallet PIN:", err);
      throw err;
    }
  }, []);

  const checkWalletPin = useCallback(async (input: string): Promise<boolean> => {
    try {
      const stored = await secureGet(SECURE_WALLET_PIN_KEY);
      const correct = stored !== null && stored === input;
      if (correct) setWalletUnlocked(true);
      return correct;
    } catch (err) {
      console.error("[AppContext] Failed to check wallet PIN:", err);
      return false;
    }
  }, []);

  const clearWalletPin = useCallback(async () => {
    try {
      await secureDelete(SECURE_WALLET_PIN_KEY);
      setHasWalletPin(false);
      setWalletUnlocked(false);
    } catch (err) {
      console.error("[AppContext] Failed to clear wallet PIN:", err);
      throw err;
    }
  }, []);

  const enterDecoyMode = useCallback(() => {
    setDecoyMode(true);
  }, []);

  const exitDecoyMode = useCallback(() => {
    setDecoyMode(false);
  }, []);

  const setDuressPin = useCallback(async (pin: string) => {
    try {
      await secureSet(SECURE_DURESS_PIN_KEY, pin);
      setHasDuressPin(true);
    } catch (err) {
      console.error("[AppContext] Failed to save duress PIN:", err);
      throw err;
    }
  }, []);

  const clearDuressPin = useCallback(async () => {
    try {
      await secureDelete(SECURE_DURESS_PIN_KEY);
      await AsyncStorage.removeItem(DURESS_GRACE_KEY);
      setHasDuressPin(false);
      setState((prev) => ({ ...prev, duressGracePeriod: 3 }));
    } catch (err) {
      console.error("[AppContext] Failed to clear duress PIN:", err);
      throw err;
    }
  }, []);

  const setBiometricEnabled = useCallback(async (enabled: boolean) => {
    try {
      await AsyncStorage.setItem("biometricEnabled", String(enabled));
      setState((prev) => ({ ...prev, biometricEnabled: enabled }));
    } catch (err) {
      console.error("[AppContext] Failed to save biometric setting:", err);
      throw err;
    }
  }, []);

  // ── Satellite low-bandwidth mode (Task #111) ────────────────────────────
  // We don't have NetInfo wired up (no native module installed). Instead we
  // observe what we already control — WebSocket reconnect churn, outbox
  // failures, and the gap since the last successful auth ack — and feed
  // those into a pure classifier (lib/lowBandwidth.ts).
  const linkStatsRef = React.useRef<LinkStats>({
    recentReconnects: 0,
    recentSendFailures: 0,
    lastAuthAckAt: 0,
    reconnectingSince: 0,
  });
  // Ref mirror of `state.lowBandwidthActive` so the WS effect can pick the
  // right ping cadence / reconnect delay without re-running on every flip.
  const lbwActiveRef = React.useRef(false);

  // Keep `lbwActiveRef` in lockstep with state regardless of which path
  // mutated it (persisted load on cold start, panicWipe reset, classifier
  // recompute). The local setters update the ref themselves, but this
  // belt-and-suspenders effect guarantees the WS ping/reconnect cadence
  // is always reading the authoritative value.
  useEffect(() => {
    lbwActiveRef.current = state.lowBandwidthActive;
  }, [state.lowBandwidthActive]);

  // ── Outbox drain debouncer (LBW batching) ───────────────────────────
  // sendMessage in LBW mode pushes ciphertexts onto the outbox and calls
  // scheduleOutboxDrain() instead of invoking ws.send directly. This lets
  // a burst of rapid sends collapse into one debounced drain so the
  // satellite link sees one batched round trip rather than N separate
  // frames. We route through a ref because `drainOutbox` is declared
  // further down the component body (after sendMessage) — the ref is
  // wired up by a useEffect below once drainOutbox is in scope.
  const drainOutboxRef = React.useRef<(() => Promise<void>) | null>(null);
  const outboxDrainTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleOutboxDrain = useCallback(() => {
    if (outboxDrainTimerRef.current) {
      clearTimeout(outboxDrainTimerRef.current);
      outboxDrainTimerRef.current = null;
    }
    const delay = outboxDrainDebounceMs(lbwActiveRef.current);
    const fire = () => {
      outboxDrainTimerRef.current = null;
      drainOutboxRef.current?.().catch((e) => console.error("[Outbox] scheduled drain failed:", e));
    };
    if (delay === 0) {
      fire();
    } else {
      outboxDrainTimerRef.current = setTimeout(fire, delay);
    }
  }, []);

  const recomputeLinkQuality = useCallback(() => {
    const lq = classifyLinkQuality(linkStatsRef.current);
    setState((prev) => {
      const active = isLowBandwidthActive(lq, prev.lowBandwidthMode);
      if (prev.linkQuality === lq && prev.lowBandwidthActive === active) {
        lbwActiveRef.current = active;
        return prev;
      }
      lbwActiveRef.current = active;
      return { ...prev, linkQuality: lq, lowBandwidthActive: active };
    });
  }, []);

  const setLowBandwidthMode = useCallback(async (mode: LowBandwidthMode) => {
    try {
      await AsyncStorage.setItem(LOW_BW_MODE_KEY, mode);
      setState((prev) => {
        const active = isLowBandwidthActive(prev.linkQuality, mode);
        lbwActiveRef.current = active;
        return { ...prev, lowBandwidthMode: mode, lowBandwidthActive: active };
      });
    } catch (err) {
      console.error("[AppContext] Failed to save low-bandwidth mode:", err);
      throw err;
    }
  }, []);

  // Decay the churn counters once a minute so a brief satellite hiccup
  // doesn't keep low-bandwidth mode latched on forever after the link
  // recovers. Also re-classifies in case nothing else triggered a recompute.
  useEffect(() => {
    const t = setInterval(() => {
      const s = linkStatsRef.current;
      s.recentReconnects = Math.max(0, s.recentReconnects - 1);
      s.recentSendFailures = Math.max(0, s.recentSendFailures - 1);
      recomputeLinkQuality();
    }, 60_000);
    return () => clearInterval(t);
  }, [recomputeLinkQuality]);

  const setLocked = useCallback((locked: boolean) => {
    setState((prev) => ({ ...prev, isLocked: locked }));
    // A wallet-PIN unlock is scoped to this app-unlock session — the next
    // time the app locks (auto-lock, manual lock, backgrounding), the
    // wallet screen must ask again.
    if (locked) setWalletUnlocked(false);
  }, []);

  const setAutoLockTimeout = useCallback(async (ms: number | null) => {
    try {
      await AsyncStorage.setItem(AUTO_LOCK_TIMEOUT_KEY, ms === null ? "null" : String(ms));
      setState((prev) => ({ ...prev, autoLockTimeout: ms }));
    } catch (err) {
      console.error("[AppContext] Failed to save autoLockTimeout:", err);
      throw err;
    }
  }, []);

  const setSmsFallbackNumbers = useCallback(async (raw: string[]) => {
    // Normalize + validate + cap. Anything that doesn't pass E.164 is
    // silently dropped — the settings UI surfaces the validation error
    // before calling this, so a malformed entry reaching here is a bug,
    // not a user mistake we need to escalate.
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const entry of raw) {
      const n = normalizeE164(entry);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      normalized.push(n);
      if (normalized.length >= MAX_SMS_FALLBACK_NUMBERS) break;
    }
    try {
      await secureSet(SMS_FALLBACK_NUMBERS_KEY, JSON.stringify(normalized));
      setState((prev) => ({ ...prev, smsFallbackNumbers: normalized }));
    } catch (err) {
      console.error("[AppContext] Failed to save SMS fallback numbers:", err);
      throw err;
    }
  }, []);

  const setSmsFallbackMessage = useCallback(async (message: string) => {
    const cleaned = sanitizeFallbackMessage(message);
    try {
      await secureSet(SMS_FALLBACK_MESSAGE_KEY, cleaned);
      setState((prev) => ({ ...prev, smsFallbackMessage: cleaned }));
    } catch (err) {
      console.error("[AppContext] Failed to save SMS fallback message:", err);
      throw err;
    }
  }, []);

  const refreshEntitlement = useCallback(async () => {
    const apiBase = getApiBase();
    const { alias, deviceToken } = state;
    if (!apiBase || !alias || !deviceToken) return;
    try {
      const res = await fetch(
        `${apiBase}/crypto/entitlement?alias=${encodeURIComponent(alias)}`,
        { headers: { Authorization: `Bearer ${deviceToken}` } },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        entitlement: { plan: string; activeUntil: string; active: boolean } | null;
      };
      const ent = data.entitlement;
      const activePlan =
        ent && ent.active
          ? { plan: ent.plan, activeUntil: new Date(ent.activeUntil).getTime() }
          : null;
      setState((prev) => ({ ...prev, activePlan }));
    } catch (err) {
      console.warn("[AppContext] Failed to refresh entitlement:", err);
    }
  }, [state.alias, state.deviceToken]);

  // Load the on-chain-verified plan entitlement once the device is authed.
  useEffect(() => {
    if (state.alias && state.deviceToken) {
      void refreshEntitlement();
    }
  }, [state.alias, state.deviceToken, refreshEntitlement]);

  const setDuressGracePeriod = useCallback(async (seconds: number) => {
    const VALID_GRACE = [1, 2, 3, 5];
    const validated = VALID_GRACE.includes(seconds) ? seconds : 3;
    try {
      await AsyncStorage.setItem(DURESS_GRACE_KEY, String(validated));
      setState((prev) => ({ ...prev, duressGracePeriod: validated }));
    } catch (err) {
      console.error("[AppContext] Failed to save duressGracePeriod:", err);
      throw err;
    }
  }, []);

  const connectVPN = useCallback((server: VPNServer) => {
    setState((prev) => ({ ...prev, vpnConnected: true, vpnServer: server }));
    AsyncStorage.setItem(LAST_VPN_SERVER_KEY, server.id).catch((err) =>
      console.warn("[VPN] Failed to persist last VPN server:", err)
    );
  }, []);

  const disconnectVPN = useCallback(() => {
    setState((prev) => ({ ...prev, vpnConnected: false, vpnServer: null }));
  }, []);

  const deleteMessage = useCallback((conversationId: string, messageId: string) => {
    setState((prev) => {
      const updated = prev.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, messages: c.messages.filter((m) => m.id !== messageId) }
          : c
      );
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
  }, [persistConversations]);

  const clearConversation = useCallback((conversationId: string) => {
    setState((prev) => {
      const updated = prev.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, messages: [], lastMessage: "Chat cleared.", unread: 0 }
          : c
      );
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
  }, [persistConversations]);

  const deleteConversation = useCallback((conversationId: string) => {
    setState((prev) => {
      const updated = prev.conversations.filter((c) => c.id !== conversationId);
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
  }, [persistConversations]);

  const markConversationRead = useCallback((conversationId: string) => {
    setState((prev) => {
      const existing = prev.conversations.find((c) => c.id === conversationId);
      if (!existing || existing.unread === 0) return prev;
      const updated = prev.conversations.map((c) =>
        c.id === conversationId ? { ...c, unread: 0 } : c
      );
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
  }, [persistConversations]);

  // Keep the OS app-icon badge in sync with total unread across conversations.
  // shouldSetBadge:true (see usePushNotifications) bumps this on every push,
  // but nothing ever cleared it back down — it would just accumulate forever.
  useEffect(() => {
    const total = state.conversations.reduce((sum, c) => sum + c.unread, 0);
    Notifications.setBadgeCountAsync(total).catch(() => {});
  }, [state.conversations]);

  // Applies going forward only — never rewrites expiresAt on messages
  // already in the conversation, only the setting used for new sends and
  // for messages received from here on.
  const setDisappearTimer = useCallback((conversationId: string, secondsRaw: number) => {
    // Always-on policy: no undefined/OFF accepted, out-of-range clamped.
    const seconds = clampDisappearSec(secondsRaw);
    const conv = latestStateRef.current.conversations.find((c) => c.id === conversationId);
    setState((prev) => {
      const updated = prev.conversations.map((c) =>
        c.id === conversationId ? { ...c, disappearAfterSec: seconds } : c
      );
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
    // Sync the setting to the peer so it isn't just a local, one-sided
    // toggle. Ephemeral, same as presence: if the peer isn't connected
    // right now it just doesn't sync this time.
    if (conv?.isRealContact && conv.alias) {
      const ws = wsRef.current;
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "disappear-timer", to: conv.alias, seconds: seconds ?? null }));
      }
    }
  }, [persistConversations]);

  const setConversationBgColor = useCallback((conversationId: string, color: string | undefined) => {
    setState((prev) => {
      const updated = prev.conversations.map((c) =>
        // Picking a colour (or DEFAULT = undefined) always clears a custom
        // photo — the two wallpaper kinds are mutually exclusive.
        c.id === conversationId ? { ...c, bgColor: color, bgImageUri: undefined } : c
      );
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
  }, [persistConversations]);

  const setConversationBgImage = useCallback((conversationId: string, uri: string | undefined) => {
    setState((prev) => {
      const updated = prev.conversations.map((c) =>
        c.id === conversationId ? { ...c, bgImageUri: uri, bgColor: undefined } : c
      );
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
  }, [persistConversations]);

  /**
   * Stamp `viewedAt` (and derive `expiresAt = viewedAt + ttlMs`) on every
   * given message that has a TTL and hasn't been viewed yet — called when
   * the chat screen brings them on screen. Persists the write immediately,
   * in the same tick as the state update, so a force-quit right after
   * viewing can't reset the timer: there is no separate debounced-save path
   * here to race against, same as every other conversation mutation in this
   * file.
   */
  const markMessagesViewed = useCallback((conversationId: string, messageIds: string[]) => {
    if (messageIds.length === 0) return;
    const idSet = new Set(messageIds);
    setState((prev) => {
      let changed = false;
      const updated = prev.conversations.map((c) => {
        if (c.id !== conversationId) return c;
        const messages = c.messages.map((m) => {
          if (!idSet.has(m.id) || !m.ttlMs || m.viewedAt) return m;
          changed = true;
          const viewedAt = Date.now();
          return { ...m, viewedAt, expiresAt: viewedAt + m.ttlMs };
        });
        return changed ? { ...c, messages } : c;
      });
      if (!changed) return prev;
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
  }, [persistConversations]);

  const verifyConversation = useCallback((conversationId: string) => {
    setState((prev) => {
      const updated = prev.conversations.map((c) =>
        c.id === conversationId ? { ...c, verified: !c.verified } : c
      );
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
  }, [persistConversations]);

  const sendMessage = useCallback(
    (conversationId: string, text: string, attachment?: Attachment): { queued: boolean } => {
      const conv = latestStateRef.current.conversations.find((c) => c.id === conversationId);
      if (!conv) return { queued: false };
      if (!text.trim() && !attachment) return { queued: false };

      // Low-bandwidth refusal — defensive guard. The chat composer also
      // gates attachment pickers up-front, but if anything slips through
      // (programmatic call, race after toggle, retry of a queued send)
      // we refuse here too rather than burn satellite data on a photo.
      if (attachment && latestStateRef.current.lowBandwidthActive) {
        Alert.alert("Low-bandwidth mode", LBW_ATTACHMENT_REFUSAL_REASON);
        return { queued: false };
      }

      const myAlias = latestStateRef.current.alias ?? "GHOST_USER";
      const isRealContact = conv.isRealContact ?? false;
      const previewText = previewForMessage(text, attachment);

      // For real contacts, verify the WebSocket is open BEFORE advancing the
      // ratchet. Advancing the ratchet state without delivering the message
      // causes an unrecoverable desync — the receiver's chain key will be
      // behind the sender's and every subsequent message will fail to decrypt.
      if (isRealContact) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== 1) {
          // WS is down — queue plaintext for delivery on reconnect.
          // We do NOT advance the ratchet here; drainOutbox will encrypt
          // at the moment of actual delivery, preserving ratchet ordering.
          const now = Date.now();
          const pendingId = `pending-${now}${Math.random().toString(36).substr(2, 9)}`;
          const outboxItem: OutboxItem = { id: pendingId, conversationId, text, attempts: 0, attachment, createdAt: now };
          const nextOutbox = sortByCompose([...outboxRef.current, outboxItem]);
          outboxRef.current = nextOutbox;
          persistOutbox(nextOutbox);
          const pendingMsg: Message = {
            id: pendingId,
            text,
            fromMe: true,
            timestamp: now,
            encrypted: false,
            sealed: false,
            pending: true,
            attachment,
          };
          setState((prev) => {
            const updated = prev.conversations.map((c) =>
              c.id === conversationId
                ? { ...c, messages: [...c.messages, pendingMsg], lastMessage: previewText, timestamp: now, unread: 0 }
                : c
            );
            persistConversations(updated);
            return { ...prev, conversations: updated };
          });
          console.warn("[WS] Offline — message queued:", pendingId);
          return { queued: true };
        }
      }

      let aliceMsg: RatchetMessage | undefined;
      let updatedDRSession = conv.drSession;

      // A message can only be sent over an established real Double Ratchet
      // session bootstrapped from a real X3DH handshake. We never fabricate or
      // simulate a session — if one is missing or the ratchet step fails, the
      // send fails cleanly and the user is told. No deterministic fallback.
      const recordSendFailure = (reason: string): { queued: boolean } => {
        const failedMsg: Message = {
          id: `${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
          text,
          fromMe: true,
          timestamp: Date.now(),
          encrypted: false,
          sealed: false,
          failed: true,
          attachment,
        };
        setState((prev) => {
          const updated = prev.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, messages: [...c.messages, failedMsg], lastMessage: previewText, timestamp: Date.now(), unread: 0 }
              : c
          );
          persistConversations(updated);
          return { ...prev, conversations: updated };
        });
        Alert.alert("Send failed", reason);
        return { queued: false };
      };

      // A send is only ever permitted over a real, server-bootstrapped X3DH
      // session. `isRealContact` is set together with `drSession` whenever a
      // real handshake completes; a conversation that has one without the other
      // can only be stale local-only state (e.g. legacy persisted data). We
      // refuse it here rather than appending a message that is never delivered.
      if (!isRealContact || !conv.drSession) {
        console.error("[DR] Aborting send: no secure session for", conversationId);
        return recordSendFailure(
          "No secure channel with this contact yet. Add them again to run a key exchange."
        );
      }

      const outgoingTtlMs = clampDisappearSec(conv.disappearAfterSec) * 1000;
      // Generated up front so the same id goes into both the wire envelope
      // (below) and this device's own copy of the message — the receiver
      // adopts this id verbatim rather than minting its own.
      const newMsgId = `${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
      {
        const drSession = conv.drSession;
        const wireText = wrapPayload(myAlias.toUpperCase(), newMsgId, text, attachment, outgoingTtlMs);
        try {
          const { state: newAlice, message: msg } = ratchetEncrypt(drSession.alice, wireText);
          updatedDRSession = { ...drSession, alice: newAlice, lastAliceHeader: msg.header };
          aliceMsg = msg;
        } catch (e) {
          console.error("[DR] Encrypt failed:", e);
        }
      }

      if (!aliceMsg) {
        console.error("[DR] Aborting send: could not encrypt with DR");
        return recordSendFailure("Message could not be encrypted. Please try again.");
      }

      // Sender's own copy starts its timer at send time, same as before —
      // only the receiver's copy waits for a view event (see markMessagesViewed).
      const expiresAt = outgoingTtlMs ? Date.now() + outgoingTtlMs : undefined;

      const newMsg: Message = {
        id: newMsgId,
        text,
        fromMe: true,
        timestamp: Date.now(),
        encrypted: true,
        sealed: true,
        ciphertext: aliceMsg.ciphertext,
        fingerprint: `DR:${aliceMsg.ciphertext.slice(0, 8).toUpperCase()}`,
        ttlMs: outgoingTtlMs,
        expiresAt,
        attachment,
      };

      const headerToSend = conv.pendingX3DHHeader;

      // For real contacts: send over WebSocket FIRST, then commit the advanced
      // ratchet state to React state. If the send throws for any reason, we
      // bail before persisting — keeping sender and receiver in sync.
      //
      // Low-bandwidth mode short-circuit: when LBW is active, we route the
      // outgoing message through the outbox + a debounced drain instead of
      // an immediate ws.send. Successive rapid sends accumulate in the
      // outbox and then drain together (see scheduleOutboxDrain below),
      // which is the "batch outgoing ciphertexts" line item from the task.
      // We DO NOT advance the ratchet here in that path — drainOutbox
      // encrypts at delivery time so ordering still matches the receiver.
      //
      // We also divert to the outbox when we don't yet know the recipient's
      // opaque delivery token (task #128). This happens on the replying side of
      // an inbound session, whose conversation was created from a received
      // message and never captured the token. drainOutbox is async and resolves
      // + persists the token before sending; routing through it keeps this
      // synchronous send path from having to block on a network round-trip.
      if (
        isRealContact &&
        aliceMsg &&
        (latestStateRef.current.lowBandwidthActive || !conv.recipientDeliveryId)
      ) {
        const now = Date.now();
        const pendingId = `pending-${now}${Math.random().toString(36).substr(2, 9)}`;
        const outboxItem: OutboxItem = { id: pendingId, conversationId, text, attempts: 0, attachment, createdAt: now };
        const nextOutbox = sortByCompose([...outboxRef.current, outboxItem]);
        outboxRef.current = nextOutbox;
        persistOutbox(nextOutbox);
        const pendingMsg: Message = {
          id: pendingId,
          text,
          fromMe: true,
          timestamp: now,
          encrypted: false,
          sealed: false,
          pending: true,
          attachment,
        };
        setState((prev) => {
          const updated = prev.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, messages: [...c.messages, pendingMsg], lastMessage: previewText, timestamp: Date.now(), unread: 0 }
              : c
          );
          persistConversations(updated);
          return { ...prev, conversations: updated };
        });
        scheduleOutboxDrain();
        return { queued: true };
      }

      if (isRealContact && aliceMsg) {
        const ws = wsRef.current;
        if (ws && ws.readyState === 1) {
          try {
            // `to` is the recipient's opaque delivery token, never their alias —
            // guaranteed present here because a missing token diverts to the
            // outbox above. The sender's identity rides only inside the
            // encrypted payload (wrapPayload), never on the wire.
            ws.send(JSON.stringify({
              type: "msg",
              to: conv.recipientDeliveryId,
              payload: JSON.stringify(aliceMsg),
              x3dhHeader: headerToSend,
            }));
          } catch (e) {
            console.error("[WS] send() threw — aborting ratchet commit", e);
            const wsFailedMsg: Message = {
              ...newMsg,
              failed: true,
              pending: false,
            };
            setState((prev) => {
              const updated = prev.conversations.map((c) =>
                c.id === conversationId
                  ? { ...c, messages: [...c.messages, wsFailedMsg], lastMessage: previewText, timestamp: Date.now(), unread: 0 }
                  : c
              );
              persistConversations(updated);
              return { ...prev, conversations: updated };
            });
            Alert.alert("Send failed", "Message could not be sent. Tap RETRY to try again.");
            return { queued: false };
          }
        } else {
          // WS became unavailable between the guard check and here (race).
          // Queue the message so it delivers on reconnect instead of being lost.
          console.warn("[WS] Socket closed before send — queuing message for retry");
          const now = Date.now();
          const pendingId = `pending-${now}${Math.random().toString(36).substr(2, 9)}`;
          const outboxItem: OutboxItem = { id: pendingId, conversationId, text, attempts: 0, attachment, createdAt: now };
          const nextOutbox = sortByCompose([...outboxRef.current, outboxItem]);
          outboxRef.current = nextOutbox;
          persistOutbox(nextOutbox);
          const pendingMsg: Message = {
            id: pendingId,
            text,
            fromMe: true,
            timestamp: Date.now(),
            encrypted: false,
            sealed: false,
            pending: true,
            attachment,
          };
          setState((prev) => {
            const updated = prev.conversations.map((c) =>
              c.id === conversationId
                ? { ...c, messages: [...c.messages, pendingMsg], lastMessage: previewText, timestamp: Date.now(), unread: 0 }
                : c
            );
            persistConversations(updated);
            return { ...prev, conversations: updated };
          });
          return { queued: true };
        }
      }

      setState((prev) => {
        const updated = prev.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                messages: [...c.messages, newMsg],
                lastMessage: previewText,
                timestamp: Date.now(),
                unread: 0,
                drSession: updatedDRSession,
                // Clear the pending X3DH header only for real contacts after a
                // confirmed send. Non-real contacts don't use this field.
                pendingX3DHHeader: isRealContact ? undefined : c.pendingX3DHHeader,
              }
            : c
        );
        persistConversations(updated);
        return { ...prev, conversations: updated };
      });

      return { queued: false };
    },
    [persistConversations, persistOutbox]
  );

  /**
   * Send (or retract) a reaction on `targetMessageId`. Mirrors sendMessage's
   * WS-down / LBW-or-no-token / ws-race branches so reactions get the same
   * outbox + backoff + retry behavior as real messages, but simpler: there's
   * no pending/failed UI for a reaction (best-effort, like Ghostpad's live
   * text), and the sender applies its own local state immediately since it
   * never receives its own reaction back over the wire.
   */
  const sendReaction = useCallback((conversationId: string, targetMessageId: string, emoji: string) => {
    const conv = latestStateRef.current.conversations.find((c) => c.id === conversationId);
    if (!conv) return;
    const targetMsg = conv.messages.find((m) => m.id === targetMessageId);
    if (!targetMsg) return;

    const myAlias = (latestStateRef.current.alias ?? "GHOST_USER").toUpperCase();
    const isRealContact = conv.isRealContact ?? false;
    // The sender decides add vs remove by checking its OWN current state —
    // this is the only "toggle" in the whole reaction flow. What actually
    // transmits is the resulting explicit intent (`add`), never a toggle
    // instruction, so a retried/duplicate delivery can't reverse it.
    const add = !(targetMsg.reactions?.[emoji] ?? []).includes(myAlias);

    setState((prev) => {
      const updated = prev.conversations.map((c) => {
        if (c.id !== conversationId) return c;
        const messages = c.messages.map((m) =>
          m.id === targetMessageId ? { ...m, reactions: applyReaction(m.reactions, emoji, myAlias, add) } : m
        );
        return { ...c, messages };
      });
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });

    if (!isRealContact || !conv.drSession) return; // mock/sketch contact — local-only, nothing to transmit

    const reactionId = `${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    const reactionPayload = { m: targetMessageId, e: emoji, o: add };

    const queueReaction = () => {
      const outboxItem: OutboxItem = {
        id: reactionId,
        conversationId,
        text: "",
        attempts: 0,
        createdAt: Date.now(),
        reaction: reactionPayload,
      };
      const nextOutbox = sortByCompose([...outboxRef.current, outboxItem]);
      outboxRef.current = nextOutbox;
      persistOutbox(nextOutbox);
      scheduleOutboxDrain();
    };

    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1 || latestStateRef.current.lowBandwidthActive || !conv.recipientDeliveryId) {
      queueReaction();
      return;
    }

    try {
      const wireText = wrapPayload(myAlias, reactionId, "", undefined, undefined, reactionPayload);
      const { state: newAlice, message: msg } = ratchetEncrypt(conv.drSession.alice, wireText);
      ws.send(JSON.stringify({
        type: "msg",
        to: conv.recipientDeliveryId,
        payload: JSON.stringify(msg),
        x3dhHeader: conv.pendingX3DHHeader,
      }));
      setState((prev) => {
        const updated = prev.conversations.map((c) =>
          c.id === conversationId && c.drSession
            ? { ...c, drSession: { ...c.drSession, alice: newAlice }, pendingX3DHHeader: undefined }
            : c
        );
        persistConversations(updated);
        return { ...prev, conversations: updated };
      });
    } catch (e) {
      console.error("[Reaction] Immediate send failed — queuing to outbox:", e);
      queueReaction();
    }
  }, [persistConversations, persistOutbox, scheduleOutboxDrain]);

  const addConversation = useCallback(
    async (alias: string) => {
      // Reject rather than silently transform — a decorated/Unicode alias
      // must never be allowed to collapse into a different, unintended
      // target after this point (see utils/alias.ts).
      const aliasUpper = normalizeAlias(alias);
      if (!aliasUpper) {
        return { ok: false, error: "invalid_alias" };
      }
      const apiBase = getApiBase();
      if (!apiBase) {
        return { ok: false, error: "server_unreachable" };
      }

      // Step 1: The contact MUST exist on the server as a real, registered user.
      // There is no simulated/demo contact path — if they are not registered we
      // cannot run a real X3DH handshake, so we refuse to create the channel.
      let userExistsOnServer: boolean;
      try {
        const checkRes = await fetch(`${apiBase}/users/exists/${encodeURIComponent(aliasUpper)}`);
        userExistsOnServer = checkRes.ok;
      } catch {
        return { ok: false, error: "server_unreachable" };
      }
      if (!userExistsOnServer) {
        return { ok: false, error: "not_found" };
      }

      // Step 2: Fetch the contact's real PUBLIC prekey bundle.
      let bundle = await fetchContactBundle(aliasUpper);
      if (!bundle) {
        return { ok: false, error: "no_bundle" };
      }

      // Step 3: Run a real X3DH handshake using OUR private identity keys, which
      // never leave this device. If our own keys are missing we rotate them on
      // the server first. No deterministic/simulated session is ever fabricated.
      let drSession: DRSession;
      let usedOPK = false;
      let pendingX3DHHeader: string;

      try {
        const [myIKPriv, myIKPub, mySpkPriv, mySpkPub] = await Promise.all([
          secureGet(MY_IK_PRIV_KEY),
          secureGet(MY_IK_PUB_KEY),
          secureGet(MY_SPK_PRIV_KEY),
          secureGet(MY_SPK_PUB_KEY),
        ]);

        let ikPrivFinal = myIKPriv;
        let ikPubFinal  = myIKPub;
        let spkPrivFinal = mySpkPriv;
        let spkPubFinal  = mySpkPub;

        if (!ikPrivFinal || !ikPubFinal || !spkPrivFinal || !spkPubFinal) {
          // Own keys missing — rotate them on the server using the existing
          // device token so we can proceed with a real X3DH handshake.
          const token = await secureGet(DEVICE_TOKEN_KEY);
          const selfAlias = state.alias;
          if (token && selfAlias) {
            console.warn("[X3DH] Own keys missing — attempting rekey before session init for self:", selfAlias);
            const rekey = await rekeyWithServer(selfAlias, token);
            if (rekey) {
              await Promise.all([
                secureSet(MY_IK_PRIV_KEY, rekey.ikPriv),
                secureSet(MY_IK_PUB_KEY,  rekey.ikPub),
                secureSet(MY_SPK_PRIV_KEY, rekey.spkPriv),
                secureSet(MY_SPK_PUB_KEY,  rekey.spkPub),
                secureSet(MY_PQKEM_PRIV_KEY, rekey.pqkemPriv),
                secureSet(MY_PQKEM_PUB_KEY,  rekey.pqkemPub),
              ]);
              await generateAndUploadOPKs(selfAlias, token);
              ikPrivFinal  = rekey.ikPriv;
              ikPubFinal   = rekey.ikPub;
              spkPrivFinal = rekey.spkPriv;
              spkPubFinal  = rekey.spkPub;
              // Re-fetch contact bundle so it picks up fresh OPKs if any
              const refreshed = await fetchContactBundle(aliasUpper);
              if (refreshed) bundle = refreshed;
            }
          }
        }

        if (!ikPrivFinal || !ikPubFinal || !spkPrivFinal || !spkPubFinal) {
          // Still no own private keys — we cannot run a real handshake.
          console.error("[X3DH] Own private keys unavailable — cannot establish real session for", aliasUpper);
          return { ok: false, error: "no_own_keys" };
        }

        const { session, x3dhHeader } = initSessionAliceWithHeader(bundle, ikPrivFinal, ikPubFinal);
        drSession = session;
        usedOPK = !!bundle.opkPublicKey;
        pendingX3DHHeader = JSON.stringify(x3dhHeader);
      } catch (e) {
        if (e instanceof PqDowngradeError) {
          console.error("[X3DH] Refusing classical-only session for", aliasUpper, e);
          return { ok: false, error: "pq_downgrade" };
        }
        console.error("[X3DH] Real session init failed for", aliasUpper, e);
        return { ok: false, error: "x3dh_failed" };
      }

      setState((prev) => {
        const id = `${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
        const safetyNumber = generateSafetyNumber(prev.alias ?? "GHOST_USER", aliasUpper);
        const newConv: Conversation = {
          id,
          alias: aliasUpper,
          lastMessage: "Double Ratchet session established.",
          timestamp: Date.now(),
          unread: 0,
          safetyNumber,
          drSession,
          isRealContact: true,
          disappearAfterSec: DEFAULT_DISAPPEAR_SEC,
          pendingX3DHHeader,
          recipientDeliveryId: bundle.deliveryId,
          messages: [
            buildSystemMessage(
              usedOPK
                ? "Double Ratchet E2EE channel established. X3DH key exchange complete (4-DH with one-time prekey)."
                : "Double Ratchet E2EE channel established. X3DH key exchange complete.",
            ),
          ],
        };
        const updated = [newConv, ...prev.conversations];
        persistConversations(updated);
        return { ...prev, conversations: updated };
      });

      // Step 4: Replenish OPKs for ourselves in the background if supply is low
      (async () => {
        try {
          const token = await secureGet(DEVICE_TOKEN_KEY);
          const currentAlias = (await AsyncStorage.getItem("alias")) ?? "";
          if (token && currentAlias) {
            await replenishOPKsIfNeeded(currentAlias, token);
          }
        } catch {
          // Non-critical
        }
      })();

      return { ok: true };
    },
    [persistConversations]
  );

  const refreshAppTokenBalances = useCallback(async () => {
    const owner = latestStateRef.current.connectedWalletAddress;
    const { tokens, balances } = await fetchAppTokensAndBalances(owner);
    if (tokens.length === 0) return;
    setState((prev) => ({
      ...prev,
      appTokens: tokens,
      // Ordered by id ascending server-side (routes/tokens.ts) — id 1 is
      // CASPER, id 2 is the second app token (Fantasma). Falls back to the
      // previous value rather than 0 if the list ever comes back shorter.
      casperBalance: balances[0] ?? prev.casperBalance,
      fdBalance: balances[1] ?? prev.fdBalance,
    }));
  }, []);

  const connectWallet = useCallback(async (address: string): Promise<{ error?: string }> => {
    const trimmed = address.trim();
    if (!isValidSolanaAddress(trimmed)) {
      return { error: "Invalid Solana address. Please check and try again." };
    }
    try {
      await AsyncStorage.setItem(CONNECTED_WALLET_KEY, trimmed);
      setState((prev) => ({ ...prev, connectedWalletAddress: trimmed, solBalance: 0, fdBalance: 0, casperBalance: 0 }));
      fetchSolBalance(trimmed).then((bal) =>
        setState((prev) => ({ ...prev, solBalance: bal }))
      );
      fetchAppTokensAndBalances(trimmed).then(({ tokens, balances }) => {
        if (tokens.length === 0) return;
        setState((prev) => ({
          ...prev,
          appTokens: tokens,
          casperBalance: balances[0] ?? 0,
          fdBalance: balances[1] ?? 0,
        }));
      });
      return {};
    } catch (err) {
      console.error("[AppContext] Failed to save connected wallet:", err);
      return { error: "Failed to save wallet address." };
    }
  }, []);

  const disconnectWallet = useCallback(async () => {
    await AsyncStorage.removeItem(CONNECTED_WALLET_KEY);
    // Token balances belonged to the wallet that just disconnected — zero
    // them out too, but keep appTokens (name/symbol/mint) so the tabs don't
    // flash back to placeholder labels.
    setState((prev) => ({ ...prev, connectedWalletAddress: null, solBalance: 0, fdBalance: 0, casperBalance: 0 }));
  }, []);

  /**
   * Create the device's own non-custodial Solana wallet.
   *
   * Only the private key is persisted — never the phrase. That makes the
   * returned phrase genuinely single-use: there is no "show it again later"
   * because the app does not keep it. The caller is responsible for forcing
   * the user to acknowledge they've written it down.
   *
   * Refuses when a wallet already exists. Overwriting silently would strand
   * any funds held by the existing address behind a phrase nobody recorded.
   */
  const createLocalWallet = useCallback(async (): Promise<{ phrase: string } | { error: string }> => {
    // Re-read storage rather than trusting state — cheaper than reasoning
    // about whether a concurrent restore has landed since the last render.
    const existing = await readEncryptedString(LOCAL_WALLET_PRIV_KEY);
    if (existing) {
      return { error: "A wallet already exists on this device." };
    }
    try {
      const { wallet, phrase } = createWallet();
      await writeEncryptedString(LOCAL_WALLET_PRIV_KEY, wallet.privateKeyHex);
      setState((prev) => ({ ...prev, walletAddress: wallet.address }));
      return { phrase };
    } catch (err) {
      // Deliberately does not echo the error detail — anything thrown from
      // key generation could carry key material.
      console.error("[AppContext] Wallet creation failed:", err instanceof Error ? err.message : "unknown");
      return { error: "Could not create a wallet. Please try again." };
    }
  }, []);

  /**
   * Restore a wallet from its 24-word phrase. Replaces whatever key is
   * currently stored — the phrase the user just supplied is, by definition,
   * the one they have a record of.
   */
  const restoreLocalWallet = useCallback(async (phrase: string): Promise<{ error?: string }> => {
    if (!isValidWalletPhrase(phrase)) {
      return { error: "That doesn't look like a valid 24-word recovery phrase." };
    }
    const wallet = walletFromPhrase(phrase);
    if (!wallet) {
      return { error: "That doesn't look like a valid 24-word recovery phrase." };
    }
    try {
      await writeEncryptedString(LOCAL_WALLET_PRIV_KEY, wallet.privateKeyHex);
      setState((prev) => ({ ...prev, walletAddress: wallet.address }));
      return {};
    } catch (err) {
      console.error("[AppContext] Wallet restore failed:", err instanceof Error ? err.message : "unknown");
      return { error: "Could not save the restored wallet. Please try again." };
    }
  }, []);

  const setLanguage = useCallback(async (code: string) => {
    const VALID_LANGUAGES = ["en","es","fr","de","ja","zh","ar","pt","ru","ko","hi","it"];
    if (!VALID_LANGUAGES.includes(code)) return;
    await AsyncStorage.setItem(LANGUAGE_KEY, code);
    setState((prev) => ({ ...prev, language: code }));
  }, []);

  const setThemePreference = useCallback(async (theme: "dark" | "light") => {
    await AsyncStorage.setItem(THEME_KEY, theme);
    setState((prev) => ({ ...prev, themePreference: theme }));
  }, []);

  // Caller must pass an already-copied documentDirectory file:// URI (see
  // pickProfileImage in settings.tsx) — this only persists the reference
  // and deletes the previous file, mirroring setConversationBgImage/
  // removeBgImageFile's split of responsibilities.
  const setProfileImage = useCallback(async (uri: string | null) => {
    const previous = latestStateRef.current.profileImageUri;
    if (previous && previous !== uri) {
      await FileSystem.deleteAsync(previous, { idempotent: true }).catch(() => {});
    }
    if (uri) {
      await AsyncStorage.setItem(PROFILE_IMAGE_KEY, uri);
    } else {
      await AsyncStorage.removeItem(PROFILE_IMAGE_KEY);
    }
    setState((prev) => ({ ...prev, profileImageUri: uri }));
  }, []);

  // SILENCE CONTRACT: panicWipe must never produce any haptic or audio
  // feedback. A bystander must not be able to detect that a wipe occurred
  // because of an unexpected vibration or sound. Do not add Haptics calls,
  // Audio playback, or any other perceptible feedback here — including in
  // future changes. The duress countdown in lock.tsx relies on this guarantee.
  const panicWipe = useCallback(async () => {
    // Capture the SMS fallback recipients + message BEFORE we touch
    // anything else. The wipe below clears `state.smsFallbackNumbers`
    // and deletes the SecureStore copies; without this snapshot the
    // SMS handoff would always run against an empty list (Task #113).
    const snapshotNumbers = latestStateRef.current.smsFallbackNumbers;
    const snapshotMessage = latestStateRef.current.smsFallbackMessage;

    // Best-effort: notify known real contacts that we are gone, so their
    // app can flag this conversation as self-destructed. Must happen BEFORE
    // we clear local state (which closes the WS) and must NEVER produce
    // perceptible feedback — the silence contract still applies.
    //
    // Task #113: we wait for an explicit server `departed_ack` keyed by
    // requestId before deciding NOT to fire the SMS fallback. A bare
    // ws.send() with readyState===1 is not enough — a half-open socket,
    // server overload, or crash between send and process would silently
    // skip the fallback. If no ack lands within DEPARTED_ACK_TIMEOUT_MS,
    // we fall through to SMS.
    const DEPARTED_ACK_TIMEOUT_MS = 1500;
    let serverAckReceived = false;
    try {
      const ws = wsRef.current;
      const realAliases = latestStateRef.current.conversations
        .filter((c) => c.isRealContact && !c.destroyedAt)
        .map((c) => c.alias)
        .filter((a): a is string => typeof a === "string" && a.length > 0);
      if (ws && ws.readyState === 1 && realAliases.length > 0) {
        const requestId = `dep-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        // Attach a one-shot ack listener BEFORE sending. We listen
        // directly on the WS (not through handleIncomingWsMessage) so
        // the panic path stays self-contained and the central handler
        // doesn't need a new branch. The listener resolves the wait
        // promise on a matching requestId and detaches itself.
        const ackPromise = new Promise<boolean>((resolve) => {
          let settled = false;
          const onMessage = (event: { data: unknown }) => {
            if (settled) return;
            const data = typeof event?.data === "string" ? event.data : null;
            if (!data) return;
            try {
              const parsed = JSON.parse(data);
              if (
                parsed &&
                parsed.type === "departed_ack" &&
                parsed.requestId === requestId
              ) {
                settled = true;
                ws.removeEventListener?.("message", onMessage as never);
                resolve(true);
              }
            } catch {
              /* ignore non-JSON frames */
            }
          };
          ws.addEventListener?.("message", onMessage as never);
          setTimeout(() => {
            if (settled) return;
            settled = true;
            ws.removeEventListener?.("message", onMessage as never);
            resolve(false);
          }, DEPARTED_ACK_TIMEOUT_MS);
        });
        ws.send(
          JSON.stringify({
            type: "departed",
            toAliases: realAliases,
            requestId,
          }),
        );
        serverAckReceived = await ackPromise;
      }
    } catch (err) {
      console.warn("[AppContext] Failed to broadcast departure:", err);
    }

    // SMS satellite fallback (Task #113). Fires when the server didn't
    // ack the departed broadcast within the timeout — covering offline,
    // half-open sockets, and server-side failures. The OS SMS composer
    // (including direct-to-cell satellite on iOS 18+) carries the ping.
    //
    // SILENCE CONTRACT: handoffSmsFallback() must not invoke Haptics,
    // Audio, Toast, or Alert. See scripts/check-panic-wipe-silence.js.
    if (!serverAckReceived && snapshotNumbers.length > 0) {
      try {
        await handoffSmsFallback(snapshotNumbers, snapshotMessage);
      } catch (err) {
        console.warn("[AppContext] SMS fallback handoff failed:", err);
      }
    }

    // Release the alias server-side while we still hold a valid device
    // token to prove ownership — this must happen before the SecureStore
    // wipe below deletes that token. See unregisterFromServer for why:
    // without this, re-registering the same alias after self-destructing
    // always 409s, since the server otherwise has no way to reissue it.
    {
      const currentAlias = latestStateRef.current.alias;
      const currentToken = await secureGet(DEVICE_TOKEN_KEY);
      if (currentAlias && currentToken) {
        await unregisterFromServer(currentAlias, currentToken);
      }
    }

    // Delete the profile photo FILE itself, not just the AsyncStorage
    // reference below — a photo is identifying, so self-destruct must
    // actually remove it from disk, not just forget where it was.
    {
      const currentProfileImage = latestStateRef.current.profileImageUri;
      if (currentProfileImage) {
        await FileSystem.deleteAsync(currentProfileImage, { idempotent: true }).catch(() => {});
      }
    }

    try {
      await Promise.all([
        ...APP_STORAGE_KEYS.map((k) => AsyncStorage.removeItem(k)),
        secureDelete(SECURE_PIN_KEY),
        secureDelete(SECURE_DURESS_PIN_KEY),
        secureDelete(SECURE_DECOY_PIN_KEY),
        secureDelete(SECURE_WALLET_PIN_KEY),
        secureDelete(DEVICE_TOKEN_KEY),
        secureDelete(MY_IK_PRIV_KEY),
        secureDelete(MY_IK_PUB_KEY),
        secureDelete(MY_SPK_PRIV_KEY),
        secureDelete(MY_SPK_PUB_KEY),
        secureDelete(MY_PQKEM_PRIV_KEY),
        secureDelete(MY_PQKEM_PUB_KEY),
        secureDelete(SMS_FALLBACK_NUMBERS_KEY),
        secureDelete(SMS_FALLBACK_MESSAGE_KEY),
      ]);
    } catch (err) {
      console.error("[AppContext] Panic wipe storage error:", err);
    }
    // Clear in-memory outbox state too — the AsyncStorage key was
    // removed above, but stale queued items and their pending retry
    // timers would otherwise survive in the running provider until a
    // remount. Silence contract: pure state mutation, no haptics/audio.
    outboxRef.current = [];
    if (outboxRetryTimerRef.current) {
      clearTimeout(outboxRetryTimerRef.current);
      outboxRetryTimerRef.current = null;
    }
    if (outboxDrainTimerRef.current) {
      clearTimeout(outboxDrainTimerRef.current);
      outboxDrainTimerRef.current = null;
    }
    setHasPin(false);
    setHasDuressPin(false);
    setHasDecoyPin(false);
    setHasWalletPin(false);
    setWalletUnlocked(false);
    setDecoyMode(false);
    setState({
      alias: null,
      deviceToken: null,
      activePlan: null,
      biometricEnabled: false,
      isLocked: false,
      isOnboarded: false,
      vpnConnected: false,
      vpnServer: null,
      conversations: [],
      callHistory: [],
      fdBalance: 0,
      casperBalance: 0,
      appTokens: [],
      walletAddress: null,
      transactions: DEFAULT_TRANSACTIONS,
      connectedWalletAddress: null,
      solBalance: 0,
      autoLockTimeout: 5 * 60 * 1000,
      duressGracePeriod: 3,
      language: "en",
      themePreference: "dark",
      profileImageUri: null,
      incomingCall: null,
      ghostpad: { mode: "idle", code: null },
      linkQuality: "unknown",
      lowBandwidthMode: "auto",
      // Same derivation as createInitialState — AUTO+UNKNOWN must start
      // active per task spec so the user doesn't briefly burn satellite
      // bytes between panicWipe reset and the first classifier tick.
      lowBandwidthActive: isLowBandwidthActive("unknown", "auto"),
      smsFallbackNumbers: [],
      smsFallbackMessage: DEFAULT_SMS_FALLBACK_MESSAGE,
    });
  }, []);

  const sendCallSignal = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    } else {
      pendingCallSignalsRef.current.push({ msg, queuedAt: Date.now() });
      console.warn(
        `[CallSignal] WS not open (readyState=${ws?.readyState ?? "none"}) — queued signal:`,
        msg,
      );
    }
  }, []);

  // Signals queued by sendCallSignal while the WS was closed. Must be
  // flushed only once the server has actually ack'd auth (see the "ack"
  // branch in handleIncomingWsMessage below) — api-server's ws/manager.ts
  // awaits validateToken() before setting authedAlias, so anything sent
  // right after ws.onopen can still race that await and get rejected
  // server-side with "not authenticated", silently dropped rather than
  // relayed. Flushing on the ack means the socket is provably authed first.
  const CALL_SIGNAL_QUEUE_TTL_MS = 15_000;
  const flushPendingCallSignals = useCallback(() => {
    const ws = wsRef.current;
    const queued = pendingCallSignalsRef.current;
    pendingCallSignalsRef.current = [];
    const now = Date.now();
    for (const { msg, queuedAt } of queued) {
      const age = now - queuedAt;
      // A hangup is exempt from the TTL: it's still meaningful arbitrarily
      // late (worst case the receiver's incoming-call UI dismisses a bit
      // late), whereas dropping it leaves that UI — CallKit's native banner
      // or our in-app overlay — stuck showing a call that's actually over.
      // Everything else here (offers/answers/ICE candidates) really is
      // useless once stale, so those keep the cutoff.
      const msgType = (msg as { type?: string }).type;
      if (msgType !== "call-hangup" && age > CALL_SIGNAL_QUEUE_TTL_MS) {
        console.warn(`[CallSignal] Dropping stale queued signal (${age}ms old):`, msg);
        continue;
      }
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
      } else {
        console.warn("[CallSignal] Dropping queued signal — socket not open at flush time:", msg);
      }
    }
  }, []);

  const registerCallListener = useCallback((fn: ((s: CallSignal) => void) | null) => {
    callSignalListenerRef.current = fn;
  }, []);

  const sendGhostpadSignal = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const registerGhostpadListener = useCallback((fn: ((s: GhostpadSignal) => void) | null) => {
    ghostpadListenerRef.current = fn;
  }, []);

  const [presence, setPresence] = useState<Record<string, boolean>>({});

  const subscribePresence = useCallback((alias: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "presence-subscribe", to: alias }));
    }
  }, []);

  const unsubscribePresence = useCallback((alias: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "presence-unsubscribe", to: alias }));
    }
    setPresence((prev) => {
      if (!(alias in prev)) return prev;
      const next = { ...prev };
      delete next[alias];
      return next;
    });
  }, []);

  const setGhostpadMode = useCallback((mode: GhostpadSession["mode"]) => {
    setState((prev) => ({ ...prev, ghostpad: { ...prev.ghostpad, mode } }));
  }, []);

  const resetGhostpad = useCallback(() => {
    setState((prev) => ({ ...prev, ghostpad: { mode: "idle", code: null } }));
  }, []);

  const dismissIncomingCall = useCallback(() => {
    setState((prev) => ({ ...prev, incomingCall: null }));
  }, []);

  // Arm the retry-timer to fire `drainOutbox` once the soonest deferred
  // item in the outbox becomes due. Idempotent — clears any prior
  // pending timer before installing the new one. Called after every
  // drain so the timer always reflects the current schedule. If nothing
  // is deferred (queue empty, or all items immediately ready) the prior
  // timer is just cancelled.
  const armOutboxRetryTimer = useCallback(() => {
    if (outboxRetryTimerRef.current) {
      clearTimeout(outboxRetryTimerRef.current);
      outboxRetryTimerRef.current = null;
    }
    const now = Date.now();
    const earliest = earliestDeferredAt(outboxRef.current, now);
    if (earliest === null) return;
    // Clamp the delay so we don't sit forever — at most a single
    // backoff cap (15 min). Math.max guards against any tiny negative
    // skew between this read and the one inside earliestDeferredAt.
    const delay = Math.max(0, earliest - now);
    outboxRetryTimerRef.current = setTimeout(() => {
      outboxRetryTimerRef.current = null;
      drainOutboxRef.current?.().catch((e) =>
        console.error("[Outbox] retry-timer drain failed:", e),
      );
    }, delay);
  }, []);

  const markMessageFailed = useCallback((conversationId: string, messageId: string) => {
    setState((prev) => {
      const updated = prev.conversations.map((c) => {
        if (c.id !== conversationId) return c;
        const msgs = c.messages.map((m) =>
          m.id === messageId ? { ...m, pending: false, failed: true } : m
        );
        let next = { ...c, messages: msgs };
        // ── Invite/key-expired destruct path ──────────────────────────────
        // Delegated to evaluateExpiredHandshake so the outbox-failure path
        // and the background sweep stay in lockstep. See its docstring for
        // the (deliberately narrow) detection conditions.
        const expiry = evaluateExpiredHandshake(next);
        if (expiry) {
          next = {
            ...next,
            destroyedAt: expiry.destroyedAt,
            lastMessage: expiry.lastMessage,
            timestamp: expiry.timestamp,
            messages: [...next.messages, expiry.systemMsg],
          };
        }
        return next;
      });
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
    console.warn("[Outbox] Marked failed (sealed conversation):", messageId);
  }, [persistConversations]);

  const drainOutbox = useCallback(async () => {
    if (outboxDrainingRef.current) return;
    if (outboxRef.current.length === 0) return;
    outboxDrainingRef.current = true;
    try {
      // Per-conversation ratchet cursor for the duration of this drain.
      // Critical: React setState is async, so reading conv.drSession.alice
      // from latestStateRef on each iteration would return the same stale
      // alice for back-to-back messages, producing duplicate header.n values
      // and an unrecoverable receiver desync. We instead thread the freshly
      // advanced alice through the loop locally and let setState merge each
      // commit sequentially via the prev callback.
      const aliceCursor = new Map<string, ReturnType<typeof ratchetEncrypt>["state"]>();
      const headerSent = new Set<string>();

      // Iterate oldest-composed first so the wire order matches the
      // user's compose order — the ratchet receiver tolerates nothing
      // else. We bump `attempts` only for items the loop actually
      // reaches; items deferred by backoff or sitting behind a still-
      // failing first item keep their existing counter.
      const now = Date.now();
      const snapshot = sortByCompose(outboxRef.current);
      for (const item of snapshot) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== 1) break;
        // Backoff gate: if this item was rescheduled to a future time
        // and we haven't reached it yet, stop draining. Because the
        // snapshot is in compose order, anything behind a deferred
        // item must also wait — the ratchet won't accept reordering.
        if (typeof item.nextAttemptAt === "number" && item.nextAttemptAt > now) break;
        const conv = latestStateRef.current.conversations.find((c) => c.id === item.conversationId);
        if (!conv?.drSession) {
          // No session to encrypt with — drop this item silently
          outboxRef.current = outboxRef.current.filter((i) => i.id !== item.id);
          persistOutbox(outboxRef.current);
          continue;
        }
        // The handshake-expiry sweep (task #102) may have sealed the
        // conversation while this item sat in the outbox waiting for a
        // satellite window. There's no surviving session to retry on,
        // so flip the message to failed and drop it. This is the only
        // outbox→failed transition now that the hard attempt cap is
        // gone (task #112).
        if (conv.destroyedAt) {
          outboxRef.current = outboxRef.current.filter((i) => i.id !== item.id);
          persistOutbox(outboxRef.current);
          markMessageFailed(item.conversationId, item.id);
          continue;
        }
        // Resolve the recipient's opaque delivery token (task #128) if we don't
        // have it yet. The replying side of an inbound session creates its
        // conversation from a received message and so never captured the token
        // from a prekey bundle. We resolve it here (drain is async), persist it
        // onto the conversation for future immediate sends, and address the wire
        // to it. If the server is unreachable, defer the whole drain — like any
        // other send failure, ordering forbids skipping ahead.
        let toDeliveryId = conv.recipientDeliveryId;
        if (!toDeliveryId) {
          toDeliveryId = (await resolveDeliveryId(conv.alias)) ?? undefined;
          if (!toDeliveryId) {
            console.warn("[Outbox] No delivery token yet for conversation — deferring drain");
            break;
          }
          const resolvedDeliveryId = toDeliveryId;
          setState((prev) => {
            const updated = prev.conversations.map((c) =>
              c.id === item.conversationId
                ? { ...c, recipientDeliveryId: resolvedDeliveryId }
                : c
            );
            persistConversations(updated);
            return { ...prev, conversations: updated };
          });
        }
        const nextAttempts = (item.attempts ?? 0) + 1;
        // Persist the attempt counter before we try to send. If send
        // throws and we break, the next drain sees the bumped count
        // and computes a larger backoff.
        outboxRef.current = outboxRef.current.map((i) =>
          i.id === item.id ? { ...i, attempts: nextAttempts } : i
        );
        persistOutbox(outboxRef.current);
        try {
          // Use the local cursor if we've already encrypted at least one
          // message for this conversation in this drain; otherwise fall
          // back to the committed session.
          const aliceForEncrypt = aliceCursor.get(item.conversationId) ?? conv.drSession.alice;
          const myAlias = (latestStateRef.current.alias ?? "GHOST_USER").toUpperCase();
          const outgoingTtlMs = clampDisappearSec(conv.disappearAfterSec) * 1000;
          const wireText = item.reaction
            ? wrapPayload(myAlias, item.id, "", undefined, undefined, item.reaction)
            : wrapPayload(myAlias, item.id, item.text, item.attachment, outgoingTtlMs);
          const { state: newAlice, message: aliceMsg } = ratchetEncrypt(aliceForEncrypt, wireText);
          // pendingX3DHHeader bootstraps the receiver's Bob session and is
          // only required on the very first ciphertext per conversation.
          // After that, header.dh + the ratchet step do the work and a
          // re-sent X3DH header on subsequent messages would force the
          // receiver to discard the live session.
          const x3dhHeader = headerSent.has(item.conversationId) ? undefined : conv.pendingX3DHHeader;
          // In LBW mode we compress the JSON envelope before send. The
          // server unwraps `msg-z` back into `msg` server-side. See
          // lib/lowBandwidth.ts for the wire format and the "only ship
          // compressed if it's actually smaller" guard.
          const frame = {
            type: "msg",
            to: toDeliveryId,
            payload: JSON.stringify(aliceMsg),
            x3dhHeader,
          };
          ws.send(
            lbwActiveRef.current
              ? compressFrameIfBeneficial(frame)
              : JSON.stringify(frame),
          );
          aliceCursor.set(item.conversationId, newAlice);
          headerSent.add(item.conversationId);
          const expiresAt = outgoingTtlMs ? Date.now() + outgoingTtlMs : undefined;
          setState((prev) => {
            const updated = prev.conversations.map((c) => {
              if (c.id !== item.conversationId) return c;
              if (!c.drSession) return c;
              const updatedSession = { ...c.drSession, alice: newAlice, lastAliceHeader: aliceMsg.header };
              // A reaction's local optimistic apply already happened at
              // sendReaction() call time — item.id here is the reaction's
              // own throwaway id, not a pending Message id, so there's
              // nothing to "finish" in the messages array. Only the DR
              // session commit matters for a reaction drain.
              const updatedMsgs = item.reaction
                ? c.messages
                : c.messages.map((m) =>
                    m.id === item.id
                      ? { ...m, pending: false, encrypted: true, sealed: true, ciphertext: aliceMsg.ciphertext, fingerprint: `DR:${aliceMsg.ciphertext.slice(0, 8).toUpperCase()}`, ttlMs: outgoingTtlMs, expiresAt }
                      : m
                  );
              return { ...c, messages: updatedMsgs, drSession: updatedSession, pendingX3DHHeader: undefined };
            });
            persistConversations(updated);
            return { ...prev, conversations: updated };
          });
          outboxRef.current = outboxRef.current.filter((i) => i.id !== item.id);
          persistOutbox(outboxRef.current);
        } catch (e) {
          console.error("[Outbox] Failed to drain item:", item.id, e);
          // Feed the low-bandwidth classifier so repeated drain failures
          // can downgrade us into LBW mode.
          linkStatsRef.current.recentSendFailures += 1;
          recomputeLinkQuality();
          // Apply exponential-with-jitter backoff to this item so we
          // don't hammer the link the instant it comes back. No hard
          // attempt cap (task #112) — satellite gaps can run for hours
          // and we want the message to land whenever the link returns.
          // The handshake-expiry sweep is the only mechanism that will
          // ever drop a still-unsent message (sealed-conversation drop
          // above), matching the spec's exit conditions.
          const delay = backoffDelayMs(nextAttempts);
          const nextAt = Date.now() + delay;
          outboxRef.current = outboxRef.current.map((i) =>
            i.id === item.id ? { ...i, nextAttemptAt: nextAt } : i,
          );
          persistOutbox(outboxRef.current);
          break; // Stop on error — ratchet ordering requires sequential delivery
        }
      }
    } finally {
      outboxDrainingRef.current = false;
      // Always reflect the current schedule in the retry timer, even
      // on the happy path — if the queue is now empty, this cancels
      // any stale timer; otherwise it arms for the soonest due item.
      armOutboxRetryTimer();
    }
  }, [persistConversations, persistOutbox, markMessageFailed, armOutboxRetryTimer]);

  // Wire the scheduler's ref to the live drainOutbox each render so the
  // debounced fire() always invokes the freshest closure.
  useEffect(() => {
    drainOutboxRef.current = drainOutbox;
  }, [drainOutbox]);

  // Foreground-triggered drain. When the app returns from background
  // (e.g. the user has been off the satellite link for a while and just
  // unlocked the phone) we kick a drain immediately so any messages
  // sitting in their backoff window get a fresh shot before their
  // scheduled retry. Backoff guards inside drainOutbox still gate
  // anything not yet due — this just removes the dead time between
  // "link returned" and "next setTimeout fired".
  useEffect(() => {
    const sub = RNAppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      drainOutboxRef.current?.().catch((e) =>
        console.error("[Outbox] foreground drain failed:", e),
      );
    });
    return () => sub.remove();
  }, []);

  // Cleanup: clear both outbox timers on unmount so we don't leak stray
  // setTimeouts into the next session (e.g. after a panic wipe re-mounts
  // the provider tree). The retry-timer fires drainOutbox once a
  // deferred item becomes due; the drain-debounce timer batches LBW
  // sends. Both hold closures over the (about-to-be-stale) drainOutbox.
  useEffect(() => {
    return () => {
      if (outboxRetryTimerRef.current) {
        clearTimeout(outboxRetryTimerRef.current);
        outboxRetryTimerRef.current = null;
      }
      if (outboxDrainTimerRef.current) {
        clearTimeout(outboxDrainTimerRef.current);
        outboxDrainTimerRef.current = null;
      }
    };
  }, []);

  const retryMessage = useCallback((conversationId: string, messageId: string) => {
    const conv = latestStateRef.current.conversations.find((c) => c.id === conversationId);
    const msg = conv?.messages.find((m) => m.id === messageId);
    if (!conv || !msg || !msg.failed) return;
    // Re-queue the failed message: clear failed flag, re-add to outbox with
    // attempts reset to 0, and try to drain immediately. Ratchet is not
    // advanced here — drainOutbox encrypts at the moment of WS delivery.
    setState((prev) => {
      const updated = prev.conversations.map((c) => {
        if (c.id !== conversationId) return c;
        const msgs = c.messages.map((m) =>
          m.id === messageId ? { ...m, failed: false, pending: true } : m
        );
        return { ...c, messages: msgs };
      });
      persistConversations(updated);
      return { ...prev, conversations: updated };
    });
    if (!outboxRef.current.find((i) => i.id === messageId)) {
      // Preserve the original compose timestamp from the surfaced
      // message so retried items stay in their compose-order slot in
      // the queue, never jumping ahead of items composed earlier.
      const next: OutboxItem[] = sortByCompose([
        ...outboxRef.current,
        {
          id: messageId,
          conversationId,
          text: msg.text,
          attempts: 0,
          attachment: msg.attachment,
          createdAt: msg.timestamp ?? Date.now(),
        },
      ]);
      outboxRef.current = next;
      persistOutbox(next);
    } else {
      // Already in the outbox (e.g. backoff-deferred). Clear the
      // deferral so the user-initiated retry fires immediately.
      outboxRef.current = outboxRef.current.map((i) =>
        i.id === messageId ? { ...i, nextAttemptAt: undefined, attempts: 0 } : i,
      );
      persistOutbox(outboxRef.current);
    }
    drainOutbox().catch(console.error);
  }, [persistConversations, persistOutbox, drainOutbox]);

  const handleIncomingWsMessage = useCallback(async (raw: string) => {
    let wsMsg: { type?: string; msgId?: number; from?: string; payload?: string; x3dhHeader?: string; alias?: string; callId?: string; callMode?: string; code?: string; text?: string; online?: boolean; seconds?: number | null };
    try {
      wsMsg = JSON.parse(raw);
    } catch {
      return;
    }

    // ── Auth ack ─────────────────────────────────────────────────────────────
    if (wsMsg.type === "ack" && !wsMsg.from) {
      wsEverConnectedRef.current = true;
      setWsConnected(true);
      // Link is healthy enough to authenticate — reset the "stuck" timer
      // and let the classifier promote us back to "good".
      linkStatsRef.current.lastAuthAckAt = Date.now();
      linkStatsRef.current.reconnectingSince = 0;
      recomputeLinkQuality();
      drainOutbox().catch(console.error);
      flushPendingCallSignals();
      return;
    }

    // ── Self-destruct notice from a peer ───────────────────────────────────
    // Mark the matching conversation as destroyed so the UI can show a
    // "SELF-DESTRUCTED" badge, disable the composer, and render a system
    // message in chat. Notice is one-shot — ignore if already flagged.
    if (wsMsg.type === "departed" && wsMsg.from) {
      const departedAlias = wsMsg.from.toUpperCase();
      setState((prev) => {
        const existing = prev.conversations.find((c) => c.alias === departedAlias);
        if (!existing || existing.destroyedAt) return prev;
        const stamp = Date.now();
        const systemMsg: Message = {
          id: `sys-departed-${stamp}`,
          text: "This contact has self-destructed. The conversation is sealed.",
          fromMe: false,
          timestamp: stamp,
          encrypted: false,
          sealed: true,
          system: true,
        };
        const updated = prev.conversations.map((c) =>
          c.id === existing.id
            ? {
                ...c,
                destroyedAt: stamp,
                lastMessage: "SELF-DESTRUCTED",
                timestamp: stamp,
                messages: [...c.messages, systemMsg],
              }
            : c
        );
        persistConversations(updated);
        return { ...prev, conversations: updated };
      });
      return;
    }

    // ── Peer changed the disappearing-message timer for this conversation ───
    // Applies going forward only — updates the setting used for new sends
    // and newly-received messages, never rewrites expiresAt on messages
    // already in the conversation.
    if (wsMsg.type === "disappear-timer" && wsMsg.from) {
      const peerAlias = wsMsg.from.toUpperCase();
      // Older builds could sync "OFF" (undefined) — always-on policy maps
      // that, and anything out of range, back into [5s, 7d] / default 1h.
      const seconds = clampDisappearSec(wsMsg.seconds);
      setState((prev) => {
        const existing = prev.conversations.find((c) => c.alias === peerAlias);
        if (!existing) return prev;
        const updated = prev.conversations.map((c) =>
          c.id === existing.id ? { ...c, disappearAfterSec: seconds } : c
        );
        persistConversations(updated);
        return { ...prev, conversations: updated };
      });
      return;
    }

    // ── Presence — another alias's online status changed ────────────────────
    if (wsMsg.type === "presence" && wsMsg.from) {
      const presenceAlias = wsMsg.from.toUpperCase();
      setPresence((prev) => ({ ...prev, [presenceAlias]: !!wsMsg.online }));
      return;
    }

    // ── Ghostpad signals — relayed, never persisted client-side either ───────
    // Session identity (mode + code) is committed straight into AppState
    // here, independent of whether a GhostpadScreen is currently mounted to
    // receive it — a lock/unmount mid-session must not strand the user on a
    // blank idle screen once they're back. The live pad text stays screen-
    // local and ephemeral via ghostpadListenerRef, matching the "nothing
    // lingers" design for actual pad content.
    if (wsMsg.type && GHOSTPAD_SIGNAL_TYPES.has(wsMsg.type)) {
      const signal: GhostpadSignal = {
        type: wsMsg.type as GhostpadSignal["type"],
        code: wsMsg.code,
        text: wsMsg.text,
      };
      switch (signal.type) {
        case "ghostpad-created":
          setState((prev) => ({ ...prev, ghostpad: { mode: "creating", code: signal.code ?? null } }));
          break;
        case "ghostpad-paired":
          setState((prev) => ({ ...prev, ghostpad: { ...prev.ghostpad, mode: "paired" } }));
          break;
        case "ghostpad-ended":
        case "ghostpad-error":
          setState((prev) => ({ ...prev, ghostpad: { mode: "idle", code: null } }));
          break;
      }
      ghostpadListenerRef.current?.(signal);
      return;
    }

    // ── Call signals ─────────────────────────────────────────────────────────
    if (wsMsg.type && CALL_SIGNAL_TYPES.has(wsMsg.type) && wsMsg.from) {
      if (wsMsg.type === "call-ring") {
        setState((prev) => ({
          ...prev,
          incomingCall: { callId: wsMsg.callId ?? "unknown", from: wsMsg.from!.toUpperCase(), mode: (wsMsg.callMode as "voice" | "video") ?? "voice" },
        }));
      } else if (wsMsg.type === "call-hangup" && !callSignalListenerRef.current) {
        // The caller cancelled/gave up before we (the callee) answered —
        // call.tsx never mounted, so there's no listener to forward to.
        // callSignalListenerRef being null is exactly how we tell this apart
        // from a remote-hangup on an in-progress call, which call.tsx handles
        // itself once mounted (registerCallListener(null) on its unmount is
        // what clears this ref). Clear the incoming-call banner if it's still
        // showing this call, and tell CallKit — it may have a CXCall pending
        // from a VoIP push for the same callId.
        markCallEnded(wsMsg.callId);
        const pendingIncoming =
          latestStateRef.current.incomingCall?.callId === wsMsg.callId
            ? latestStateRef.current.incomingCall
            : null;
        if (pendingIncoming) {
          setState((prev) => ({ ...prev, incomingCall: null }));
        }
        if (wsMsg.callId) notifyCallEnded(wsMsg.callId, "unanswered");
        // Only log "missed" when this device was actually being rung (a
        // pending incoming banner existed for this callId). A hangup with
        // no matching incoming call is dead-call cleanup — e.g. a callee's
        // zombie-join timing out and hanging up at a caller who already
        // ended the call — and logging that as a missed incoming call is
        // exactly the phantom "missed call" bug.
        if (pendingIncoming) {
          logCall({
            alias: pendingIncoming.from.toUpperCase(),
            direction: "incoming",
            mode: pendingIncoming.mode ?? "voice",
            outcome: "missed",
            timestamp: Date.now(),
          });
        }
      } else {
        // Hangups are marked ended even when call.tsx is mounted to handle
        // them — a later CallKit answer tap for the same callId must find it.
        if (wsMsg.type === "call-hangup") markCallEnded(wsMsg.callId);
        callSignalListenerRef.current?.({ type: wsMsg.type, from: wsMsg.from.toUpperCase(), payload: wsMsg.payload, callId: wsMsg.callId, callMode: wsMsg.callMode });
      }
      return;
    }

    if (wsMsg.type !== "msg" || !wsMsg.payload) return;

    let ratchetMsg: RatchetMessage;
    try {
      ratchetMsg = JSON.parse(wsMsg.payload) as RatchetMessage;
    } catch {
      console.warn("[WS] Failed to parse ratchet message payload");
      return;
    }

    const myAlias = (latestStateRef.current.alias ?? "").toUpperCase();
    const currentConversations = latestStateRef.current.conversations;

    // ── Established session: trial-decrypt (task #128 sealed sender) ──────────
    // The wire no longer carries the sender's alias, and an established session
    // has no X3DH header to identify it by either. So we trial-decrypt against
    // every conversation that holds a live Double Ratchet session. ratchetDecrypt
    // is pure and AEAD-authenticated: a wrong session fails the auth tag and
    // throws with NO state mutation, making trial-decrypt completely side-effect
    // free. The first session that decrypts is, by construction, the sender.
    for (const conv of currentConversations) {
      if (!conv.drSession) continue;
      let decrypted: ReturnType<typeof ratchetDecrypt> | undefined;
      try {
        decrypted = ratchetDecrypt(conv.drSession.alice, ratchetMsg);
      } catch {
        continue; // wrong session — keep trying
      }
      const { state: newAlice, plaintext } = decrypted;
      const unwrapped = unwrapPayload(plaintext);
      const updatedSession = { ...conv.drSession!, alice: newAlice };

      // ── Reaction: toggled onto a target message, never rendered as its
      // own Message. The ratchet advance still commits below regardless of
      // whether the target exists — a successful decrypt always consumes
      // ratchet state; dropping only means not touching the messages array.
      if (unwrapped.reaction) {
        const { m: targetId, e: emoji, o: add } = unwrapped.reaction;
        setState((prev) => {
          const updated = prev.conversations.map((c) => {
            if (c.id !== conv.id) return c;
            const targetExists = c.messages.some((m) => m.id === targetId);
            const messages = targetExists
              ? c.messages.map((m) =>
                  m.id === targetId
                    // Never touches viewedAt/expiresAt — reacting to an
                    // unviewed disappearing message must not start its timer.
                    ? { ...m, reactions: applyReaction(m.reactions, emoji, c.alias, add) }
                    : m
                )
              : c.messages; // unknown/purged target — drop silently, no placeholder
            return { ...c, messages, drSession: updatedSession };
          });
          persistConversations(updated);
          return { ...prev, conversations: updated };
        });
        return;
      }

      // ── ID-collision guard: received ids are peer-controlled (sender-
      // generated, v4). A collision with an existing message id — stale
      // replay, retried outbox duplicate, or malicious — must never clobber
      // it. Drop the incoming message entirely; the ratchet still commits,
      // since decryption genuinely succeeded.
      if (unwrapped.id && conv.messages.some((m) => m.id === unwrapped.id)) {
        setState((prev) => {
          const updated = prev.conversations.map((c) =>
            c.id === conv.id ? { ...c, drSession: updatedSession } : c
          );
          persistConversations(updated);
          return { ...prev, conversations: updated };
        });
        return;
      }

      const preview = previewForMessage(unwrapped.text, unwrapped.attachment);
      const newMsgObj: Message = {
        id: unwrapped.id ?? `${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
        text: unwrapped.text,
        fromMe: false,
        timestamp: Date.now(),
        encrypted: true,
        sealed: true,
        fingerprint: `DR:${ratchetMsg.ciphertext.slice(0, 8).toUpperCase()}`,
        ...(unwrapped.attachment ? { attachment: unwrapped.attachment } : {}),
        // TTL comes from the sender via the envelope, never from our own
        // local conversation setting. No expiresAt yet — the countdown only
        // starts once this message is actually viewed (markMessagesViewed).
        ...(unwrapped.ttlMs ? { ttlMs: unwrapped.ttlMs } : {}),
      };
      setState((prev) => {
        const updated = prev.conversations.map((c) =>
          c.id === conv.id
            ? {
                ...c,
                messages: [...c.messages, newMsgObj],
                lastMessage: preview,
                timestamp: Date.now(),
                unread: c.unread + 1,
                drSession: updatedSession,
              }
            : c
        );
        persistConversations(updated);
        return { ...prev, conversations: updated };
      });
      return;
    }

    // No live session decrypted it. Without an X3DH header we cannot bootstrap a
    // new one — and under sealed-sender we don't know who sent it, so there is
    // nothing to pin a failure bubble to. Drop silently.
    if (!wsMsg.x3dhHeader) {
      console.warn("[WS] No established session could decrypt headerless message — dropping");
      return;
    }

    // ── New or glare session: bootstrap Bob from the X3DH header ─────────────
    let x3dhHeader: X3DHHeader;
    try {
      x3dhHeader = JSON.parse(wsMsg.x3dhHeader) as X3DHHeader;
    } catch {
      console.warn("[WS] Failed to parse X3DH header on incoming message");
      return;
    }

    let senderAlias = "";

    try {
      const [myIKPriv, myIKPub, mySpkPriv, mySpkPub, myPqkemPriv] = await Promise.all([
        secureGet(MY_IK_PRIV_KEY),
        secureGet(MY_IK_PUB_KEY),
        secureGet(MY_SPK_PRIV_KEY),
        secureGet(MY_SPK_PUB_KEY),
        secureGet(MY_PQKEM_PRIV_KEY),
      ]);

      if (!myIKPriv || !myIKPub || !mySpkPriv || !mySpkPub) {
        console.warn("[X3DH] Own private keys not available — cannot init Bob session for", senderAlias);
        return;
      }

      let opkPriv: string | undefined;
      if (x3dhHeader.opkId) {
        const opkStore = await loadOPKStore();
        opkPriv = opkStore[x3dhHeader.opkId];
        if (opkPriv) {
          delete opkStore[x3dhHeader.opkId];
          await saveOPKStore(opkStore);
        }
      }

      // Pass our stored ML-KEM private key so Bob can decapsulate Alice's PQXDH
      // ciphertext (if present). Absent → classical-only session.
      const bobSession = initSessionBobFromHeader(
        x3dhHeader,
        myIKPriv,
        myIKPub,
        mySpkPriv,
        mySpkPub,
        opkPriv,
        myPqkemPriv ?? undefined,
      );

      const { state: newAlice, plaintext } = ratchetDecrypt(bobSession.alice, ratchetMsg);
      const unwrappedFirst = unwrapPayload(plaintext);

      // Sender identity is recovered from INSIDE the authenticated payload — the
      // only place it travels under sealed-sender. Fall back to a wire field only
      // if an older peer still sends one; otherwise the message is unattributable.
      senderAlias = (unwrappedFirst.from ?? wsMsg.from ?? "").toUpperCase();
      if (!senderAlias) {
        console.warn("[X3DH] Decrypted first message has no recoverable sender — dropping");
        return;
      }

      // Sender authentication: bind the claimed alias to its registered identity
      // key. Under sealed sender the alias is self-asserted from inside the
      // payload, so without this any authenticated peer could embed someone
      // else's alias (e.g. send with their own ikA but claim "ALICE") and be
      // shown as that contact. We require the X3DH header's ikA to match the
      // identity key the server holds for the claimed alias. Fail-closed: an
      // unknown alias or unreachable lookup drops the message rather than
      // trusting an unverifiable identity.
      const registeredIk = await resolveIdentityKey(senderAlias);
      if (!registeredIk || registeredIk.toLowerCase() !== x3dhHeader.ikA.toLowerCase()) {
        console.warn(
          "[X3DH] Sender identity key does not match claimed alias — dropping suspected spoof:",
          senderAlias,
        );
        return;
      }

      // Glare: we already hold a live session with this sender (both sides re-ran
      // X3DH at once). Apply the same deterministic tiebreaker on both ends — the
      // lexicographically smaller alias's session wins — so we converge without
      // another round-trip. This necessarily runs AFTER decrypt because the
      // sender's alias now lives inside the ciphertext, not on the wire.
      const priorConv = latestStateRef.current.conversations.find(
        (c) => c.alias === senderAlias,
      );
      if (priorConv?.drSession) {
        const senderWins = senderAlias < myAlias;
        if (!senderWins) {
          console.warn("[DR] Glare with", senderAlias, "— our alias wins; keeping local session, dropping incoming");
          return;
        }
        console.warn("[DR] Glare with", senderAlias, "— sender wins; adopting rebuilt Bob session");
      }

      const safetyNumber = generateSafetyNumber(latestStateRef.current.alias ?? "GHOST_USER", senderAlias);

      // ── Reaction arriving via first-message bootstrap (session re-init,
      // glare, or literally someone's first-ever contact). A reaction always
      // needs an existing conversation with a prior message to attach to —
      // if none exists here, there's nothing to react to and nothing worth
      // creating a fresh session/conversation for. Drop entirely, "unknown/
      // purged target: drop silently" extended to the conversation level.
      if (unwrappedFirst.reaction) {
        const existingConv = latestStateRef.current.conversations.find((c) => c.alias === senderAlias);
        if (!existingConv) return;
        const { m: targetId, e: emoji, o: add } = unwrappedFirst.reaction;
        setState((prev) => {
          const updated = prev.conversations.map((c) => {
            if (c.id !== existingConv.id) return c;
            const targetExists = c.messages.some((m) => m.id === targetId);
            const messages = targetExists
              ? c.messages.map((m) =>
                  m.id === targetId
                    // Never touches viewedAt/expiresAt.
                    ? { ...m, reactions: applyReaction(m.reactions, emoji, senderAlias, add) }
                    : m
                )
              : c.messages; // unknown/purged target — drop silently, no placeholder
            return { ...c, messages, drSession: { ...bobSession, alice: newAlice }, safetyNumber };
          });
          persistConversations(updated);
          return { ...prev, conversations: updated };
        });
        return;
      }

      const firstPreview = previewForMessage(unwrappedFirst.text, unwrappedFirst.attachment);

      const initMsg: Message = {
        id: `${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
        text: "Double Ratchet E2EE channel established. Receiving first message.",
        fromMe: false,
        timestamp: Date.now() - 1,
        encrypted: true,
        sealed: false,
      };

      setState((prev) => {
        const alreadyExists = prev.conversations.find((c) => c.alias === senderAlias);
        const updatedSession = { ...bobSession, alice: newAlice };

        // ID-collision guard: received ids are peer-controlled. A collision
        // with an existing message id in this (re-initialized) conversation
        // must never clobber it — commit the new session but drop the
        // incoming message rather than overwrite.
        if (alreadyExists && unwrappedFirst.id && alreadyExists.messages.some((m) => m.id === unwrappedFirst.id)) {
          const updated = prev.conversations.map((c) =>
            c.id === alreadyExists.id ? { ...c, drSession: updatedSession, safetyNumber } : c
          );
          persistConversations(updated);
          return { ...prev, conversations: updated };
        }

        const firstMsg: Message = {
          id: unwrappedFirst.id ?? `${Date.now() + 1}${Math.random().toString(36).substr(2, 9)}`,
          text: unwrappedFirst.text,
          fromMe: false,
          timestamp: Date.now(),
          encrypted: true,
          sealed: true,
          fingerprint: `DR:${ratchetMsg.ciphertext.slice(0, 8).toUpperCase()}`,
          ...(unwrappedFirst.attachment ? { attachment: unwrappedFirst.attachment } : {}),
          // TTL from the envelope, not our own local conversation setting — no
          // expiresAt until this message is actually viewed.
          ...(unwrappedFirst.ttlMs ? { ttlMs: unwrappedFirst.ttlMs } : {}),
        };

        if (alreadyExists) {
          // Sender re-initialized their session and we fell through from the
          // decrypt-fail path. Replace the stale DR session and append the
          // decrypted message to the existing conversation rather than creating
          // a duplicate.
          const updated = prev.conversations.map((c) =>
            c.id === alreadyExists.id
              ? {
                  ...c,
                  drSession: updatedSession,
                  messages: [...c.messages, firstMsg],
                  lastMessage: firstPreview,
                  timestamp: Date.now(),
                  unread: c.unread + 1,
                  safetyNumber,
                }
              : c
          );
          persistConversations(updated);
          return { ...prev, conversations: updated };
        }

        const id = `${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
        const newConv: Conversation = {
          id,
          alias: senderAlias,
          lastMessage: firstPreview,
          timestamp: Date.now(),
          unread: 1,
          safetyNumber,
          isRealContact: true,
          disappearAfterSec: DEFAULT_DISAPPEAR_SEC,
          drSession: updatedSession,
          messages: [initMsg, firstMsg],
        };
        const updated = [newConv, ...prev.conversations];
        persistConversations(updated);
        return { ...prev, conversations: updated };
      });

    } catch (e) {
      console.error("[X3DH] Failed to init Bob session or decrypt first message", e);
      // Under sealed-sender we may fail before recovering the sender; with no
      // alias there is nothing to attribute a failure bubble to, so drop.
      // NOTE: PqDowngradeError is thrown by initSessionBobFromHeader BEFORE
      // ratchetDecrypt runs, i.e. before senderAlias is ever recoverable, and
      // current clients never put `from` on a "msg" send (sealed-sender) — so
      // for any real current-version peer this still hits the early return
      // below. The distinct text is kept for the legacy-wire-`from` fallback
      // and as defense-in-depth; it is not the primary visible signal for
      // this rejection (that's Alice's side — see addConversation's catch).
      if (!senderAlias) return;
      const isPqDowngrade = e instanceof PqDowngradeError;
      const placeholderText = isPqDowngrade
        ? "⚠ Rejected: contact's keys don't support required post-quantum encryption"
        : "⚠ Message could not be decrypted";
      setState((prev) => {
        const placeholder: Message = {
          id: `${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
          text: placeholderText,
          fromMe: false,
          timestamp: Date.now(),
          encrypted: true,
          sealed: false,
        };
        const existingConv = prev.conversations.find((c) => c.alias === senderAlias);
        if (existingConv) {
          const updated = prev.conversations.map((c) =>
            c.alias === senderAlias
              ? { ...c, messages: [...c.messages, placeholder], lastMessage: placeholderText, timestamp: Date.now(), unread: c.unread + 1 }
              : c
          );
          persistConversations(updated);
          return { ...prev, conversations: updated };
        }
        // Unknown sender — create a minimal conversation so the failure is visible
        const newConv: Conversation = {
          id: `${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
          alias: senderAlias,
          lastMessage: placeholderText,
          timestamp: Date.now(),
          unread: 1,
          isRealContact: true,
          disappearAfterSec: DEFAULT_DISAPPEAR_SEC,
          messages: [placeholder],
        };
        const updated = [newConv, ...prev.conversations];
        persistConversations(updated);
        return { ...prev, conversations: updated };
      });
    }
  }, [persistConversations, drainOutbox, flushPendingCallSignals]);

  useEffect(() => {
    const alias = state.alias;
    const isLocked = state.isLocked;
    const isOnboarded = state.isOnboarded;

    if (!alias || isLocked || !isOnboarded) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let mounted = true;

    async function connect() {
      // Backgrounded: stay disconnected. The AppState effect below flips
      // this back and calls reconnectNowRef.current() immediately on
      // foreground, so no retry loop is needed here.
      if (backgroundedRef.current) return;
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!domain) return;

      const deviceToken = await secureGet(DEVICE_TOKEN_KEY);
      if (!deviceToken || !mounted) return;

      try {
        const wsUrl = `wss://${domain}/api/ws`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        // Client-side ping. The server runs its own protocol-level ping
        // every 30 s, but on satellite links we want the *client* to also
        // keep the connection nailed up — and to stretch its cadence when
        // low-bandwidth mode is active. We use a self-rescheduling
        // setTimeout so the interval can adapt to runtime LBW toggles
        // without tearing down and recreating the WS.
        let pingTimer: ReturnType<typeof setTimeout> | null = null;
        const schedulePing = () => {
          pingTimer = setTimeout(() => {
            if (ws.readyState === 1) {
              try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ }
              schedulePing();
            }
          }, wsPingIntervalMs(lbwActiveRef.current));
        };

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "auth", alias, token: deviceToken }));
          schedulePing();
        };

        // Auth-error flag: set by onmessage when server sends { type:"error", message:"auth failed" }.
        // Checked by onclose so we re-register instead of looping blindly.
        // Also catches code 4001 for environments where the proxy passes it through.
        let authRejected = false;

        ws.onmessage = (event) => {
          const raw = event.data as string;
          try {
            const parsed = JSON.parse(raw) as { type?: string; message?: string };
            if (parsed.type === "error" && typeof parsed.message === "string" && parsed.message.toLowerCase().includes("auth")) {
              authRejected = true;
              console.warn("[WS] Auth error received from server — will re-register on close");
              return;
            }
          } catch { /* not JSON or not an error — pass through */ }
          handleIncomingWsMessage(raw).catch(console.error);
        };

        ws.onerror = (e) => {
          console.warn("[WS] Error:", e);
        };

        ws.onclose = (event) => {
          setWsConnected(false);
          // The server unconditionally revokes any pending Ghostpad code and
          // ends any active pairing the instant its socket for this alias
          // closes (see api-server's wss.on("close") handler) — regardless
          // of why the socket closed (lock, network drop, backgrounding).
          // Mirror that here so we never show a code/session client-side
          // that the server has already discarded.
          setState((prev) =>
            prev.ghostpad.mode === "idle" ? prev : { ...prev, ghostpad: { mode: "idle", code: null } }
          );
          if (pingTimer) { clearTimeout(pingTimer); pingTimer = null; }
          // Feed the LBW classifier: count this disconnect, and start the
          // "stuck reconnecting" stopwatch if it isn't already running.
          linkStatsRef.current.recentReconnects += 1;
          if (linkStatsRef.current.reconnectingSince === 0) {
            linkStatsRef.current.reconnectingSince = Date.now();
          }
          recomputeLinkQuality();
          if (!mounted) return;

          if (event.code === 4001 || authRejected) {
            authRejected = false;
            // Auth rejected — stale or mismatched device token.
            // Clear local credentials, re-register with the server, then reconnect.
            console.warn("[WS] Auth rejected — clearing stale token and re-registering");
            (async () => {
              try {
                if (!alias) {
                  // Alias was cleared while we were connected (e.g. panic wipe).
                  // Can't re-register without one — just back off and let the
                  // normal WS useEffect guard handle reconnection once alias is set.
                  console.warn("[WS] Auth rejected but alias is null — skipping re-registration");
                  return;
                }
                // Capture alias as a local const so TypeScript can narrow the type
                // from string | null to string across the async boundary.
                const currentAlias: string = alias;
                // Don't delete the old device token / private keys up front.
                // Re-register FIRST, and only overwrite local storage once a
                // replacement actually exists. If registration fails (409
                // conflict, or the server/network is just down), the old
                // keys are still what let this device decrypt any messages
                // it already has locally — destroying them speculatively on
                // every transient auth hiccup made that loss permanent and
                // unrecoverable even when the failure was temporary.
                const reg = await registerWithServer(currentAlias);
                if (reg?.ok && mounted) {
                  await secureSet(DEVICE_TOKEN_KEY, reg.token);
                  await secureSet(MY_IK_PRIV_KEY, reg.ikPriv);
                  await secureSet(MY_IK_PUB_KEY, reg.ikPub);
                  await secureSet(MY_SPK_PRIV_KEY, reg.spkPriv);
                  await secureSet(MY_SPK_PUB_KEY, reg.spkPub);
                  await secureSet(MY_PQKEM_PRIV_KEY, reg.pqkemPriv);
                  await secureSet(MY_PQKEM_PUB_KEY, reg.pqkemPub);
                  await generateAndUploadOPKs(currentAlias, reg.token);
                  reconnectTimer = setTimeout(connect, 1000);
                } else if (mounted) {
                  if (reg && !reg.ok && reg.conflict) {
                    // Alias is registered server-side under a different
                    // device token than the one we just failed to auth
                    // with — this device can't recover push/session
                    // capability for it. Local keys are left untouched
                    // (still needed to read anything already received).
                    console.warn(
                      "[WS] Re-registration conflict — alias is bound to a different device token",
                      currentAlias,
                    );
                    Alert.alert(
                      "Device not linked to this alias",
                      "This alias is registered on another device or install. " +
                        "Push notifications, calls, and new messages won't work here until " +
                        "you create a new alias.",
                    );
                    // A 409 conflict is permanent, not transient — retrying
                    // on a timer would just resend the same rejected token
                    // and re-trigger this exact branch, alert included,
                    // every 15s forever. Stay disconnected instead; the
                    // normal connect effect picks back up if alias changes.
                  } else {
                    console.warn("[WS] Re-registration failed — retrying in 15 s");
                    reconnectTimer = setTimeout(connect, 15_000);
                  }
                }
              } catch {
                if (mounted) reconnectTimer = setTimeout(connect, 10_000);
              }
            })();
            return;
          }

          // Reconnect delay is stretched when LBW is active so a brief
          // satellite sliver isn't immediately re-burned by reconnect churn.
          reconnectTimer = setTimeout(connect, wsReconnectDelayMs(lbwActiveRef.current));
        };
      } catch (e) {
        console.warn("[WS] Failed to connect:", e);
        if (mounted) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      }
    }

    connect();
    reconnectNowRef.current = connect;

    return () => {
      mounted = false;
      setWsConnected(false);
      reconnectNowRef.current = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [state.alias, state.isLocked, state.isOnboarded, handleIncomingWsMessage]);

  // Shared by the AppState "active" transition below and by the CallKeep
  // "answerCall" path (wired through usePushNotifications -> RootNavigator,
  // since backgroundedRef/reconnectNowRef aren't otherwise reachable outside
  // this provider). Answering a call via CallKit can happen before RN's JS
  // side has observed the "active" transition, so that path needs to force
  // this synchronously instead of waiting on the AppState listener.
  const forceReconnect = useCallback(() => {
    backgroundedRef.current = false;
    // readyState 0 = CONNECTING, 1 = OPEN — skip reconnecting on either.
    // connect() has no guard of its own against a second overlapping socket:
    // calling it while one is already mid-handshake would spawn a fresh
    // WebSocket and orphan the first, whose onclose still fires later and
    // queues its own reconnect, competing with whichever socket actually
    // won. Without this, two triggers close together (e.g. two VoIP pushes
    // a beat apart) would each kick off their own connect().
    const readyState = wsRef.current?.readyState;
    if (readyState !== 0 && readyState !== 1) {
      reconnectNowRef.current?.();
    }
  }, []);

  // Close the WS explicitly the moment the app backgrounds. Without this,
  // backgrounding/closing the app never sends a clean close frame — the
  // server has to wait out its own ~30-60s heartbeat timeout to notice the
  // connection is dead, and any message that arrives in that window gets
  // silently marked "delivered" over a socket that can no longer actually
  // receive it, skipping the push-notification fallback entirely. Calling
  // .close() here fires the onclose handler above exactly as a network
  // drop would — but that handler's generic reconnect timer (5s) would
  // otherwise reopen a fresh authenticated socket seconds later while still
  // backgrounded, reopening the exact stale-socket window this is meant to
  // close. backgroundedRef gates that timer off entirely while backgrounded;
  // returning to "active" clears it and reconnects immediately here instead
  // of waiting on the generic delay.
  useEffect(() => {
    const sub = RNAppState.addEventListener("change", (next) => {
      if (next === "background") {
        backgroundedRef.current = true;
        if (wsRef.current) wsRef.current.close();
      } else if (next === "active") {
        forceReconnect();
      }
    });
    return () => sub.remove();
  }, [forceReconnect]);

  return (
    <AppContext.Provider
      value={{
        ...state,
        hasPin,
        hasDuressPin,
        hasDecoyPin,
        hasWalletPin,
        walletUnlocked,
        decoyMode,
        loadError,
        setAlias,
        recoverIdentity,
        getRecoveryPhrase,
        setPin,
        checkPin,
        checkDuressPin,
        checkDecoyPin,
        checkPinWithDuress,
        captureCurrentPinForTransition,
        checkPreviousMainPin,
        setDuressPin,
        clearDuressPin,
        setDecoyPin,
        clearDecoyPin,
        setWalletPin,
        checkWalletPin,
        clearWalletPin,
        enterDecoyMode,
        exitDecoyMode,
        setBiometricEnabled,
        setLocked,
        connectVPN,
        disconnectVPN,
        sendMessage,
        sendReaction,
        retryMessage,
        addConversation,
        deleteMessage,
        clearConversation,
        deleteConversation,
        markConversationRead,
        setDisappearTimer,
        setConversationBgColor,
        setConversationBgImage,
        markMessagesViewed,
        verifyConversation,
        sendCallSignal,
        registerCallListener,
        logCall,
        markCallsSeen,
        clearCallHistory,
        forceReconnect,
        sendGhostpadSignal,
        registerGhostpadListener,
        presence,
        subscribePresence,
        unsubscribePresence,
        setGhostpadMode,
        resetGhostpad,
        dismissIncomingCall,
        panicWipe,
        connectWallet,
        disconnectWallet,
        createLocalWallet,
        restoreLocalWallet,
        refreshAppTokenBalances,
        setAutoLockTimeout,
        setDuressGracePeriod,
        setLanguage,
        setThemePreference,
        setProfileImage,
        setLowBandwidthMode,
        setSmsFallbackNumbers,
        setSmsFallbackMessage,
        refreshEntitlement,
        wsConnected,
        loaded,
        vpnAutoReconnecting,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
