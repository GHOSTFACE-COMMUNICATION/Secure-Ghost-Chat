import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import {
  db,
  messagesTable,
  identityKeysTable,
  departuresTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { verifyDeviceToken } from "../lib/auth";
import { inflateRawSync } from "zlib";
import { logger } from "../lib/logger";
import { normalizeAlias } from "../utils/alias";
import {
  ensureDeliveryId,
  pushTokensForAlias,
  pushTokensForDeliveryId,
  clearExpoPushTokenForAlias,
  clearVoipPushTokenForAlias,
  clearExpoPushTokenForDeliveryId,
} from "../utils/delivery";
import { sendExpoPush, sendVoipPushIOS } from "../lib/pushNotifications";
import { deleteAckedMessages, markDeparturesDelivered } from "../utils/markDelivered";
import * as shared from "./sharedState";
import * as router from "./router";

// ── msg-z (compressed frame) safety limits ──────────────────────────────
// Compressed frames are an untrusted, attacker-controllable input even
// after auth. We bound both the compressed size (avoid huge base64 blobs
// before we even try to inflate) and the decompressed size (zip-bomb
// defense — node's zlib honors maxOutputLength and throws before
// allocating past it). The numbers are generously above any legitimate
// `msg` envelope (high-entropy ciphertext + X3DH header tops out a few
// KB) while small enough to keep WS workers bounded.
const MSG_Z_MAX_COMPRESSED_BYTES = 32 * 1024; // ~32 KB base64 input
const MSG_Z_MAX_INFLATED_BYTES = 128 * 1024; // ~128 KB after inflate

export interface WireMessage {
  type:
    | "auth"
    | "msg"
    | "ack"
    | "msgAck"
    | "ping"
    | "pong"
    | "pending"
    | "call-ring"
    | "call-accept"
    | "call-hangup"
    | "call-offer"
    | "call-answer"
    | "call-ice"
    | "sms_inbound"
    | "departed"
    | "ghostpad-create"
    | "ghostpad-created"
    | "ghostpad-join"
    | "ghostpad-paired"
    | "ghostpad-text"
    | "ghostpad-wipe"
    | "ghostpad-leave"
    | "ghostpad-ended"
    | "ghostpad-error"
    | "presence-subscribe"
    | "presence-unsubscribe"
    | "presence"
    | "disappear-timer";
  token?: string;
  alias?: string;
  to?: string;
  toAliases?: string[];
  from?: string;
  msgId?: number;
  payload?: string;
  x3dhHeader?: string;
  callId?: string;
  callMode?: string;
  text?: string;
  online?: boolean;
  // Task #113: client-generated id echoed back as `departed_ack.requestId`
  // so the panic-wipe flow can race the ack against a timeout.
  requestId?: string;
  // Ghostpad pairing code — never persisted, only ever lives in the
  // in-memory maps below for the few minutes it takes to be redeemed.
  code?: string;
  // Disappearing-message timeout in seconds; null means "off". Applies
  // going forward only — never retroactively to messages already sent.
  seconds?: number | null;
}

// Extend WebSocket with an aliveness flag used by the protocol-level heartbeat.
type LiveSocket = WebSocket & { isAlive: boolean };

interface AuthedSocket {
  ws: LiveSocket;
  alias: string;
  /** Identifies this particular connection, so a kick can spare the newest one. */
  connId: string;
}

const connectedClients = new Map<string, AuthedSocket>();

// Resolve an opaque delivery token → the alias whose socket is in
// connectedClients. This is an in-memory routing cache only — it is never
// stored or put on the wire, so keying live sockets by alias (which the call
// signalling path needs) does not weaken the metadata-blind guarantee. The
// mapping is stable for a user's lifetime, so entries are kept warm across
// reconnects rather than evicted on close.
const deliveryIdToAlias = new Map<string, string>();

async function aliasForDeliveryId(deliveryId: string): Promise<string | null> {
  const cached = deliveryIdToAlias.get(deliveryId);
  if (cached) return cached;
  const [row] = await db
    .select({ userId: identityKeysTable.userId })
    .from(identityKeysTable)
    .where(eq(identityKeysTable.deliveryId, deliveryId));
  if (!row) return null;
  deliveryIdToAlias.set(deliveryId, row.userId);
  return row.userId;
}

const CALL_SIGNAL_TYPES = new Set([
  "call-ring",
  "call-accept",
  "call-hangup",
  "call-offer",
  "call-answer",
  "call-ice",
]);

// How long to hold an offline call-ring open while a push wake gives the
// callee's device a chance to reconnect, before falling back to the
// existing "callee offline" bounce. Polling (not a single timeout) so a
// reconnect is picked up as soon as it happens rather than waiting out the
// full window every time.
//
// Must cover the full cold-launch chain on a killed app, not just network
// delivery: VoIP push -> CallKit shows the native ringing screen -> the
// human notices and taps Answer -> only THEN does the app cold-launch,
// mount AppProvider, wire up usePushNotifications' "answerCall" listener,
// call forceReconnect(), open the WS, and complete auth. The previous 8s
// budget covered barely any of that — real calls were getting bounced back
// to the caller as "offline" while the callee's phone was still audibly
// ringing, before they had a realistic chance to answer. Kept a few
// seconds under call.tsx's 30s caller-side ring timeout so this bounce
// fires first rather than racing it.
const CALL_WAKE_GRACE_MS = 25_000;
// ws invokes send's callback reliably; this only exists so a pathological
// socket cannot wedge a message handler indefinitely.
const SEND_CONFIRM_TIMEOUT_MS = 5_000;

const CALL_WAKE_POLL_MS = 500;

// Call signalling has no concept of "this pair already has a call in
// progress" — every call-ring is handled as a fully independent attempt,
// keyed only by its own callId. Without tracking below, rapid repeat
// call-rings between the same two aliases (manual retries, or a caller
// re-ringing after a bounce) each get their own VoIP push and their own
// native CallKit banner on the callee's phone — answering one does nothing
// to stop the others, which keep ringing/bouncing on their own schedules.
// This map makes "one call at a time per pair" an actual invariant: a
// second call-ring for a pair that already has an entry is rejected
// immediately with a distinct "busy" hangup instead of stacking a parallel
// attempt on top of the existing one.
// Call state, ghostpad pairing, deferred hangups and presence all moved to
// ./sharedState — see the note there. MAX_CALL_AGE_MS is now the TTL on the
// Redis key, so the "abandoned call" safety valve is enforced by expiry rather
// than by a comparison on read.

function callPairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

async function clearActiveCall(a: string, b: string, callId?: string): Promise<void> {
  await shared.clearActiveCall(callPairKey(a, b), callId);
}

// ── Deferred hangups for offline callees ────────────────────────────────────
// A call-hangup addressed to a callee who isn't connected used to be silently
// dropped: unlike call-ring it had no push, no queue, no bounce. That is
// exactly the window where the callee's phone is already ringing via a
// CallKit VoIP push — the one moment a hangup matters most. Nothing can stop
// CallKit ringing on a device whose app isn't running (there is no "cancel"
// VoIP push), so the earliest possible delivery is the moment the callee's
// socket authenticates; the client's no-listener call-hangup handler then
// dismisses the banner and tells CallKit "unanswered". Held per-alias with a
// short TTL — after the ring has long timed out on its own, a hangup is
// just noise.
async function deliverPendingCallHangups(alias: string, ws: WebSocket): Promise<void> {
  const list = await shared.takePendingCallHangups(alias);
  for (const h of list) {
    ws.send(JSON.stringify({ type: "call-hangup", from: h.from, callId: h.callId }));
    logger.debug({ alias, from: h.from, callId: h.callId }, "Deferred call-hangup delivered on reconnect");
  }
}

/**
 * Wait for the woken callee to come back. Checks shared presence rather than
 * this replica's socket map — after a VoIP wake the device may reconnect to a
 * different replica entirely, which a local check would never see.
 */
async function waitForReconnect(alias: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await shared.isOnline(alias)) return true;
    await new Promise((resolve) => setTimeout(resolve, CALL_WAKE_POLL_MS));
  }
  return shared.isOnline(alias);
}

