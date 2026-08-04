import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Credential-health tracking for the native call-push transports (task #166).
// Verifies the consecutive-error alarm, one-alert-per-run gating, recovery
// reset, and that THROWN send-path failures (bad .p8 key, malformed FCM
// service account) are counted exactly like returned "error" results.

vi.mock("../lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "../lib/logger";
import {
  ALERT_THRESHOLD,
  recordPushResult,
  getTransportHealth,
  getPushHealthReport,
  resetPushHealthForTests,
} from "../lib/pushCredentialHealth";
import { sendNativeCallPush } from "../lib/nativeCallPushSender";

const alertCalls = () =>
  (logger.error as ReturnType<typeof vi.fn>).mock.calls.filter(
    (c) => (c[0] as { event?: string })?.event === "credential-alert",
  );

beforeEach(() => {
  resetPushHealthForTests();
  vi.clearAllMocks();
});

describe("recordPushResult / alerting", () => {
  it("fires the alert exactly once after ALERT_THRESHOLD consecutive errors", () => {
    for (let i = 0; i < ALERT_THRESHOLD - 1; i++) recordPushResult("apns-voip", "error");
    expect(alertCalls()).toHaveLength(0);
    expect(getTransportHealth("apns-voip").status).toBe("degraded");

    recordPushResult("apns-voip", "error");
    expect(alertCalls()).toHaveLength(1);
    expect(getTransportHealth("apns-voip").status).toBe("alerting");

    // Further errors in the same run do not re-alert.
    recordPushResult("apns-voip", "error");
    recordPushResult("apns-voip", "error");
    expect(alertCalls()).toHaveLength(1);
    expect(getTransportHealth("apns-voip").consecutiveErrors).toBe(ALERT_THRESHOLD + 2);
  });

  it("an ok resets the run and re-arms the alert", () => {
    for (let i = 0; i < ALERT_THRESHOLD; i++) recordPushResult("fcm", "error");
    expect(alertCalls()).toHaveLength(1);

    recordPushResult("fcm", "ok");
    const h = getTransportHealth("fcm");
    expect(h.consecutiveErrors).toBe(0);
    expect(h.status).not.toBe("alerting");

    for (let i = 0; i < ALERT_THRESHOLD; i++) recordPushResult("fcm", "error");
    expect(alertCalls()).toHaveLength(2); // re-armed after recovery
  });

  it("bad-token counts as a successful transport round-trip (resets the run)", () => {
    for (let i = 0; i < ALERT_THRESHOLD - 1; i++) recordPushResult("apns-voip", "error");
    recordPushResult("apns-voip", "bad-token");
    recordPushResult("apns-voip", "error");
    expect(alertCalls()).toHaveLength(0);
    expect(getTransportHealth("apns-voip").consecutiveErrors).toBe(1);
  });

  it("unconfigured is ignored and transports are tracked independently", () => {
    recordPushResult("apns-voip", "unconfigured");
    for (let i = 0; i < ALERT_THRESHOLD; i++) recordPushResult("fcm", "error");
    const report = getPushHealthReport();
    const apns = report.transports.find((t) => t.transport === "apns-voip")!;
    const fcm = report.transports.find((t) => t.transport === "fcm")!;
    expect(apns.consecutiveErrors).toBe(0);
    expect(fcm.consecutiveErrors).toBe(ALERT_THRESHOLD);
    expect(report.alertThreshold).toBe(ALERT_THRESHOLD);
  });
});

describe("sendNativeCallPush thrown credential failures", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("counts a throwing APNs key (garbage .p8) as an error result", async () => {
    process.env.APNS_VOIP_KEY = "not-a-real-pem-key";
    process.env.APNS_KEY_ID = "KEYID12345";
    process.env.APNS_TEAM_ID = "TEAMID1234";
    const result = await sendNativeCallPush("apns-voip", "device-token", {
      callId: "c1",
      mode: "voice",
    });
    expect(result).toBe("error");
    expect(getTransportHealth("apns-voip").consecutiveErrors).toBe(1);
  });

  it("thrown APNs failures accumulate to the alert threshold", async () => {
    process.env.APNS_VOIP_KEY = "not-a-real-pem-key";
    process.env.APNS_KEY_ID = "KEYID12345";
    process.env.APNS_TEAM_ID = "TEAMID1234";
    for (let i = 0; i < ALERT_THRESHOLD; i++) {
      await sendNativeCallPush("apns-voip", "device-token", { callId: "c1", mode: "voice" });
    }
    expect(alertCalls()).toHaveLength(1);
    expect(getTransportHealth("apns-voip").status).toBe("alerting");
  });

  it("counts a throwing FCM key (garbage private_key) as an error result", async () => {
    process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
      client_email: "svc@example.iam.gserviceaccount.com",
      private_key: "garbage-not-a-key",
      project_id: "demo",
    });
    const result = await sendNativeCallPush("fcm", "device-token", {
      callId: "c1",
      mode: "voice",
    });
    expect(result).toBe("error");
    expect(getTransportHealth("fcm").consecutiveErrors).toBe(1);
  });
});
