import { getApiBase } from "@/lib/apiBase";

export const CODE_REGEX = /^GF-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

export type RedeemFailReason =
  | "bad_format"
  | "not_found"
  | "expired"
  | "used"
  | "offline"
  | "connection_failed";

export type RedeemResult =
  | { ok: true; ownerAlias: string }
  | { ok: false; reason: RedeemFailReason };

/**
 * Non-destructive lookup — reads the invite without consuming it.
 * Still returns 410 for codes that are already used or expired.
 * Callers must call consumeInviteCode after addConversation succeeds.
 */
export async function lookupInviteCode(code: string): Promise<RedeemResult> {
  const apiBase = getApiBase();
  if (!apiBase) return { ok: false, reason: "offline" };
  try {
    const res = await fetch(`${apiBase}/invites/${encodeURIComponent(code.toUpperCase())}`);
    if (res.ok) {
      const data = (await res.json()) as { ownerAlias: string };
      return { ok: true, ownerAlias: data.ownerAlias };
    }
    if (res.status === 410) {
      const data = (await res.json()) as { error?: string };
      const reason: RedeemFailReason =
        typeof data.error === "string" && data.error.toLowerCase().includes("expir")
          ? "expired"
          : "used";
      return { ok: false, reason };
    }
    return { ok: false, reason: "not_found" };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

/**
 * Atomically marks a code consumed via POST /invites/:code/consume.
 * Call ONLY after addConversation has returned ok.
 *
 * { ok: true }                    — this call was the one that flipped the flag.
 * { ok: false, alreadyUsed: true } — code was already marked used. If addConversation
 *   already confirmed the channel exists this is a soft-success (client retry after
 *   a dropped network response). Do NOT surface as an error to the user.
 * { ok: false, alreadyUsed: false } — network failure or unexpected error; log and ignore.
 */
export async function consumeInviteCode(
  code: string,
): Promise<{ ok: boolean; alreadyUsed: boolean }> {
  const apiBase = getApiBase();
  if (!apiBase) return { ok: false, alreadyUsed: false };
  try {
    const res = await fetch(
      `${apiBase}/invites/${encodeURIComponent(code.toUpperCase())}/consume`,
      { method: "POST" },
    );
    if (res.ok) return { ok: true, alreadyUsed: false };
    if (res.status === 410) {
      const data = (await res.json()) as { error?: string };
      const alreadyUsed =
        typeof data.error === "string" && data.error.toLowerCase().includes("used");
      return { ok: false, alreadyUsed };
    }
    return { ok: false, alreadyUsed: false };
  } catch {
    return { ok: false, alreadyUsed: false };
  }
}

export type RedeemInviteResult =
  | { ok: true; ownerAlias: string; consumed: boolean }
  | { ok: false; reason: RedeemFailReason };

/**
 * The full invite redemption sequence: validate → look up → handshake →
 * consume. Pure logic — no UI, no haptics, no timers — so every caller can
 * present the outcome in its own idiom.
 *
 * Order matters and is the reason this is worth sharing rather than
 * repeating. The code is consumed only AFTER `addConversation` succeeds: a
 * one-shot code burned before the handshake completes would leave the
 * invitee with neither a conversation nor a usable code, and there is no way
 * to un-consume one.
 *
 * A failed consume after a successful handshake is deliberately NOT an
 * error. The conversation exists, which is what the user asked for; the code
 * simply stays redeemable until it expires. `consumed` reports which
 * happened for callers that care.
 *
 * @param addConversation from `useApp()` — passed in rather than imported so
 *   this stays free of React context and testable on its own.
 */
export async function redeemInvite(
  code: string,
  addConversation: (alias: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<RedeemInviteResult> {
  const normalized = code.trim().toUpperCase();
  if (!CODE_REGEX.test(normalized)) {
    return { ok: false, reason: "bad_format" };
  }

  const lookup = await lookupInviteCode(normalized);
  if (!lookup.ok) {
    return { ok: false, reason: lookup.reason };
  }

  const added = await addConversation(lookup.ownerAlias);
  if (!added.ok) {
    return { ok: false, reason: "connection_failed" };
  }

  const consume = await consumeInviteCode(normalized);
  if (!consume.ok && !consume.alreadyUsed) {
    console.warn("[invite] consume failed after a successful handshake");
  }

  return { ok: true, ownerAlias: lookup.ownerAlias, consumed: consume.ok };
}

/**
 * Progressive formatter for an invite-code text field: filters to the code
 * alphabet and inserts the GF- prefix and dashes as the user types or
 * pastes. Shared so every entry point formats identically — a code that
 * looks different in two places reads as two different codes.
 */
export function formatInviteCodeInput(text: string): string {
  const raw = text.toUpperCase().replace(/[^A-Z2-9-]/g, "").replace(/-/g, "");
  if (raw.length <= 2) return raw;
  if (raw.length <= 6) return `GF-${raw.slice(2)}`;
  return `GF-${raw.slice(2, 6)}-${raw.slice(6, 10)}`;
}