// ── Ghostpad: live shared scratchpad, never persisted ───────────────────────
// A pairing code is redeemed once to link two sockets; from then on, text and
// wipe events relay directly between them (same shape as CALL_SIGNAL_TYPES
// above) and never touch the database. Both maps are pure in-memory routing
// state — they hold no content, only which alias is waiting/paired with whom.
const MAX_PRESENCE_SUBSCRIPTIONS_PER_SOCKET = 200;

async function notifyPresence(alias: string, online: boolean): Promise<void> {
  const watchers = await shared.getWatchers(alias);
  if (watchers.length === 0) return;
  for (const watcherAlias of watchers) {
    // Mutual-only, unchanged: a one-directional subscribe reveals nothing.
    if (!(await shared.mutuallySubscribed(alias, watcherAlias))) continue;
    await router.sendToAlias(watcherAlias, { type: "presence", from: alias, online });
  }
}

/** Tear down alias's pairing (if any) and tell the partner it ended. */
async function endGhostpadSession(alias: string): Promise<void> {
  const partnerAlias = await shared.clearGhostpadPair(alias);
  if (!partnerAlias) return;
  await router.sendToAlias(partnerAlias, { type: "ghostpad-ended" });
}

async function validateToken(alias: string, token: string): Promise<boolean> {
  // Swallows faults on purpose: a database error during the WebSocket
  // handshake must fail the auth, never reject out of the handler.
  try {
    return (await verifyDeviceToken(alias, token)) !== null;
  } catch {
    return false;
  }
}

