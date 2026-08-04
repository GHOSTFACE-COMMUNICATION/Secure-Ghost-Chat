import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import {
  db,
  messagesTable,
  identityKeysTable,
  deviceTokensTable,
  departuresTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createHash } from "crypto";
import { inflateRawSync } from "zlib";
import { logger } from "../lib/logger";
import { normalizeAlias } from "../utils/alias";
import { ensureDeliveryId } from "../utils/delivery";

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
    | "ghostpad-error";
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
  // Task #113: client-generated id echoed back as `departed_ack.requestId`
  // so the panic-wipe flow can race the ack against a timeout.
  requestId?: string;
  // Ghostpad pairing code — never persisted, only ever lives in the
  // in-memory maps below for the few minutes it takes to be redeemed.
  code?: string;
}

// Extend WebSocket with an aliveness flag used by the protocol-level heartbeat.
type LiveSocket = WebSocket & { isAlive: boolean };

interface AuthedSocket {
  ws: LiveSocket;
  alias: string;
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

// ── Ghostpad: live shared scratchpad, never persisted ───────────────────────
// A pairing code is redeemed once to link two sockets; from then on, text and
// wipe events relay directly between them (same shape as CALL_SIGNAL_TYPES
// above) and never touch the database. Both maps are pure in-memory routing
// state — they hold no content, only which alias is waiting/paired with whom.
const GHOSTPAD_CODE_TTL_MS = 5 * 60_000;
const ghostpadCodes = new Map<string, { alias: string; expiresAt: number }>();
const ghostpadPartners = new Map<string, string>(); // alias -> paired alias

function generateGhostpadCode(): string {
  let code: string;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (ghostpadCodes.has(code));
  return code;
}

function sweepExpiredGhostpadCodes(): void {
  const now = Date.now();
  for (const [code, entry] of ghostpadCodes) {
    if (entry.expiresAt <= now) ghostpadCodes.delete(code);
  }
}

/** Tear down alias's pairing (if any) and tell the partner it ended. */
function endGhostpadSession(alias: string): void {
  const partnerAlias = ghostpadPartners.get(alias);
  if (!partnerAlias) return;
  ghostpadPartners.delete(alias);
  ghostpadPartners.delete(partnerAlias);
  const partner = connectedClients.get(partnerAlias);
  if (partner && partner.ws.readyState === WebSocket.OPEN) {
    partner.ws.send(JSON.stringify({ type: "ghostpad-ended" }));
  }
}

/** Drop any pending (unredeemed) code this alias created. */
function revokeGhostpadCode(alias: string): void {
  for (const [code, entry] of ghostpadCodes) {
    if (entry.alias === alias) ghostpadCodes.delete(code);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function validateToken(alias: string, token: string): Promise<boolean> {
  try {
    const hash = hashToken(token);
    const [row] = await db
      .select()
      .from(deviceTokensTable)
      .where(and(eq(deviceTokensTable.userId, alias), eq(deviceTokensTable.tokenHash, hash)));
    return !!row;
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

    if (pending.length > 0) {
      const ids = pending.map((m) => m.id);
      await Promise.all(
        ids.map((id) =>
          db.update(messagesTable).set({ delivered: true }).where(eq(messagesTable.id, id)),
        ),
      );
      logger.info({ count: pending.length }, "Delivered pending messages");
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
      await Promise.all(
        pending.map((row) =>
          db.update(departuresTable).set({ delivered: true }).where(eq(departuresTable.id, row.id)),
        ),
      );
      logger.info({ alias, count: pending.length }, "Delivered pending departures");
    }
  } catch (err) {
    logger.error({ err, alias }, "Failed to deliver pending departures");
  }
}

export function createWsServer(wss: WebSocketServer): void {
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
  }, 30_000);

  const ghostpadSweepInterval = setInterval(sweepExpiredGhostpadCodes, 60_000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
    clearInterval(ghostpadSweepInterval);
  });

