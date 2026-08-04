/**
 * Push-credential health monitor (task #183).
 *
 * /api/admin/push-health reports APNs/FCM credential health, but until now a
 * human had to poll it. This module runs a periodic in-process health-check
 * job that polls the endpoint over HTTP (exactly like an external monitor
 * would, using the `Authorization: Bearer <ADMIN_SECRET>` auth path — no
 * secrets in URLs) and pushes an alert to a configurable webhook whenever any
 * configured transport enters "alerting" status.
 *
 * Configuration (env):
 * - PUSH_HEALTH_ALERT_WEBHOOK_URL  — destination webhook. Slack-compatible:
 *   the POST body always contains a `text` field, plus the structured report
 *   for generic webhook consumers. Monitor is disabled when unset.
 * - PUSH_HEALTH_CHECK_INTERVAL_MS  — poll interval (default 5 minutes).
 * - PUSH_HEALTH_URL                — endpoint to poll (default
 *   http://127.0.0.1:$PORT/api/admin/push-health, i.e. this server).
 *
 * Alert gating: one webhook alert per alerting episode per transport — a
 * transport that stays "alerting" across ticks does not re-alert; when it
 * leaves "alerting" a recovery notification is sent and the alert re-arms.
 */
import { logger } from "./logger";
import type { TransportHealth } from "./pushCredentialHealth";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Transports we have already alerted on (current alerting episode). */
const alertedTransports = new Set<string>();

type HealthReport = {
  transports?: TransportHealth[];
};

function healthUrl(): string {
  const explicit = process.env.PUSH_HEALTH_URL;
  if (explicit) return explicit;
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}/api/admin/push-health`;
}

function webhookUrl(): string | undefined {
  return process.env.PUSH_HEALTH_ALERT_WEBHOOK_URL || undefined;
}

function intervalMs(): number {
  const raw = Number(process.env.PUSH_HEALTH_CHECK_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MS;
}

async function sendWebhook(text: string, payload: Record<string, unknown>): Promise<void> {
  const url = webhookUrl();
  if (!url) return;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...payload }),
  });
  if (!res.ok) {
    throw new Error(`webhook responded ${res.status}`);
  }
}

/**
 * One monitor tick: poll the health endpoint (Bearer auth), diff the set of
 * alerting transports against the previous tick, and fire/recover webhooks.
 * Exported for tests.
 */
export async function checkPushHealthOnce(): Promise<void> {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return; // endpoint is disabled without it

  let report: HealthReport;
  let httpStatus: number;
  try {
    const res = await fetch(healthUrl(), {
      headers: { Authorization: `Bearer ${adminSecret}` },
    });
    httpStatus = res.status;
    report = (await res.json()) as HealthReport;
  } catch (err) {
    logger.warn({ err }, "[pushHealthMonitor] Health poll failed — will retry next tick");
    return;
  }

  const transports = Array.isArray(report.transports) ? report.transports : [];
  const alertingNow = transports.filter((t) => t.configured && t.status === "alerting");
  const alertingNames = new Set<string>(alertingNow.map((t) => t.transport));

  // Newly-alerting transports → send the alert (once per episode).
  for (const t of alertingNow) {
    if (alertedTransports.has(t.transport)) continue;
    alertedTransports.add(t.transport);
    const text =
      `🚨 GHOSTFACE push credentials broken: ${t.transport} is ALERTING ` +
      `(${t.consecutiveErrors} consecutive errors, ${t.errorsLast15m} errors in 15m, ` +
      `last OK: ${t.lastOkAt ?? "never"}). Incoming calls are likely not ringing.`;
    try {
      await sendWebhook(text, {
        event: "push-credential-alert",
        transport: t.transport,
        health: t,
      });
      logger.error(
        { event: "monitor-alert-sent", transport: t.transport, httpStatus },
        "[pushHealthMonitor] Credential alert delivered to webhook",
      );
    } catch (err) {
      // Re-arm so the next tick retries delivery.
      alertedTransports.delete(t.transport);
      logger.error(
        { err, transport: t.transport },
        "[pushHealthMonitor] Failed to deliver credential alert webhook — will retry next tick",
      );
    }
  }

  // Recovered transports → send recovery, re-arm.
  for (const name of [...alertedTransports]) {
    if (alertingNames.has(name)) continue;
    alertedTransports.delete(name);
    const text = `✅ GHOSTFACE push transport recovered: ${name} is no longer alerting.`;
    try {
      await sendWebhook(text, { event: "push-credential-recovered", transport: name });
      logger.info(
        { event: "monitor-recovery-sent", transport: name },
        "[pushHealthMonitor] Recovery notification delivered to webhook",
      );
    } catch (err) {
      // Don't re-add: transport is healthy; missing a recovery ping is benign.
      logger.warn(
        { err, transport: name },
        "[pushHealthMonitor] Failed to deliver recovery webhook",
      );
    }
  }
}

/** Starts the periodic monitor. No-op when no webhook destination is set. */
export function startPushHealthMonitor(): void {
  if (timer) return;
  if (!webhookUrl()) {
    logger.info(
      "[pushHealthMonitor] Disabled — set PUSH_HEALTH_ALERT_WEBHOOK_URL to enable automatic push-credential alerts",
    );
    return;
  }
  if (!process.env.ADMIN_SECRET) {
    logger.warn(
      "[pushHealthMonitor] Disabled — ADMIN_SECRET not set, cannot poll /api/admin/push-health",
    );
    return;
  }
  const interval = intervalMs();
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void checkPushHealthOnce().finally(() => {
      running = false;
    });
  }, interval);
  timer.unref?.();
  logger.info({ intervalMs: interval, url: healthUrl() }, "[pushHealthMonitor] Started");
}

/** Test-only: stop the timer and reset episode state. */
export function resetPushHealthMonitorForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
  alertedTransports.clear();
}
