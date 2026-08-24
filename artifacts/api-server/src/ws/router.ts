import { getRedis, getRedisSubscriber, isRedisHealthy } from "../lib/redis";
import { logger } from "../lib/logger";

/**
 * Cross-replica frame routing.
 *
 * A WebSocket handle cannot be shared, so `connectedClients` stays local to
 * whichever replica accepted the connection. Instead of a routing table saying
 * "alias X is on replica 3", each replica subscribes to a channel per alias it
 * holds, and any replica reaches X by publishing to that channel. Whoever holds
 * the socket picks it up.
 *
 * That means no sticky sessions are needed: any replica can accept any socket.
 */

/** Writes a frame to a locally-held socket. Resolves false if the write failed. */
type LocalDeliver = (frame: string) => Promise<boolean>;

const localDelivery = new Map<string, LocalDeliver>();

const CHANNEL_PREFIX = "ws:u:";
const KICK_CHANNEL = "ws:kick";

let wired = false;
let kickHandler: ((alias: string, connId: string) => void) | null = null;

function wireSubscriber(): void {
  if (wired) return;
  const sub = getRedisSubscriber();
  if (!sub) return;
  wired = true;

  sub.on("message", (channel: string, raw: string) => {
    if (channel === KICK_CHANNEL) {
      try {
        const { alias, connId } = JSON.parse(raw) as { alias: string; connId: string };
        kickHandler?.(alias, connId);
      } catch (err) {
        logger.warn({ err }, "[router] malformed kick message");
      }
      return;
    }
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    const alias = channel.slice(CHANNEL_PREFIX.length);
    const deliver = localDelivery.get(alias);
    if (!deliver) return; // we no longer hold this alias; another replica will
    void deliver(raw).catch((err) =>
      logger.warn({ err, alias }, "[router] local delivery of a routed frame failed"),
    );
  });

  // Re-subscribe on every ready, not just the first. ioredis drops all
  // subscriptions when the connection drops, so after a blip this replica
  // would keep holding sockets that no other replica could reach — silently,
  // since nothing errors. Re-arming here also covers the startup case, where
  // the socket is not yet up when this first runs.
  const resubscribe = () => {
    const channels = [KICK_CHANNEL, ...[...localDelivery.keys()].map((a) => `${CHANNEL_PREFIX}${a}`)];
    sub
      .subscribe(...channels)
      .then(() => logger.info({ count: channels.length }, "[router] subscriptions armed"))
      .catch((err) => logger.warn({ err }, "[router] subscribe failed"));
  };
  sub.on("ready", resubscribe);
  if (sub.status === "ready") resubscribe();
}

/** Called when this replica accepts an authenticated socket for `alias`. */
export async function registerLocal(alias: string, deliver: LocalDeliver): Promise<void> {
  localDelivery.set(alias, deliver);
  wireSubscriber();
  const sub = getRedisSubscriber();
  if (!sub) return;
  try {
    await sub.subscribe(`${CHANNEL_PREFIX}${alias}`);
  } catch (err) {
    logger.warn({ err, alias }, "[router] subscribe failed — this alias is reachable locally only");
  }
}

/** Called when the socket for `alias` closes on this replica. */
export async function unregisterLocal(alias: string): Promise<void> {
  localDelivery.delete(alias);
  const sub = getRedisSubscriber();
  if (!sub) return;
  try {
    await sub.unsubscribe(`${CHANNEL_PREFIX}${alias}`);
  } catch (err) {
    logger.warn({ err, alias }, "[router] unsubscribe failed");
  }
}

export function holdsLocally(alias: string): boolean {
  return localDelivery.has(alias);
}

/**
 * Deliver a frame to `alias` wherever it is connected.
 * Returns true only if some replica actually wrote it to a socket.
 */
export async function sendToAlias(alias: string, message: unknown): Promise<boolean> {
  const frame = typeof message === "string" ? message : JSON.stringify(message);

  // Local first — this is also the only path that can confirm the write, since
  // ws.send's callback cannot cross a process boundary.
  const deliver = localDelivery.get(alias);
  if (deliver) {
    try {
      if (await deliver(frame)) return true;
    } catch (err) {
      logger.warn({ err, alias }, "[router] local delivery failed — trying other replicas");
    }
  }

  const redis = isRedisHealthy() ? getRedis() : null;
  if (!redis) return false;

  try {
    const receivers = await redis.publish(`${CHANNEL_PREFIX}${alias}`, frame);
    // We are subscribed to our own channel while we hold the alias, so we count
    // as one receiver. If the local write above already failed, that receiver is
    // us failing again — not a delivery. Requiring a second subscriber is what
    // stops sendToAlias reporting success for a socket that is actually dead.
    const others = deliver ? receivers - 1 : receivers;
    return others > 0;
  } catch (err) {
    logger.warn({ err, alias }, "[router] publish failed");
    return false;
  }
}

/**
 * Tell every other replica to drop any socket it holds for `alias` that is not
 * `connId`.
 *
 * deviceTokensTable.userId is unique — one device per user — and within a
 * single process a second connection simply replaced the first in
 * connectedClients. Across replicas that no longer happens: two replicas can
 * each hold a live socket for the same alias with neither aware, so both would
 * receive presence and call signalling. This restores the single-socket
 * invariant explicitly.
 */
export async function kickOtherHolders(alias: string, connId: string): Promise<void> {
  const redis = isRedisHealthy() ? getRedis() : null;
  if (!redis) return;
  try {
    await redis.publish(KICK_CHANNEL, JSON.stringify({ alias, connId }));
  } catch (err) {
    logger.warn({ err, alias }, "[router] kick publish failed");
  }
}

/** Register the callback that closes a superseded local socket. */
export function onKick(handler: (alias: string, connId: string) => void): void {
  kickHandler = handler;
  wireSubscriber();
}

export const __testing = { localDelivery };
