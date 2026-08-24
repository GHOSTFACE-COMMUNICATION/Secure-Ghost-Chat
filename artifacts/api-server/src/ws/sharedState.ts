import { getRedis, isRedisHealthy } from "../lib/redis";
import { logger } from "../lib/logger";

/**
 * Cross-replica state for the WebSocket layer.
 *
 * Everything here used to be a module-scope Map in manager.ts, which is what
 * pinned the service to numReplicas: 1. Each function is Redis-backed when
 * REDIS_URL is set and healthy, and falls back to the original in-process Map
 * otherwise — so dev, tests, and a Redis outage keep working, correctly, at a
 * single replica.
 *
 * What deliberately does NOT live here: `connectedClients` (a socket handle
 * cannot be shared — step 3 routes to it via pub/sub instead) and
 * `deliveryIdToAlias` (a cache of an immutable DB row; each replica may hold
 * its own copy).
 */

export const GHOSTPAD_CODE_TTL_MS = 5 * 60_000;
export const PENDING_HANGUP_TTL_MS = 60_000;
export const MAX_CALL_AGE_MS = 2 * 60 * 60 * 1000;

// Presence is refreshed by the 30s protocol heartbeat. The TTL is 3x that so
// two missed refreshes are tolerated — at 1x, a slightly late heartbeat would
// flicker a live user offline and fire spurious presence events to every
// watcher. The cost of the slack is that a hard crash leaves a user showing
// online for up to this long, the same class of staleness as the readyState
// lag already documented in manager.ts.
export const PRESENCE_TTL_MS = 90_000;

// Pairings and subscriptions are torn down explicitly on disconnect; the TTL
// is only a backstop against a process dying mid-session and orphaning keys.
const PAIR_TTL_MS = 60 * 60 * 1000;
const SUBS_TTL_MS = 60 * 60 * 1000;

export interface ActiveCall {
  callId: string;
  caller: string;
  callee: string;
  startedAt: number;
}

export interface PendingHangup {
  from: string;
  callId?: string;
  queuedAt: number;
}

// ── In-process fallback ──────────────────────────────────────────────────────
const memGhostpadCodes = new Map<string, { alias: string; expiresAt: number }>();
const memGhostpadPartners = new Map<string, string>();
const memActiveCalls = new Map<string, ActiveCall>();
const memPendingHangups = new Map<string, PendingHangup[]>();
const memPresence = new Map<string, number>(); // alias -> expiresAt
const memSubs = new Map<string, Set<string>>(); // watcher -> targets
const memWatchers = new Map<string, Set<string>>(); // target -> watchers (reverse index)

function redis() {
  return isRedisHealthy() ? getRedis() : null;
}

function onErr(op: string, err: unknown): null {
  logger.warn({ err, op }, "[sharedstate] redis failed — falling back to in-process state");
  return null;
}

// ── Ghostpad codes ───────────────────────────────────────────────────────────
// Uniqueness must be claimed atomically. The original generateGhostpadCode()
// looped on `Map.has()`, which stops being a uniqueness check the moment two
// replicas can mint codes concurrently — and a duplicate 6-digit code would
// pair a joiner with the WRONG person, which in this app is a cross-user leak,
// not a glitch. `SET ... NX` does the check and the claim in one operation.

function randomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function claimGhostpadCode(alias: string): Promise<string | null> {
  const r = redis();
  if (r) {
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = randomCode();
        const ok = await r.set(`gp:code:${code}`, alias, "PX", GHOSTPAD_CODE_TTL_MS, "NX");
        if (ok === "OK") {
          // Reverse index so revoke doesn't have to scan the keyspace.
          await r.set(`gp:byalias:${alias}`, code, "PX", GHOSTPAD_CODE_TTL_MS);
          return code;
        }
      }
      logger.warn("[sharedstate] could not claim a free ghostpad code in 10 attempts");
      return null;
    } catch (err) {
      onErr("claimGhostpadCode", err);
    }
  }
  let code: string;
  do {
    code = randomCode();
  } while (memGhostpadCodes.has(code));
  memGhostpadCodes.set(code, { alias, expiresAt: Date.now() + GHOSTPAD_CODE_TTL_MS });
  return code;
}