  wss.on("connection", (rawWs: WebSocket, _req: IncomingMessage) => {
    const ws = rawWs as LiveSocket;
    ws.isAlive = true;
    ws.on("pong", heartbeat);

    let authedAlias: string | null = null;
    let authedDeliveryId: string | null = null;

    const cleanup = () => {
      if (authedAlias) {
        connectedClients.delete(authedAlias);
        revokeGhostpadCode(authedAlias);
        endGhostpadSession(authedAlias);
      }
    };

    ws.on("close", cleanup);
    ws.on("error", (err) => {
      logger.warn({ err }, "WebSocket error");
      cleanup();
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
        const valid = await validateToken(msg.alias, msg.token);
        if (!valid) {
          ws.send(JSON.stringify({ type: "error", message: "auth failed" }));
          ws.close(4001, "Unauthorized");
          return;
        }

        authedAlias = normalizeAlias(msg.alias);
        connectedClients.set(authedAlias, { ws, alias: authedAlias });
        // Resolve (and warm the cache for) this user's opaque delivery token so
        // pending messages addressed to it can be routed back to this socket.
        authedDeliveryId = await ensureDeliveryId(authedAlias);
        if (authedDeliveryId) deliveryIdToAlias.set(authedDeliveryId, authedAlias);
        ws.send(JSON.stringify({ type: "ack", alias: authedAlias }));
        logger.info({ alias: authedAlias }, "WS client authenticated");

        if (authedDeliveryId) await deliverPending(authedDeliveryId, ws);
        await deliverPendingDepartures(authedAlias, ws);
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
        const recipient = connectedClients.get(toAlias);
        if (recipient && recipient.ws.readyState === WebSocket.OPEN) {
          recipient.ws.send(JSON.stringify({ ...msg, from: authedAlias }));
          logger.debug({ type: msg.type, from: authedAlias, to: toAlias }, "Call signal relayed");
        } else if (msg.type === "call-ring") {
          // Callee is offline — bounce hangup back to caller immediately
          ws.send(
            JSON.stringify({
              type: "call-hangup",
              from: toAlias,
              callId: msg.callId,
              payload: "offline",
            }),
          );
          logger.debug({ from: authedAlias, to: toAlias }, "Call ring bounced: callee offline");
        }
        return;
      }

      // ── Ghostpad — ephemeral shared scratchpad, never persisted ─────────────
      if (msg.type === "ghostpad-create") {
        revokeGhostpadCode(authedAlias); // one pending code per alias at a time
        const code = generateGhostpadCode();
        ghostpadCodes.set(code, { alias: authedAlias, expiresAt: Date.now() + GHOSTPAD_CODE_TTL_MS });
        ws.send(JSON.stringify({ type: "ghostpad-created", code }));
        return;
      }

      if (msg.type === "ghostpad-join") {
        if (!msg.code) {
          ws.send(JSON.stringify({ type: "ghostpad-error", text: "Code required" }));
          return;
        }
        const entry = ghostpadCodes.get(msg.code);
        if (!entry || entry.expiresAt <= Date.now()) {
          ghostpadCodes.delete(msg.code);
          ws.send(JSON.stringify({ type: "ghostpad-error", text: "Code expired or invalid" }));
          return;
        }
        if (entry.alias === authedAlias) {
          ws.send(JSON.stringify({ type: "ghostpad-error", text: "Cannot pair with yourself" }));
          return;
        }
        ghostpadCodes.delete(msg.code); // single-use
        const creatorAlias = entry.alias;
        const creator = connectedClients.get(creatorAlias);
        if (!creator || creator.ws.readyState !== WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ghostpad-error", text: "The other side disconnected" }));
          return;
        }
        ghostpadPartners.set(authedAlias, creatorAlias);
        ghostpadPartners.set(creatorAlias, authedAlias);
        ws.send(JSON.stringify({ type: "ghostpad-paired" }));
        creator.ws.send(JSON.stringify({ type: "ghostpad-paired" }));
        logger.debug({ a: authedAlias, b: creatorAlias }, "Ghostpad paired");
        return;
      }

      if (msg.type === "ghostpad-text" || msg.type === "ghostpad-wipe") {
        const partnerAlias = ghostpadPartners.get(authedAlias);
        const partner = partnerAlias ? connectedClients.get(partnerAlias) : undefined;
        if (partner && partner.ws.readyState === WebSocket.OPEN) {
          partner.ws.send(JSON.stringify({ type: msg.type, text: msg.text }));
        }
        return;
      }

      if (msg.type === "ghostpad-leave") {
        endGhostpadSession(authedAlias);
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

        const recipientAlias = await aliasForDeliveryId(toDeliveryId);
        const recipient = recipientAlias ? connectedClients.get(recipientAlias) : undefined;
        if (recipient && recipient.ws.readyState === WebSocket.OPEN) {
          const wire: WireMessage = {
            type: "msg",
            msgId: stored.id,
            payload: msg.payload,
            x3dhHeader: msg.x3dhHeader ?? undefined,
          };
          recipient.ws.send(JSON.stringify(wire));
          await db
            .update(messagesTable)
            .set({ delivered: true })
            .where(eq(messagesTable.id, stored.id));
          logger.debug({ msgId: stored.id }, "Message delivered live");
        } else {
          logger.debug({ msgId: stored.id }, "Message queued for offline delivery");
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
              .map((a) => normalizeAlias(a)),
          ),
        ).filter((a) => a !== authedAlias);

        for (const toAlias of unique) {
          try {
            const [stored] = await db
              .insert(departuresTable)
              .values({ fromAlias: authedAlias, toAlias, delivered: false })
              .returning();
            const recipient = connectedClients.get(toAlias);
            if (recipient && recipient.ws.readyState === WebSocket.OPEN) {
              recipient.ws.send(JSON.stringify({ type: "departed", from: authedAlias }));
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

      if (msg.type === "ack") {
        if (msg.msgId) {
          await db
            .update(messagesTable)
            .set({ delivered: true })
            .where(eq(messagesTable.id, msg.msgId));
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
export function broadcastToAlias(alias: string, message: Omit<WireMessage, "token">): void {
  const normalized = normalizeAlias(alias);
  const client = connectedClients.get(normalized);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message));
  }
}

export { connectedClients };
