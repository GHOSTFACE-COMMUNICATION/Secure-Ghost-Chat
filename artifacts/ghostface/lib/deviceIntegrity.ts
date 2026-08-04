import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import {
  prepareIntegrityTokenProviderAsync,
  requestIntegrityCheckAsync,
} from "@expo/app-integrity";
import { getApiBase } from "@/context/AppContext";

// The Play Console → App Integrity page shows this once a Cloud project is
// linked to the app. It's not a secret (it's baked into the client either
// way), just account-specific — set it in EAS env vars per environment.
const CLOUD_PROJECT_NUMBER = process.env.EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER;

let prepared = false;

async function ensurePrepared(): Promise<boolean> {
  if (prepared) return true;
  if (!CLOUD_PROJECT_NUMBER) {
    console.warn(
      "[deviceIntegrity] EXPO_PUBLIC_PLAY_CLOUD_PROJECT_NUMBER not set — skipping check",
    );
    return false;
  }
  try {
    await prepareIntegrityTokenProviderAsync(CLOUD_PROJECT_NUMBER);
    prepared = true;
    return true;
  } catch (e) {
    console.warn("[deviceIntegrity] provider prep failed:", e);
    return false;
  }
}

export interface IntegrityVerdict {
  verified: boolean;
  strong: boolean;
  reason?: string;
}

/**
 * Runs a Play Integrity check and has the server decode the verdict via
 * Google's Play Integrity API. Android only for now — iOS App Attest is a
 * separate flow this module also exposes but nothing here calls yet.
 *
 * Never throws: an unreachable server or unconfigured cloud project should
 * degrade to "couldn't verify," which callers treat as untrusted rather than
 * crashing the app over a security check that's ancillary to core function.
 */
export async function checkDeviceIntegrity(alias: string): Promise<IntegrityVerdict> {
  if (Platform.OS !== "android") {
    return { verified: true, strong: true, reason: "not-android" };
  }

  const ready = await ensurePrepared();
  if (!ready) return { verified: false, strong: false, reason: "not-configured" };

  try {
    // Binds the token to this alias + a one-minute time bucket so a captured
    // token can't be silently replayed against a later, unrelated check.
    // This is a stand-in for a server-issued nonce — see routes/integrity.ts
    // for the corresponding server-side note.
    const requestHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${alias}:${Math.floor(Date.now() / 60_000)}`,
    );
    const token = await requestIntegrityCheckAsync(requestHash);

    const apiBase = getApiBase();
    if (!apiBase) return { verified: false, strong: false, reason: "no-api-base" };

    const res = await fetch(`${apiBase}/integrity/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, alias }),
    });
    if (!res.ok) return { verified: false, strong: false, reason: `server-${res.status}` };

    const data = (await res.json()) as { verified?: boolean; strong?: boolean; reason?: string };
    return { verified: !!data.verified, strong: !!data.strong, reason: data.reason };
  } catch {
    return { verified: false, strong: false, reason: "check-failed" };
  }
}
