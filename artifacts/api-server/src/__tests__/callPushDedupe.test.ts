/**
 * Task #172: a device with BOTH an Expo alert token and a native
 * (apns-voip / fcm) token for the same alias+platform must not ring twice.
 * The Expo alert push is suppressed when a configured native token covers
 * the same platform.
 */
import { describe, expect, it } from "vitest";
import { filterExpoRowsShadowedByNative, type DedupeTokenRow } from "../lib/callPushDedupe";

type Row = DedupeTokenRow & { token: string };

const row = (tokenType: string, platform: string, token = `${tokenType}-${platform}`): Row => ({
  tokenType,
  platform,
  token,
});

const allConfigured = () => true;
const noneConfigured = () => false;

const expoOf = (rows: Row[]) => rows.filter((r) => r.tokenType === "expo");

describe("filterExpoRowsShadowedByNative", () => {
  it("suppresses the expo token when a configured native token exists for the same platform", () => {
    const rows = [row("apns-voip", "ios"), row("expo", "ios")];
    const kept = filterExpoRowsShadowedByNative(rows, expoOf(rows), allConfigured);
    expect(kept).toHaveLength(0);
  });

  it("suppresses per-platform: fcm on android shadows only android expo tokens", () => {
    const rows = [row("fcm", "android"), row("expo", "android"), row("expo", "ios")];
    const kept = filterExpoRowsShadowedByNative(rows, expoOf(rows), allConfigured);
    expect(kept.map((r) => r.platform)).toEqual(["ios"]);
  });

  it("keeps the expo token when the native transport is unconfigured (expo is the only ring path)", () => {
    const rows = [row("apns-voip", "ios"), row("expo", "ios")];
    const kept = filterExpoRowsShadowedByNative(rows, expoOf(rows), noneConfigured);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.tokenType).toBe("expo");
  });

  it("respects per-transport configuration", () => {
    const rows = [
      row("apns-voip", "ios"),
      row("expo", "ios"),
      row("fcm", "android"),
      row("expo", "android"),
    ];
    // Only APNs configured: ios expo suppressed, android expo kept.
    const kept = filterExpoRowsShadowedByNative(rows, expoOf(rows), (t) => t === "apns-voip");
    expect(kept.map((r) => r.platform)).toEqual(["android"]);
  });

  it("keeps all expo tokens when no native tokens exist", () => {
    const rows = [row("expo", "ios"), row("expo", "android")];
    const kept = filterExpoRowsShadowedByNative(rows, expoOf(rows), allConfigured);
    expect(kept).toHaveLength(2);
  });

  it("returns nothing to send when there are only native tokens", () => {
    const rows = [row("apns-voip", "ios"), row("fcm", "android")];
    const kept = filterExpoRowsShadowedByNative(rows, expoOf(rows), allConfigured);
    expect(kept).toHaveLength(0);
  });

  it("multiple expo tokens on a shadowed platform are all suppressed", () => {
    const rows = [
      row("fcm", "android"),
      row("expo", "android", "e1"),
      row("expo", "android", "e2"),
    ];
    const kept = filterExpoRowsShadowedByNative(rows, expoOf(rows), allConfigured);
    expect(kept).toHaveLength(0);
  });
});
