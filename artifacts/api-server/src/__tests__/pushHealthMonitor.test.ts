import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Push-credential health monitor (task #183). Verifies the periodic poller
// authenticates via Authorization: Bearer, fires a webhook alert exactly once
// per alerting episode, retries failed deliveries, and sends a recovery
// notification when the transport heals.

vi.mock("../lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { checkPushHealthOnce, resetPushHealthMonitorForTests } from "../lib/pushHealthMonitor";

const WEBHOOK = "https://hooks.example.com/alert";
const HEALTH_URL = "http://127.0.0.1:9999/api/admin/push-health";

type FetchMock = ReturnType<typeof vi.fn>;

function transport(name: string, status: string, configured = true) {
  return {
    transport: name,
    configured,
    status,
    consecutiveErrors: status === "alerting" ? 7 : 0,
    errorsLast15m: status === "alerting" ? 7 : 0,
    successesLast15m: 0,
    lastOkAt: null,
    lastErrorAt: null,
    totals: { ok: 0, errors: 0, badTokens: 0 },
  };
}

function mockFetch(transports: unknown[], opts: { webhookStatus?: number } = {}): FetchMock {
  const fn = vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u === HEALTH_URL) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ transports }),
      };
    }
    return {
      ok: (opts.webhookStatus ?? 200) < 400,
      status: opts.webhookStatus ?? 200,
      json: async () => ({}),
    };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const webhookCalls = (fn: FetchMock) => fn.mock.calls.filter((c) => String(c[0]) === WEBHOOK);

const savedEnv = { ...process.env };

beforeEach(() => {
  resetPushHealthMonitorForTests();
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.PUSH_HEALTH_URL = HEALTH_URL;
  process.env.PUSH_HEALTH_ALERT_WEBHOOK_URL = WEBHOOK;
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("checkPushHealthOnce", () => {
  it("polls the health endpoint with Authorization: Bearer (no secret in URL)", async () => {
    const fn = mockFetch([transport("apns-voip", "healthy")]);
    await checkPushHealthOnce();
    const healthCall = fn.mock.calls.find((c) => String(c[0]) === HEALTH_URL)!;
    expect(healthCall).toBeDefined();
    expect(String(healthCall[0])).not.toContain("test-admin-secret");
    const headers = (healthCall[1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe("Bearer test-admin-secret");
    expect(webhookCalls(fn)).toHaveLength(0);
  });

  it("fires the webhook once per alerting episode, then recovery on heal", async () => {
    let fn = mockFetch([transport("apns-voip", "alerting")]);
    await checkPushHealthOnce();
    expect(webhookCalls(fn)).toHaveLength(1);
    const body = JSON.parse((webhookCalls(fn)[0][1] as { body: string }).body);
    expect(body.event).toBe("push-credential-alert");
    expect(body.transport).toBe("apns-voip");
    expect(typeof body.text).toBe("string");

    // Still alerting next tick → no duplicate alert.
    fn = mockFetch([transport("apns-voip", "alerting")]);
    await checkPushHealthOnce();
    expect(webhookCalls(fn)).toHaveLength(0);

    // Recovered → recovery notification, alert re-armed.
    fn = mockFetch([transport("apns-voip", "healthy")]);
    await checkPushHealthOnce();
    expect(webhookCalls(fn)).toHaveLength(1);
    expect(JSON.parse((webhookCalls(fn)[0][1] as { body: string }).body).event).toBe(
      "push-credential-recovered",
    );

    // Alerting again → new episode alerts again.
    fn = mockFetch([transport("apns-voip", "alerting")]);
    await checkPushHealthOnce();
    expect(webhookCalls(fn)).toHaveLength(1);
  });

  it("retries alert delivery next tick when the webhook fails", async () => {
    let fn = mockFetch([transport("fcm", "alerting")], { webhookStatus: 500 });
    await checkPushHealthOnce();
    expect(webhookCalls(fn)).toHaveLength(1); // attempted, failed

    fn = mockFetch([transport("fcm", "alerting")]);
    await checkPushHealthOnce();
    expect(webhookCalls(fn)).toHaveLength(1); // retried and delivered

    fn = mockFetch([transport("fcm", "alerting")]);
    await checkPushHealthOnce();
    expect(webhookCalls(fn)).toHaveLength(0); // now gated
  });

  it("ignores unconfigured transports and tracks transports independently", async () => {
    const fn = mockFetch([
      transport("apns-voip", "alerting", false), // unconfigured — ignore
      transport("fcm", "alerting"),
    ]);
    await checkPushHealthOnce();
    const calls = webhookCalls(fn);
    expect(calls).toHaveLength(1);
    expect(JSON.parse((calls[0][1] as { body: string }).body).transport).toBe("fcm");
  });

  it("survives a health-poll failure without alert state changes", async () => {
    const fn = vi.fn(async () => {
      throw new Error("connection refused");
    });
    vi.stubGlobal("fetch", fn);
    await expect(checkPushHealthOnce()).resolves.toBeUndefined();

    // Next successful poll with alerting still alerts (state untouched).
    const fn2 = mockFetch([transport("apns-voip", "alerting")]);
    await checkPushHealthOnce();
    expect(webhookCalls(fn2)).toHaveLength(1);
  });

  it("does nothing when ADMIN_SECRET is unset", async () => {
    delete process.env.ADMIN_SECRET;
    const fn = mockFetch([transport("apns-voip", "alerting")]);
    await checkPushHealthOnce();
    expect(fn).not.toHaveBeenCalled();
  });
});