/** Redeem a code: returns the creator's alias and consumes the code. */
export async function redeemGhostpadCode(code: string): Promise<string | null> {
  const r = redis();
  if (r) {
    try {
      // GETDEL so two joiners racing the same code cannot both redeem it.
      const alias = await r.getdel(`gp:code:${code}`);
      if (alias) await r.del(`gp:byalias:${alias}`);
      return alias;
    } catch (err) {
      onErr("redeemGhostpadCode", err);
    }
  }
  const entry = memGhostpadCodes.get(code);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  memGhostpadCodes.delete(code);
  return entry.alias;
}

/** Drop any pending (unredeemed) code this alias created. */
export async function revokeGhostpadCode(alias: string): Promise<void> {
  const r = redis();
  if (r) {
    try {
      const code = await r.getdel(`gp:byalias:${alias}`);
      if (code) await r.del(`gp:code:${code}`);
      return;
    } catch (err) {
      onErr("revokeGhostpadCode", err);
    }
  }
  for (const [code, entry] of memGhostpadCodes) {
    if (entry.alias === alias) memGhostpadCodes.delete(code);
  }
}

// ── Ghostpad pairing ─────────────────────────────────────────────────────────
export async function setGhostpadPair(a: string, b: string): Promise<void> {
  const r = redis();
  if (r) {
    try {
      await r.set(`gp:pair:${a}`, b, "PX", PAIR_TTL_MS);
      await r.set(`gp:pair:${b}`, a, "PX", PAIR_TTL_MS);
      return;
    } catch (err) {
      onErr("setGhostpadPair", err);
    }
  }
  memGhostpadPartners.set(a, b);
  memGhostpadPartners.set(b, a);
}

export async function getGhostpadPartner(alias: string): Promise<string | null> {
  const r = redis();
  if (r) {
    try {
      return await r.get(`gp:pair:${alias}`);
    } catch (err) {
      onErr("getGhostpadPartner", err);
    }
  }
  return memGhostpadPartners.get(alias) ?? null;
}

/** Clear the pairing both ways; returns the partner that was cleared. */
export async function clearGhostpadPair(alias: string): Promise<string | null> {
  const r = redis();
  if (r) {
    try {
      const partner = await r.getdel(`gp:pair:${alias}`);
      if (partner) await r.del(`gp:pair:${partner}`);
      return partner;
    } catch (err) {
      onErr("clearGhostpadPair", err);
    }
  }
  const partner = memGhostpadPartners.get(alias) ?? null;
  if (partner) {
    memGhostpadPartners.delete(alias);
    memGhostpadPartners.delete(partner);
  }
  return partner;
}

// ── Active calls ─────────────────────────────────────────────────────────────
export async function getActiveCall(pairKey: string): Promise<ActiveCall | null> {
  const r = redis();
  if (r) {
    try {
      const raw = await r.get(`call:${pairKey}`);
      return raw ? (JSON.parse(raw) as ActiveCall) : null;
    } catch (err) {
      onErr("getActiveCall", err);
    }
  }
  return memActiveCalls.get(pairKey) ?? null;
}

export async function setActiveCall(pairKey: string, call: ActiveCall): Promise<void> {
  const r = redis();
  if (r) {
    try {
      await r.set(`call:${pairKey}`, JSON.stringify(call), "PX", MAX_CALL_AGE_MS);
      // Reverse index, so a dropped socket can release its pair lock without
      // scanning the keyspace — cleanup() used to iterate the whole Map.
      await r.set(`call:alias:${call.caller}`, pairKey, "PX", MAX_CALL_AGE_MS);
      await r.set(`call:alias:${call.callee}`, pairKey, "PX", MAX_CALL_AGE_MS);
      return;
    } catch (err) {
      onErr("setActiveCall", err);
    }
  }
  memActiveCalls.set(pairKey, call);
}

