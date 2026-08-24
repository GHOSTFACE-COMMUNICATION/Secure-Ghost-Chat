import { getRedis, isRedisHealthy } from "./redis";
import { logger } from "./logger";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  /** Redis key namespace. Must be stable and unique across limiters. */
  prefix: string;
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private windowMs: number;
  private max: number;
  private prefix: string;

  constructor({ windowMs, max, prefix }: RateLimiterOptions) {
    this.windowMs = windowMs;
    this.max = max;
    // Namespaces the Redis key. Two limiters with different windows must not
    // share a bucket, and the same limiter must resolve to the same key on
    // every replica — so this is passed in explicitly rather than derived.
    this.prefix = prefix;

    // Periodically prune expired entries to prevent unbounded memory growth.
    // Only used by the in-memory path; Redis expires its own keys.
    setInterval(() => this.prune(), windowMs * 2);
  }

  private redisKey(key: string): string {
    return `rl:${this.prefix}:${key}`;
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  async check(key: string): Promise<boolean> {
    const redis = isRedisHealthy() ? getRedis() : null;
    if (redis) {
      try {
        // Fixed window, incremented and expired in one round trip. INCR is
        // atomic, so concurrent replicas cannot both read an under-limit count
        // and both admit the request — which a GET-then-SET would allow.
        const k = this.redisKey(key);
        const count = await redis.incr(k);
        if (count === 1) await redis.pexpire(k, this.windowMs);
        return count <= this.max;
      } catch (err) {
        logger.warn({ err, prefix: this.prefix }, "[ratelimit] redis failed — using local bucket");
      }
    }
    if (!this.allowedLocal(key)) return false;
    this.recordLocal(key);
    return true;
  }

  /**
   * Peek without consuming budget. Split out from `check` so a caller can gate
   * on prior failures *before* doing expensive work, and only charge the key
   * once it knows the request was actually abusive — see the authFailureGate
   * use in the authenticated routes.
   */
  async allowed(key: string): Promise<boolean> {
    const redis = isRedisHealthy() ? getRedis() : null;
    if (redis) {
      try {
        const raw = await redis.get(this.redisKey(key));
        return raw === null || Number(raw) < this.max;
      } catch (err) {
        logger.warn({ err, prefix: this.prefix }, "[ratelimit] redis failed — using local bucket");
      }
    }
    return this.allowedLocal(key);
  }

  /** Consume one unit of budget for `key`. */
  async record(key: string): Promise<void> {
    const redis = isRedisHealthy() ? getRedis() : null;
    if (redis) {
      try {
        const k = this.redisKey(key);
        const count = await redis.incr(k);
        if (count === 1) await redis.pexpire(k, this.windowMs);
        return;
      } catch (err) {
        logger.warn({ err, prefix: this.prefix }, "[ratelimit] redis failed — using local bucket");
      }
    }
    this.recordLocal(key);
  }

  // ── Per-process fallback ───────────────────────────────────────────────────
  // Used when REDIS_URL is unset (dev, tests) or Redis is mid-outage. Falling
  // back to a local bucket rather than failing open matters for the scarce
  // limiters — provisionLimiter spends real money — so a Redis outage makes
  // limits per-replica, never absent.

  private allowedLocal(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.resetAt) return true;
    return entry.count < this.max;
  }

  private recordLocal(key: string): void {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || now > entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    entry.count += 1;
  }

  private prune() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetAt) this.store.delete(key);
    }
  }
}

/**
 * A single shared bucket, independent of who is calling.
 *
 * Per-IP limits cannot discriminate under carrier NAT — thousands of real
 * subscribers share one address, so any ceiling low enough to constrain an
 * attacker also breaks legitimate users. For unauthenticated endpoints that
 * consume a real resource (disk, Twilio spend) there is no per-user key to
 * fall back on, so the resource itself gets the cap instead. This bounds the
 * blast radius; it does not identify the abuser.
 */
export class GlobalLimiter {
  private limiter: RateLimiter;
  private static readonly KEY = "__global__";

  constructor(opts: RateLimiterOptions) {
    this.limiter = new RateLimiter(opts);
  }

  check(): Promise<boolean> {
    return this.limiter.check(GlobalLimiter.KEY);
  }
}

/**
 * Stable per-request IP key.
 *
 * Reads `req.ip`, which Express derives from X-Forwarded-For according to the
 * `trust proxy` setting configured in app.ts — it walks the header from the
 * right, skipping trusted hops, so a client-supplied prefix cannot win. That
 * replaces the previous hand-parse of `x-forwarded-for.split(",")[0]`, which
 * took the LEFTMOST value: client-controlled by construction.
 *
 * Verified 24 Aug that the old form was not exploitable as deployed — Railway's
 * edge overwrites the header rather than appending, so a forged value never
 * reached the app (burned the budget from one IP, reissued with a forged
 * X-Forwarded-For, still got 429). This is defence in depth for the case where
 * that stops being true: a direct exposure, or a proxy that appends.
 */
export function getIpKey(req: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  if (req.ip) return req.ip;
  // Fallback for callers that are not Express requests (and for a misconfigured
  // trust proxy). Take the RIGHTMOST entry: the hop nearest us, which the
  // closest proxy appended, rather than anything further left that a client
  // could have supplied.
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const raw = Array.isArray(forwarded) ? forwarded[forwarded.length - 1] : forwarded;
    const parts = raw.split(",");
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
  }
  return "unknown";
}
