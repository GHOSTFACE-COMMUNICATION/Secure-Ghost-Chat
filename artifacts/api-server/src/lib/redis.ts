import Redis from "ioredis";
import { logger } from "./logger";

/**
 * Shared-state backplane.
 *
 * Everything that currently lives in module-scope Maps in ws/manager.ts is
 * pinned to a single process — which is why the service runs at
 * numReplicas: 1. Redis is what lets that number go up.
 *
 * REDIS_URL unset is a supported mode, not an error: local dev and the test
 * suite run without it and fall back to per-process state. That fallback is
 * only correct at one replica — see isRedisEnabled() callers.
 */

let client: Redis | null = null;
let subscriber: Redis | null = null;
let initialised = false;
let healthy = false;

function build(url: string, role: string): Redis {
  const conn = new Redis(url, {
    // Fail a command rather than queueing it forever when the connection is
    // down. Callers fall back to their in-process path instead of hanging a
    // request behind a dead socket.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    // Cap the reconnect backoff so a long outage doesn't leave us waiting
    // minutes to notice recovery.
    retryStrategy: (times: number) => Math.min(times * 200, 5_000),
    lazyConnect: false,
  });

  conn.on("error", (err: Error) => {
    // ioredis emits on every failed reconnect; log at warn and let the
    // callers' fallbacks carry the load rather than crashing the process.
    healthy = false;
    logger.warn({ err: err.message, role }, "[redis] connection error");
  });
  conn.on("ready", () => {
    healthy = true;
    logger.info({ role }, "[redis] ready");
  });
  conn.on("close", () => {
    healthy = false;
  });

  return conn;
}

function init(): void {
  if (initialised) return;
  initialised = true;

  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    logger.warn(
      "[redis] REDIS_URL not set — using per-process state. This is only correct at a single replica.",
    );
    return;
  }

  client = build(url, "commands");
  // Redis puts a connection into subscriber mode exclusively: once subscribed
  // it cannot run ordinary commands, so pub/sub needs its own socket.
  subscriber = build(url, "subscriber");
}

/** Command client, or null when running without Redis. */
export function getRedis(): Redis | null {
  init();
  return client;
}

/** Dedicated subscriber connection, or null when running without Redis. */
export function getRedisSubscriber(): Redis | null {
  init();
  return subscriber;
}

/**
 * True only when Redis is configured AND the connection is currently up.
 * Callers use this to decide between shared and per-process state per
 * operation, so a mid-flight outage degrades rather than erroring.
 */
export function isRedisHealthy(): boolean {
  init();
  return client !== null && healthy;
}

/** True when Redis is configured at all, regardless of current health. */
export function isRedisEnabled(): boolean {
  init();
  return client !== null;
}
