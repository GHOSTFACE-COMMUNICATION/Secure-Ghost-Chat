export const CODE_REGEX = /^GF-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) {
    if (__DEV__) console.error("[ghostface] EXPO_PUBLIC_DOMAIN is not set — invite API calls will be skipped. Set it in .env or eas.json.");
    return "";
  }
  return `https://${domain}/api`;
}

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
