// Domain types shared by AppContext and its extracted helpers, moved
// verbatim from AppContext.tsx. AppContext re-exports all of them, so
// existing `import ... from "@/context/AppContext"` sites are unaffected.

import type { Attachment } from "@/lib/envelope";
export type { Attachment } from "@/lib/envelope";
import type { DRSession } from "@/lib/doubleRatchet";

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
  /** The contact's profile photo (data:image/jpeg;base64), received E2E via a
   *  profile-photo control message. Rendered as the avatar with a letter
   *  fallback. Small; lives inside the encrypted conversation blob. */
  contactPhoto?: string;
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
  /**
   * Audit #12 — trust-on-first-use pin of the contact's long-term X25519
   * identity key (X3DH `ikA`), lowercase hex. Recorded the first time we
   * establish a session with them and compared on every later handshake.
   *
   * The receive path's existing alias->key binding asks the SERVER what key
   * an alias has, then checks the wire header against that answer; both halves
   * come from the server, so a server that substitutes both is never caught.
   * This pin is the anchor that check lacks: it is a value the server has
   * never had access to. Lives inside the encrypted conversation blob and is
   * never serialized onto the wire.
   */
  pinnedIdentityKey?: string;
  /** When `pinnedIdentityKey` was first recorded. Display/forensics only. */
  pinnedAt?: number;
  /**
   * Audit #12 — set when a handshake presented an identity key that does not
   * match `pinnedIdentityKey`. Its presence LOCKS the conversation: sends are
   * refused and inbound sessions are not adopted, until the user explicitly
   * accepts the new key (`acceptIdentityKeyChange`) or deletes the chat.
   *
   * Neither `pinnedIdentityKey` nor `safetyNumber` may be overwritten while
   * this is set — the stored safety number is the evidence of what the user
   * previously verified, and repainting it is precisely the failure this
   * finding exists to close.
   */
  identityKeyChanged?: {
    /** The key that was offered and rejected, lowercase hex. */
    presentedKey: string;
    detectedAt: number;
  };
}

export interface Transaction {
  id: string;
  type: "send" | "receive";
  token: "FANTASMA" | "GFC";
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