async function deliverPending(deliveryId: string, ws: WebSocket): Promise<void> {
  try {
    const pending = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.toDeliveryId, deliveryId), eq(messagesTable.delivered, false)));

    for (const msg of pending) {
      // No `from` on the wire — the recipient recovers the sender from inside
      // the decrypted payload.
      const wire: WireMessage = {
        type: "msg",
        msgId: msg.id,
        payload: msg.payload,
        x3dhHeader: msg.x3dhHeader ?? undefined,
      };
      ws.send(JSON.stringify(wire));
    }

    // Sent, not delivered — the row is only removed once the client's own
    // `msgAck` says it actually decrypted and persisted this. A socket that
    // looked open when `ws.send` was called can still have gone dead without
    // the write ever reaching the client (see the readyState comment below),
    // so flagging on send here was exactly the "delivered means attempted,
    // not received" bug this replaces.
    if (pending.length > 0) {
      logger.info({ count: pending.length }, "Sent pending messages, awaiting ack");
    }
  } catch (err) {
    logger.error({ err }, "Failed to deliver pending messages");
  }
}

/**
 * Push any queued self-destruct notices addressed to this alias. Each row
 * is sent as a `{ type:"departed", from }` event, then flipped to delivered
 * so we don't replay it on subsequent reconnects.
 */
async function deliverPendingDepartures(alias: string, ws: WebSocket): Promise<void> {
  try {
    const pending = await db
      .select()
      .from(departuresTable)
      .where(and(eq(departuresTable.toAlias, alias), eq(departuresTable.delivered, false)));

    for (const row of pending) {
      ws.send(JSON.stringify({ type: "departed", from: row.fromAlias }));
    }

    if (pending.length > 0) {
      await markDeparturesDelivered(pending.map((row) => row.id));
      logger.info({ alias, count: pending.length }, "Delivered pending departures");
    }
  } catch (err) {
    logger.error({ err, alias }, "Failed to deliver pending departures");
  }
}

