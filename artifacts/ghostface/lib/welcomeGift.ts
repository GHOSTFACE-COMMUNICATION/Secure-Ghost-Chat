/**
 * Welcome gift — a free month of SPECTER, granted once per identity at the
 * end of sign-up.
 *
 * The server decides and grants; this only reports what came back. The coin
 * tap in onboarding is presentation — it happens before an identity exists,
 * so it cannot be authoritative about what is actually given.
 */

import { getApiBase } from "@/lib/apiBase";
import { getDeviceAuth } from "@/lib/deviceAuth";

export type WelcomeGiftResult =
  | { ok: true; plan: string; alreadyClaimed: boolean }
  | { ok: false };

/**
 * Claim the welcome gift. Idempotent server-side — calling twice grants once
 * and reports `alreadyClaimed` the second time.
 *
 * Never throws: a promotional grant must not be able to break sign-up, so
 * every failure collapses to `{ ok: false }` and the caller carries on.
 */
export async function claimWelcomeGift(): Promise<WelcomeGiftResult> {
  const apiBase = getApiBase();
  if (!apiBase) return { ok: false };

  const auth = await getDeviceAuth();
  if (!auth) return { ok: false };

  try {
    const res = await fetch(
      `${apiBase}/welcome-gift?alias=${encodeURIComponent(auth.alias)}`,
      { method: "POST", headers: { Authorization: `Bearer ${auth.token}` } },
    );
    if (!res.ok) return { ok: false };
    const data = (await res.json()) as { plan?: string; alreadyClaimed?: boolean };
    if (!data.plan) return { ok: false };
    return { ok: true, plan: data.plan, alreadyClaimed: data.alreadyClaimed === true };
  } catch {
    return { ok: false };
  }
}