// Compare-and-delete in one atomic step. A GET-then-DEL from two replicas
// could delete a call that a concurrent call-ring had already replaced.
const CLEAR_CALL_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
if ARGV[1] == '' then redis.call('DEL', KEYS[1]); return 1 end
local ok = string.find(raw, ARGV[1], 1, true)
if ok then redis.call('DEL', KEYS[1]); return 1 end
return 0`;

export async function clearActiveCall(pairKey: string, callId?: string): Promise<void> {
  const r = redis();
  if (r) {
    try {
      const existing = await r.get(`call:${pairKey}`);
      const removed = await r.eval(CLEAR_CALL_LUA, 1, `call:${pairKey}`, callId ? `"${callId}"` : "");
      if (removed === 1 && existing) {
        const call = JSON.parse(existing) as ActiveCall;
        await r.del(`call:alias:${call.caller}`, `call:alias:${call.callee}`);
      }
      return;
    } catch (err) {
      onErr("clearActiveCall", err);
    }
  }
  const existing = memActiveCalls.get(pairKey);
  if (existing && (!callId || existing.callId === callId)) memActiveCalls.delete(pairKey);
}

/**
 * Release any call this alias is party to. Called when a socket drops
 * mid-call: without it the pair lock survives and neither party can call the
 * other again until MAX_CALL_AGE_MS ages the entry out.
 */
export async function clearCallsForAlias(alias: string): Promise<void> {
  const r = redis();
  if (r) {
    try {
      const pairKey = await r.getdel(`call:alias:${alias}`);
      if (!pairKey) return;
      const raw = await r.get(`call:${pairKey}`);
      await r.del(`call:${pairKey}`);
      if (raw) {
        const call = JSON.parse(raw) as ActiveCall;
        const other = call.caller === alias ? call.callee : call.caller;
        await r.del(`call:alias:${other}`);
      }
      return;
    } catch (err) {
      onErr("clearCallsForAlias", err);
    }
  }
  for (const [pairKey, call] of memActiveCalls) {
    if (call.caller === alias || call.callee === alias) memActiveCalls.delete(pairKey);
  }
}

// ── Deferred hangups ─────────────────────────────────────────────────────────
export async function queueCallHangup(
  toAlias: string,
  from: string,
  callId?: string,
): Promise<void> {
  const entry: PendingHangup = { from, callId, queuedAt: Date.now() };
  const r = redis();
  if (r) {
    try {
      const key = `hangup:${toAlias}`;
      const existing = await r.lrange(key, 0, -1);
      // One pending hangup per callId is enough; duplicates add nothing.
      if (existing.some((raw) => (JSON.parse(raw) as PendingHangup).callId === callId)) return;
      await r.rpush(key, JSON.stringify(entry));
      await r.pexpire(key, PENDING_HANGUP_TTL_MS);
      return;
    } catch (err) {
      onErr("queueCallHangup", err);
    }
  }
  const now = Date.now();
  const list = (memPendingHangups.get(toAlias) ?? []).filter(
    (h) => now - h.queuedAt < PENDING_HANGUP_TTL_MS,
  );
  if (!list.some((h) => h.callId === callId)) list.push(entry);
  memPendingHangups.set(toAlias, list);
}

/** Read and consume every non-expired queued hangup for this alias. */
export async function takePendingCallHangups(alias: string): Promise<PendingHangup[]> {
  const r = redis();
  if (r) {
    try {
      const key = `hangup:${alias}`;
      const raw = await r.lrange(key, 0, -1);
      if (raw.length) await r.del(key);
      const now = Date.now();
      return raw
        .map((s) => JSON.parse(s) as PendingHangup)
        .filter((h) => now - h.queuedAt < PENDING_HANGUP_TTL_MS);
    } catch (err) {
      onErr("takePendingCallHangups", err);
    }
  }
  const list = memPendingHangups.get(alias);
  if (!list?.length) return [];
  memPendingHangups.delete(alias);
  const now = Date.now();
  return list.filter((h) => now - h.queuedAt < PENDING_HANGUP_TTL_MS);
}

// ── Presence ─────────────────────────────────────────────────────────────────
export async function setPresence(alias: string): Promise<void> {
  const r = redis();
  if (r) {
    try {
      await r.set(`presence:${alias}`, "1", "PX", PRESENCE_TTL_MS);
      return;
    } catch (err) {
      onErr("setPresence", err);
    }
  }
  memPresence.set(alias, Date.now() + PRESENCE_TTL_MS);
}

export async function clearPresence(alias: string): Promise<void> {
  const r = redis();
  if (r) {
    try {
      await r.del(`presence:${alias}`);
      return;
    } catch (err) {
      onErr("clearPresence", err);
    }
  }
  memPresence.delete(alias);
}

export async function isOnline(alias: string): Promise<boolean> {
  const r = redis();
  if (r) {
    try {
      return (await r.exists(`presence:${alias}`)) === 1;
    } catch (err) {
      onErr("isOnline", err);
    }
  }
  const until = memPresence.get(alias);
  return !!until && until > Date.now();
}

// ── Presence subscriptions ───────────────────────────────────────────────────
// NOTE ON METADATA-BLINDNESS. These sets are the closest thing this system has
// to a social graph, and manager.ts's design note is explicit that the server
// is never supposed to learn who talks to whom — which is why subscriptions
// were in-memory and died with the socket.
//
// Making presence work across replicas requires the other side of the mutual
// check, which by definition lives on another process. The deliberate
// compromise (approved 24 Aug) is: keep them in Redis, keyed per alias, with a
// TTL, refreshed only while the socket is live and DELETED on disconnect — so
// the graph exists only for the span of an open connection and never lands in
// Postgres, which remains free of any relationship table. It is a real
// softening of the posture, not a neutral move, and it is recorded as such.

export async function addSubscription(watcher: string, target: string): Promise<void> {
  const r = redis();
  if (r) {
    try {
      // Both directions: `subs` answers "who does X watch" (the mutual check),
      // `watchers` answers "who watches X" (the presence fan-out). Without the
      // reverse index, notifying watchers would mean scanning the keyspace.
      await r.sadd(`subs:${watcher}`, target);
      await r.pexpire(`subs:${watcher}`, SUBS_TTL_MS);
      await r.sadd(`watchers:${target}`, watcher);
      await r.pexpire(`watchers:${target}`, SUBS_TTL_MS);
      return;
    } catch (err) {
      onErr("addSubscription", err);
    }
  }
  let set = memSubs.get(watcher);
  if (!set) memSubs.set(watcher, (set = new Set()));
  set.add(target);
  let rev = memWatchers.get(target);
  if (!rev) memWatchers.set(target, (rev = new Set()));
  rev.add(watcher);
}

/** Aliases currently watching `target` — the presence fan-out list. */
export async function getWatchers(target: string): Promise<string[]> {
  const r = redis();
  if (r) {
    try {
      return await r.smembers(`watchers:${target}`);
    } catch (err) {
      onErr("getWatchers", err);
    }
  }
  return [...(memWatchers.get(target) ?? [])];
}

export async function removeSubscription(watcher: string, target: string): Promise<void> {
  const r = redis();
  if (r) {
    try {
      await r.srem(`subs:${watcher}`, target);
      await r.srem(`watchers:${target}`, watcher);
      return;
    } catch (err) {
      onErr("removeSubscription", err);
    }
  }
  memSubs.get(watcher)?.delete(target);
  memWatchers.get(target)?.delete(watcher);
}

/** Tear down every subscription this alias holds — called on disconnect. */
export async function clearSubscriptions(watcher: string): Promise<void> {
  const r = redis();
  if (r) {
    try {
      // Read the targets first — the reverse index has to be pruned too, or a
      // disconnected watcher lingers in every target's fan-out list until the
      // TTL expires and presence events get sent to a socket that is gone.
      const targets = await r.smembers(`subs:${watcher}`);
      const pipe = r.pipeline();
      for (const t of targets) pipe.srem(`watchers:${t}`, watcher);
      pipe.del(`subs:${watcher}`);
      await pipe.exec();
      return;
    } catch (err) {
      onErr("clearSubscriptions", err);
    }
  }
  for (const t of memSubs.get(watcher) ?? []) memWatchers.get(t)?.delete(watcher);
  memSubs.delete(watcher);
}

export async function subscriptionCount(watcher: string): Promise<number> {
  const r = redis();
  if (r) {
    try {
      return await r.scard(`subs:${watcher}`);
    } catch (err) {
      onErr("subscriptionCount", err);
    }
  }
  return memSubs.get(watcher)?.size ?? 0;
}

export async function subscribesTo(watcher: string, target: string): Promise<boolean> {
  const r = redis();
  if (r) {
    try {
      return (await r.sismember(`subs:${watcher}`, target)) === 1;
    } catch (err) {
      onErr("subscribesTo", err);
    }
  }
  return !!memSubs.get(watcher)?.has(target);
}

/** True only when each alias has subscribed to the other — see the note above. */
export async function mutuallySubscribed(a: string, b: string): Promise<boolean> {
  const [ab, ba] = await Promise.all([subscribesTo(a, b), subscribesTo(b, a)]);
  return ab && ba;
}

export const __testing = { memGhostpadCodes, memPresence, memSubs, memWatchers };