export function createWsServer(wss: WebSocketServer): void {
  // A newer connection for the same alias authenticated on another replica —
  // drop ours so the single-socket invariant holds cluster-wide.
  router.onKick((alias, connId) => {
    const held = connectedClients.get(alias);
    if (!held || held.connId === connId) return;
    // heldConnId is the socket being closed, winningConnId the one that
    // superseded it. Without both, this line cannot be correlated against the
    // cleanup below, and a caller-side supersede is indistinguishable from a
    // callee-side one — which is exactly the ambiguity blocking the
    // "Stale call-ring dropped" diagnosis.
    logger.info(
      { alias, heldConnId: held.connId, winningConnId: connId },
      "Closing superseded socket — same alias authenticated elsewhere",
    );
    held.ws.close(4002, "Superseded by a newer connection");
  });

  // ── Protocol-level heartbeat ─────────────────────────────────────────────
  // Every 30 s the server sends a native WebSocket ping frame to every client.
  // Clients that fail to respond with a pong within the next interval are
  // terminated.  This catches silently dropped TCP connections that the OS
  // hasn't noticed yet (mobile sleep, NAT timeout, etc.).
  function heartbeat(this: LiveSocket) {
    this.isAlive = true;
  }

  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((rawWs) => {
      const ws = rawWs as LiveSocket;
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });

    // Refresh presence for everyone this replica holds. PRESENCE_TTL_MS is 3x
    // this interval, so two missed refreshes are tolerated before a live user
    // reads as offline — at 1x, a slightly late tick would flicker them off
    // and fire spurious presence events at every watcher.
    void (async () => {
      for (const [alias, client] of connectedClients) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;
        try {
          await shared.setPresence(alias);
        } catch (err) {
          logger.warn({ err, alias }, "presence refresh failed");
        }
      }
    })();
  }, 30_000);


  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (rawWs: WebSocket, _req: IncomingMessage) => {
    const ws = rawWs as LiveSocket;
    ws.isAlive = true;
    ws.on("pong", heartbeat);

    let authedAlias: string | null = null;
    let authedDeliveryId: string | null = null;
    const connId = randomUUID();
    const myPresenceSubscriptions = new Set<string>(); // targets this socket is watching

    const cleanup = async () => {
      if (!authedAlias) return;
      const alias = authedAlias;
      // DIAGNOSTIC ONLY — deliberately does not change behaviour.
      //
      // cleanup() is keyed on the alias, never on this socket's connId, so a
      // superseded socket tearing down late will delete state belonging to
      // the newer socket that replaced it: connectedClients, the router
      // registration, and (via clearCallsForAlias) any parked call. That is
      // the leading suspect behind "Stale call-ring dropped".
      //
      // isCurrentHolder === false is the smoking gun: a socket that is no
      // longer the registered holder still running the teardown.
      const holder = connectedClients.get(alias);
      logger.info(
        {
          alias,
          connId,
          holderConnId: holder?.connId ?? null,
          isCurrentHolder: holder?.connId === connId,
        },
        "WS cleanup running",
      );
      connectedClients.delete(alias);
      await router.unregisterLocal(alias);
      try {
        // Presence goes first: everything below is best-effort, and a watcher
        // seeing a stale "online" is the most visible failure here.
        await shared.clearPresence(alias);
        // A dropped connection mid-call must release its pair lock too,
        // otherwise this alias can never call (or be called by) the other
        // party again until the entry ages out.
        await shared.clearCallsForAlias(alias);
        await shared.revokeGhostpadCode(alias);
        await endGhostpadSession(alias);
        await shared.clearSubscriptions(alias);
        await notifyPresence(alias, false);
      } catch (err) {
        logger.warn({ err, alias }, "WS cleanup failed");
      }
    };

    ws.on("close", () => void cleanup());
    ws.on("error", (err) => {
      logger.warn({ err }, "WebSocket error");
      void cleanup();
    });

    ws.on("message", async (raw: Buffer | string) => {
      let msg: WireMessage;
      try {
        msg = JSON.parse(raw.toString()) as WireMessage;
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (msg.type === "auth") {
        if (!msg.alias || !msg.token) {
          ws.send(JSON.stringify({ type: "error", message: "auth requires alias + token" }));
          return;
        }
        // Normalize once, up front — validateToken previously matched the
        // raw wire alias against the (always-normalized) stored userId,
        // which is a different form than every other alias path uses.
        const normalizedAuthAlias = normalizeAlias(msg.alias);
        if (!normalizedAuthAlias) {
          ws.send(JSON.stringify({ type: "error", message: "auth failed" }));
          ws.close(4001, "Unauthorized");
          return;
        }
        const valid = await validateToken(normalizedAuthAlias, msg.token);
        if (!valid) {
          ws.send(JSON.stringify({ type: "error", message: "auth failed" }));
          ws.close(4001, "Unauthorized");
          return;
        }

        authedAlias = normalizedAuthAlias;
        connectedClients.set(authedAlias, { ws, alias: authedAlias, connId });
        // Writes to this socket, confirming via ws.send's callback — the only
        // place that confirmation is possible, since it cannot cross a process.
        await router.registerLocal(authedAlias, (frame: string) =>
          new Promise<boolean>((resolve) => {
            if (ws.readyState !== WebSocket.OPEN) return resolve(false);
            // Bound the wait. ws always invokes this callback, but an
            // unbounded promise here would stall the entire message handler
            // for this socket if it ever didn't — and every frame routed to
            // this alias queues behind it. Timing out as "not delivered" is
            // the safe direction: the caller falls back to a wake push, and a
            // spurious wake is far cheaper than a dropped message.
            let settled = false;
            const timer = setTimeout(() => {
              if (settled) return;
              settled = true;
              logger.warn({ alias: authedAlias }, "ws.send callback never fired — treating as undelivered");
              resolve(false);
            }, SEND_CONFIRM_TIMEOUT_MS);
            ws.send(frame, (err) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve(!err);
            });
          }),
        );
        // One device per user (deviceTokensTable.userId is unique). Within one
        // process the Map.set above was enough to supersede an older socket;
        // across replicas it is not, so tell the others to drop theirs.
        await router.kickOtherHolders(authedAlias, connId);
        // Resolve (and warm the cache for) this user's opaque delivery token so
        // pending messages addressed to it can be routed back to this socket.
        authedDeliveryId = await ensureDeliveryId(authedAlias);
        if (authedDeliveryId) deliveryIdToAlias.set(authedDeliveryId, authedAlias);
        ws.send(JSON.stringify({ type: "ack", alias: authedAlias }));
        logger.info({ alias: authedAlias }, "WS client authenticated");
        await shared.setPresence(authedAlias);
        await notifyPresence(authedAlias, true);

        if (authedDeliveryId) await deliverPending(authedDeliveryId, ws);
        await deliverPendingDepartures(authedAlias, ws);
        await deliverPendingCallHangups(authedAlias, ws);
        return;
      }

      if (!authedAlias) {
        ws.send(JSON.stringify({ type: "error", message: "not authenticated" }));
        return;
      }

      // ── Low-bandwidth compressed frame unwrap (Task #111) ──────────────
      // The client wraps outgoing JSON in `msg-z` when low-bandwidth mode
      // is active to save satellite bytes. We inflate transparently here
      // and continue processing as if the original `msg` frame arrived.
      //
      // Security: this branch sits BELOW the auth gate so unauthenticated
      // attackers can't burn server CPU/memory inflating crafted payloads.
      // We additionally bound both the compressed input size and the
      // inflated output size (zip-bomb defense — node's zlib throws when
      // `maxOutputLength` is exceeded). Server→client traffic is NOT
      // compressed at this layer; receivers get the normal `msg` envelope
      // back unchanged.
      if ((msg as { type?: string }).type === "msg-z") {
        const data = (msg as { data?: unknown }).data;
        if (typeof data !== "string") {
          ws.send(JSON.stringify({ type: "error", message: "msg-z requires data" }));
          return;
        }
        if (data.length > MSG_Z_MAX_COMPRESSED_BYTES) {
          logger.warn(
            { alias: authedAlias, bytes: data.length },
            "Rejected oversized msg-z frame (compressed)",
          );
          ws.send(JSON.stringify({ type: "error", message: "Compressed frame too large" }));
          return;
        }
        let inflated: string;
        try {
          // fflate.deflateSync (client) emits a RAW deflate stream — no
          // zlib header/checksum — so we use inflateRawSync here. Using
          // plain inflateSync fails with "incorrect header check" and the
          // client's compressed frames silently never deliver.
          const buf = inflateRawSync(Buffer.from(data, "base64"), {
            maxOutputLength: MSG_Z_MAX_INFLATED_BYTES,
          });
          inflated = buf.toString("utf8");
        } catch (e) {
          logger.warn({ err: e, alias: authedAlias }, "Failed to inflate msg-z frame");
          ws.send(JSON.stringify({ type: "error", message: "Invalid compressed frame" }));
          return;
        }
        try {
          msg = JSON.parse(inflated) as WireMessage;
        } catch (e) {
          logger.warn({ err: e, alias: authedAlias }, "Inflated msg-z frame is not valid JSON");
          ws.send(JSON.stringify({ type: "error", message: "Invalid compressed frame" }));
          return;
        }
        // Disallow nested compression to keep the decode bounded.
        if ((msg as { type?: string }).type === "msg-z") {
          ws.send(JSON.stringify({ type: "error", message: "Nested msg-z not allowed" }));
          return;
        }
      }

      // ── Call signalling — ephemeral relay, never persisted ────────────────
      if (CALL_SIGNAL_TYPES.has(msg.type)) {
        if (!msg.to) return;
        const toAlias = normalizeAlias(msg.to);
        if (!toAlias) return;
        let recipientOnline = await shared.isOnline(toAlias);

        if (msg.type === "call-ring") {
          const pairKey = callPairKey(authedAlias, toAlias);
          const existingCall = await shared.getActiveCall(pairKey);
          if (existingCall && Date.now() - existingCall.startedAt < shared.MAX_CALL_AGE_MS) {
            // This pair already has a call ringing or in progress (its own
            // callId, tracked separately) — reject this one immediately
            // rather than sending a second independent VoIP push/CallKit
            // banner that would keep ringing after the first is answered.
            ws.send(
              JSON.stringify({
                type: "call-hangup",
                from: toAlias,
                callId: msg.callId,
                payload: "busy",
              }),
            );
            logger.debug(
              { from: authedAlias, to: toAlias, existingCallId: existingCall.callId },
              "Call ring rejected: pair already has a call in progress",
            );
            return;
          }
          await shared.setActiveCall(pairKey, {
            callId: msg.callId ?? "",
            caller: authedAlias,
            callee: toAlias,
            startedAt: Date.now(),
          });
        } else if (msg.type === "call-hangup") {
          await clearActiveCall(authedAlias, toAlias, msg.callId);
        }

        // Callee isn't connected — before giving up, try to wake their device
        // (VoIP push on iOS via CallKit, high-priority data push on Android)
        // and give it a short window to reconnect. If neither push token is
        // registered this resolves immediately and falls straight through to
        // the existing offline bounce, unchanged.
        if (!recipientOnline && msg.type === "call-ring") {
          // Best-effort: if the push_token columns aren't migrated yet on this
          // deployment (or the push send throws for any other reason), fall
          // straight through to the existing offline bounce below rather than
          // dropping the call attempt entirely.
          try {
            const tokens = await pushTokensForAlias(toAlias);
            // Tracks whether a push actually went out — not just whether a
            // token was on file — so a permanently-dead token (cleared
            // below) doesn't still cost this call the full grace-period
            // wait for a reconnect that can no longer happen.
            let sentOk = false;
            if (tokens?.voipPushToken) {
              const result = await sendVoipPushIOS(tokens.voipPushToken, {
                callId: msg.callId,
                from: authedAlias,
                callMode: msg.callMode,
              });
              if (result.ok) {
                sentOk = true;
                logger.info({ alias: toAlias, callId: msg.callId }, "Call-wake VoIP push sent");
              } else {
                logger.warn({ alias: toAlias, callId: msg.callId }, "Call-wake VoIP push failed to send");
              }
              if (result.invalidToken) await clearVoipPushTokenForAlias(toAlias);
            } else if (tokens?.expoPushToken) {
              const result = await sendExpoPush(
                tokens.expoPushToken,
                "Incoming call",
                { type: "incoming-call", callId: msg.callId, from: authedAlias, callMode: msg.callMode },
                { channelId: "incoming-calls" },
              );
              if (result.ok) {
                sentOk = true;
                logger.info({ alias: toAlias, callId: msg.callId }, "Call-wake Expo push sent");
              }
              if (result.invalidToken) await clearExpoPushTokenForAlias(toAlias);
            } else {
              logger.warn({ alias: toAlias, callId: msg.callId }, "Call-wake push skipped — no push token on file");
            }
            if (sentOk) {
              recipientOnline = await waitForReconnect(toAlias, CALL_WAKE_GRACE_MS);
            }
          } catch (err) {
            logger.warn({ err, from: authedAlias, to: toAlias }, "Call-wake push attempt failed");
          }
        }

        // A parked call-ring can outlive its own call: while waitForReconnect
        // above was polling, the caller may have hung up — that hangup is
        // processed concurrently on this same socket and clears the
        // activeCallsByPair entry. Relaying the ring anyway resurrects a call
        // that is already over: the callee gets a fresh incoming-call banner
        // for a dead call and their answer signals bounce back at a caller
        // who left. The pair entry doubles as the cancellation flag — gone,
        // or repopulated with a different callId, means THIS ring is stale:
        // don't relay it, don't bounce "offline" at the caller (they ended
        // the call; that's not an error), and if the callee did connect,
        // send them the hangup their CallKit UI is waiting on (harmless
        // duplicate if the deferred-hangup queue already delivered one —
        // notifyCallEnded is idempotent client-side).
        if (msg.type === "call-ring") {
          const parked = await shared.getActiveCall(callPairKey(authedAlias, toAlias));
          if (!parked || parked.callId !== (msg.callId ?? "")) {
            await router.sendToAlias(toAlias, {
              type: "call-hangup",
              from: authedAlias,
              callId: msg.callId,
            });
            // `!parked` and a callId mismatch are different failures wearing
            // one message: the first means the pair entry was deleted (by a
            // hangup, or by clearCallsForAlias on some socket's teardown), the
            // second means it was replaced by a newer call. Reported
            // separately so the logs can tell them apart.
            logger.info(
              {
                from: authedAlias,
                to: toAlias,
                callId: msg.callId,
                reason: !parked ? "pair-entry-gone" : "callid-mismatch",
                parkedCallId: parked?.callId ?? null,
                parkedAgeMs: parked ? Date.now() - parked.startedAt : null,
              },
              "Stale call-ring dropped: call ended while waiting for callee wake",
            );
            return;
          }
        }

        // Branch on whether the frame was actually written to a socket, not on
        // a readyState read — readyState lies for tens of seconds after a
        // backgrounded client's socket dies (see the note in the msg path), and
        // it cannot see a socket held by another replica at all.
        const relayed = await router.sendToAlias(toAlias, { ...msg, from: authedAlias });
        if (relayed) {
          logger.debug({ type: msg.type, from: authedAlias, to: toAlias }, "Call signal relayed");
        } else if (msg.type === "call-hangup") {
          // Callee offline — hold it for their next connect instead of
          // dropping it (see pendingCallHangups above). This is the caller
          // hanging up while the callee's phone is still ringing from the
          // VoIP push: the hangup must survive until that device connects.
          await shared.queueCallHangup(toAlias, authedAlias, msg.callId);
          logger.debug(
            { from: authedAlias, to: toAlias, callId: msg.callId },
            "call-hangup queued for offline callee",
          );
        } else if (msg.type === "call-ring") {
          // Callee is offline (and either has no push token, or didn't
          // reconnect within the wake grace period) — bounce hangup back to
          // the caller.
          ws.send(
            JSON.stringify({
              type: "call-hangup",
              from: toAlias,
              callId: msg.callId,
              payload: "offline",
            }),
          );
          logger.debug({ from: authedAlias, to: toAlias }, "Call ring bounced: callee offline");
          await clearActiveCall(authedAlias, toAlias, msg.callId);
        }
        return;
      }

      // ── Ghostpad — ephemeral shared scratchpad, never persisted ─────────────
      if (msg.type === "ghostpad-create") {
        await shared.revokeGhostpadCode(authedAlias); // one pending code per alias
        // Claimed atomically (SET NX): with more than one replica a local
        // uniqueness check would let two processes mint the same code, and a
        // duplicate would pair a joiner with the wrong person.
        const code = await shared.claimGhostpadCode(authedAlias);
        if (!code) {
          ws.send(JSON.stringify({ type: "ghostpad-error", text: "Could not create a code, try again" }));
          return;
        }
        ws.send(JSON.stringify({ type: "ghostpad-created", code }));
        return;
      }

      if (msg.type === "ghostpad-join") {
        if (!msg.code) {
          ws.send(JSON.stringify({ type: "ghostpad-error", text: "Code required" }));
          return;
        }
        // Redeemed with GETDEL — single-use, and two joiners racing the same
        // code cannot both win.
        const creatorAlias = await shared.redeemGhostpadCode(msg.code);
        if (!creatorAlias) {
          ws.send(JSON.stringify({ type: "ghostpad-error", text: "Code expired or invalid" }));
          return;
        }
        if (creatorAlias === authedAlias) {
          ws.send(JSON.stringify({ type: "ghostpad-error", text: "Cannot pair with yourself" }));
          return;
        }
        if (!(await shared.isOnline(creatorAlias))) {
          ws.send(JSON.stringify({ type: "ghostpad-error", text: "The other side disconnected" }));
          return;
        }
        await shared.setGhostpadPair(authedAlias, creatorAlias);
        ws.send(JSON.stringify({ type: "ghostpad-paired" }));
        await router.sendToAlias(creatorAlias, { type: "ghostpad-paired" });
        logger.debug({ a: authedAlias, b: creatorAlias }, "Ghostpad paired");
        return;
      }

      if (msg.type === "ghostpad-text" || msg.type === "ghostpad-wipe") {
        const partnerAlias = await shared.getGhostpadPartner(authedAlias);
        if (partnerAlias) {
          await router.sendToAlias(partnerAlias, { type: msg.type, text: msg.text });
        }
        return;
      }

      if (msg.type === "ghostpad-leave") {
        await endGhostpadSession(authedAlias);
        return;
      }

      // ── Disappearing-message timer — ephemeral relay, never persisted ──────
      // Same "less metadata-blind" tier as call signalling/presence above.
      // Syncs the setting live between two connected peers; if the other
      // side isn't connected right now it simply doesn't sync this time —
      // no queueing, same as presence and Ghostpad.
      if (msg.type === "disappear-timer") {
        if (!msg.to) return;
        const toAlias = normalizeAlias(msg.to);
        if (!toAlias) return;
        await router.sendToAlias(toAlias, {
          type: "disappear-timer",
          from: authedAlias,
          seconds: msg.seconds ?? null,
        });
        return;
      }

      // ── Presence: subscribe/unsubscribe to another alias's online status ───
      if (msg.type === "presence-subscribe") {
        if (!msg.to) return;
        if (myPresenceSubscriptions.size >= MAX_PRESENCE_SUBSCRIPTIONS_PER_SOCKET) return;
        const targetAlias = normalizeAlias(msg.to);
        if (!targetAlias) return;
        await shared.addSubscription(authedAlias, targetAlias);
        myPresenceSubscriptions.add(targetAlias);
        // Mutual-only (see comment on presenceSubscribers above) — a
        // one-directional subscribe reveals nothing. Once this subscribe
        // completes reciprocity, tell both sides each other's status; the
        // other side may have been sitting on a one-directional subscribe
        // of their own for a while, waiting for exactly this.
        if (await shared.mutuallySubscribed(authedAlias, targetAlias)) {
          ws.send(JSON.stringify({ type: "presence", from: targetAlias, online: await shared.isOnline(targetAlias) }));
          await router.sendToAlias(targetAlias, { type: "presence", from: authedAlias, online: true });
        }
        return;
      }

      if (msg.type === "presence-unsubscribe") {
        if (!msg.to) return;
        const targetAlias = normalizeAlias(msg.to);
        if (!targetAlias) return;
        await shared.removeSubscription(authedAlias, targetAlias);
        myPresenceSubscriptions.delete(targetAlias);
        return;
      }

      // ── Text messages ─────────────────────────────────────────────────────
      // Metadata-blind: `msg.to` is the recipient's opaque delivery token (NOT
      // an alias), and the sender is never recorded — neither in the stored row
      // nor on the wire. The recipient recovers the sender from the decrypted
      // payload. We deliberately do not log either party's identity here.
      if (msg.type === "msg") {
        if (!msg.to || !msg.payload) {
          ws.send(JSON.stringify({ type: "error", message: "msg requires to + payload" }));
          return;
        }

        const toDeliveryId = msg.to;

        const [stored] = await db
          .insert(messagesTable)
          .values({
            toDeliveryId,
            payload: msg.payload,
            x3dhHeader: msg.x3dhHeader ?? null,
            delivered: false,
          })
          .returning();

        // Computed here (rather than inside pushFallback below) so it's
        // available for the two log lines there without a second lookup.
        const recipientAlias = await aliasForDeliveryId(toDeliveryId);

        // Best-effort, same as the call-wake path above: if the push_token
        // columns aren't migrated yet on this deployment, or the send
        // throws for any other reason, the message stays queued for normal
        // poll/reconnect delivery — it must not affect the ack below.
        const pushFallback = async () => {
          logger.debug({ msgId: stored.id }, "Message queued for offline delivery");
          try {
            // Generic alert text only — never the sender or message content.
            // This server doesn't know the sender either (see comment above),
            // and a push body is visible to Apple/Google/Expo in transit.
            const tokens = await pushTokensForDeliveryId(toDeliveryId);
            if (tokens?.expoPushToken) {
              const result = await sendExpoPush(tokens.expoPushToken, "You have a new message", { type: "message" });
              if (result.ok) logger.info({ alias: recipientAlias, msgId: stored.id }, "Message-wake push sent");
              if (result.invalidToken) await clearExpoPushTokenForDeliveryId(toDeliveryId);
            } else {
              logger.warn({ alias: recipientAlias, msgId: stored.id }, "Message-wake push skipped — no Expo push token on file");
            }
          } catch (err) {
            logger.warn({ err, msgId: stored.id }, "Message-wake push attempt failed");
          }
        };
        if (recipientAlias) {
          const wire: WireMessage = {
            type: "msg",
            msgId: stored.id,
            payload: msg.payload,
            x3dhHeader: msg.x3dhHeader ?? undefined,
          };
          // readyState can still read OPEN for tens of seconds after a
          // backgrounded/closed client's socket has actually gone dead (the
          // heartbeat only detects this every ~30-60s — see the interval
          // above) — so a send failure here is expected, not exceptional.
          // sendToAlias confirms the write via ws.send's callback on the
          // replica that holds the socket; on failure we fall back to push
          // exactly as if the socket had never been open at all.
          const sent = await router.sendToAlias(recipientAlias, wire);
          if (sent) {
            // Not marked delivered here — a successful write proves the TCP
            // buffer accepted it, not that the recipient's app received,
            // decrypted or persisted it. The row is removed once their
            // client sends `msgAck`; if that never comes, the next
            // `deliverPending` on reconnect resends it.
            logger.debug({ msgId: stored.id }, "Message sent live, awaiting ack");
          } else {
            logger.debug({ msgId: stored.id }, "Live send failed on a stale socket — falling back to push");
            await pushFallback();
          }
        } else {
          await pushFallback();
        }

        ws.send(JSON.stringify({ type: "ack", msgId: stored.id }));
        return;
      }

      // ── Self-destruct departure notice ────────────────────────────────────
      // Broadcast a one-shot "I've wiped" event to a list of known contacts.
      // No payload, no keys — just the fact that this alias is gone. Persist
      // for offline recipients so they learn on next connect.
      if (msg.type === "departed") {
        const targets = Array.isArray(msg.toAliases) ? msg.toAliases : [];
        const unique = Array.from(
          new Set(
            targets
              .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
              .map((a) => normalizeAlias(a))
              .filter((a): a is string => a !== null),
          ),
        ).filter((a) => a !== authedAlias);

        for (const toAlias of unique) {
          try {
            const [stored] = await db
              .insert(departuresTable)
              .values({ fromAlias: authedAlias, toAlias, delivered: false })
              .returning();
            if (await router.sendToAlias(toAlias, { type: "departed", from: authedAlias })) {
              await db
                .update(departuresTable)
                .set({ delivered: true })
                .where(eq(departuresTable.id, stored.id));
            }
          } catch (err) {
            logger.warn({ err, from: authedAlias, to: toAlias }, "Failed to record departure");
          }
        }
        logger.info({ from: authedAlias, count: unique.length }, "Departure broadcast");
        // Task #113: the client uses this ack to decide whether to fall
        // through to the SMS satellite fallback. We emit the ack only
        // AFTER the broadcast loop completes, so an ack guarantees the
        // server has at minimum persisted the departure for every
        // unique recipient (live push attempted, queued for offline).
        // Always echo the requestId verbatim — the client matches on it.
        if (typeof msg.requestId === "string" && msg.requestId.length > 0) {
          try {
            ws.send(JSON.stringify({ type: "departed_ack", requestId: msg.requestId }));
          } catch (err) {
            logger.warn({ err, from: authedAlias }, "Failed to ack departure");
          }
        }
        return;
      }

      // Client confirms it decrypted and persisted msgId locally — this is
      // the ack `deliverPending`/the live-send path above are waiting on.
      // Distinct type name from the server->client "ack" (auth confirmation,
      // and the send-stored ack above): same word meant two different things
      // in opposite directions on this wire — see TRACKER.
      if (msg.type === "msgAck") {
        if (msg.msgId) {
          await deleteAckedMessages([msg.msgId]);
        }
        return;
      }
    });

    ws.send(JSON.stringify({ type: "connected" }));
  });
}

/**
 * Push a message to a single connected alias over WebSocket.
 * Used for real-time server-initiated events (e.g. inbound SMS).
 * No-ops silently if the alias is offline.
 */
export async function broadcastToAlias(
  alias: string,
  message: Omit<WireMessage, "token">,
): Promise<void> {
  const normalized = normalizeAlias(alias);
  if (!normalized) return;
  // Routed, so an inbound SMS reaches the user whichever replica holds them.
  await router.sendToAlias(normalized, message);
}

export { connectedClients };
