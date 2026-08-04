/**
 * Push credential health tracking (task #166).
 *
 * APNs auth-key JWTs expire/rotate and FCM service-account keys can be
 * revoked. When that happens, sendNativeCallPush starts returning "error"
 * silently and incoming calls ring on nothing. This module keeps a rolling,
 * per-transport tally of "error" responses (credential/transport failures —
 * NOT "bad-token", which just means one device's token is dead) so a broken
 * credential becomes observable:
 *
 * - Every send result is recorded per transport ("apns-voip" | "fcm").
 * - A run of consecutive errors ≥ ALERT_THRESHOLD emits a structured
 *   ERROR-level alert log ([pushHealth] event: "credential-alert") once per
 *   run — a success resets the run and re-arms the alert.
 * - GET /api/admin/push-health reports live status for both transports.
 */
import { logger } from "./logger";
import type { NativeTokenType } from "./nativeCallPushSender";

/**
 * Reports whether a transport's credentials are configured. Injected (set at
 * module wire-up in nativeCallPushSender.ts) rather than imported to avoid a
 * runtime import cycle between the two modules.
 */
let configuredCheck: (transport: NativeTokenType) => boolean = () => false;
export function setConfiguredCheck(fn: (transport: NativeTokenType) => boolean): void {
  configuredCheck = fn;
}

/** Consecutive "error" results on one transport that trigger the alert. */
export const ALERT_THRESHOLD = 5;

/** Rolling window for the recent error-rate counters. */
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

type TransportStats = {
  /** Current run of consecutive "error" results (reset by any "ok"). */
  consecutiveErrors: number;
  /** Whether the alert has fired for the current error run. */
  alerted: boolean;
  /** Timestamps (ms) of "error" results inside the rolling window. */
  errorTimestamps: number[];
  /** Timestamps (ms) of "ok" results inside the rolling window. */
  okTimestamps: number[];
  lastOkAt: number | null;
  lastErrorAt: number | null;
  totalOk: number;
  totalErrors: number;
  totalBadTokens: number;
};

function emptyStats(): TransportStats {
  return {
    consecutiveErrors: 0,
    alerted: false,
    errorTimestamps: [],
    okTimestamps: [],
    lastOkAt: null,
    lastErrorAt: null,
    totalOk: 0,
    totalErrors: 0,
    totalBadTokens: 0,
  };
}

const stats: Record<NativeTokenType, TransportStats> = {
  "apns-voip": emptyStats(),
  fcm: emptyStats(),
};

function prune(list: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS;
  while (list.length > 0 && list[0] < cutoff) list.shift();
  return list;
}

/**
 * Records one send result for `transport`. Call for every native call push
 * attempt. "bad-token" counts as a *successful* transport round-trip (the
 * credentials worked; the device token is dead) so it resets the error run.
 * "unconfigured" is ignored — missing credentials are already logged.
 */
export function recordPushResult(
  transport: NativeTokenType,
  result: "ok" | "bad-token" | "error" | "unconfigured",
): void {
  if (result === "unconfigured") return;
  const s = stats[transport];
  const now = Date.now();
  if (result === "error") {
    s.totalErrors += 1;
    s.lastErrorAt = now;
    s.errorTimestamps.push(now);
    prune(s.errorTimestamps, now);
    s.consecutiveErrors += 1;
    if (s.consecutiveErrors >= ALERT_THRESHOLD && !s.alerted) {
      s.alerted = true;
      // Structured admin alert: a broken cert/key must not silently kill
      // ringing. Grep target: [pushHealth] credential-alert.
      logger.error(
        {
          event: "credential-alert",
          transport,
          consecutiveErrors: s.consecutiveErrors,
          errorsLast15m: s.errorTimestamps.length,
          lastOkAt: s.lastOkAt ? new Date(s.lastOkAt).toISOString() : null,
        },
        "[pushHealth] Push credential errors spiking — APNs/FCM credentials may be expired or revoked; native call ringing is likely broken",
      );
    }
    return;
  }
  // "ok" and "bad-token" both prove the credentials are accepted.
  if (result === "bad-token") s.totalBadTokens += 1;
  else s.totalOk += 1;
  s.lastOkAt = now;
  s.okTimestamps.push(now);
  prune(s.okTimestamps, now);
  if (s.consecutiveErrors > 0 || s.alerted) {
    if (s.alerted) {
      logger.info(
        { event: "credential-recovered", transport },
        "[pushHealth] Push transport recovered after credential error spike",
      );
    }
    s.consecutiveErrors = 0;
    s.alerted = false;
  }
}

export type TransportHealth = {
  transport: NativeTokenType;
  configured: boolean;
  status: "unconfigured" | "healthy" | "degraded" | "alerting";
  consecutiveErrors: number;
  errorsLast15m: number;
  successesLast15m: number;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  totals: { ok: number; errors: number; badTokens: number };
};

/** Live health snapshot for one transport (for /api/admin/push-health). */
export function getTransportHealth(transport: NativeTokenType): TransportHealth {
  const s = stats[transport];
  const now = Date.now();
  prune(s.errorTimestamps, now);
  prune(s.okTimestamps, now);
  const configured = configuredCheck(transport);
  let status: TransportHealth["status"];
  if (!configured) status = "unconfigured";
  else if (s.alerted) status = "alerting";
  else if (s.consecutiveErrors > 0) status = "degraded";
  else status = "healthy";
  return {
    transport,
    configured,
    status,
    consecutiveErrors: s.consecutiveErrors,
    errorsLast15m: s.errorTimestamps.length,
    successesLast15m: s.okTimestamps.length,
    lastOkAt: s.lastOkAt ? new Date(s.lastOkAt).toISOString() : null,
    lastErrorAt: s.lastErrorAt ? new Date(s.lastErrorAt).toISOString() : null,
    totals: { ok: s.totalOk, errors: s.totalErrors, badTokens: s.totalBadTokens },
  };
}

export function getPushHealthReport(): {
  alertThreshold: number;
  windowMinutes: number;
  transports: TransportHealth[];
} {
  return {
    alertThreshold: ALERT_THRESHOLD,
    windowMinutes: WINDOW_MS / 60_000,
    transports: [getTransportHealth("apns-voip"), getTransportHealth("fcm")],
  };
}

/** Test-only: reset all counters. */
export function resetPushHealthForTests(): void {
  stats["apns-voip"] = emptyStats();
  stats.fcm = emptyStats();
}
