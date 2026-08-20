// Strict allowlist — reject, don't strip. The previous version silently
// deleted every character outside [\w-] and returned whatever was left,
// which let a decorated/Unicode alias (e.g. copy-pasted from a "fancy font"
// generator) silently collapse into an unrelated short ASCII string with no
// warning to the caller. Aliases are the primary identity key throughout
// this schema (identity_keys.user_id, device_tokens.user_id) — a lossy
// transform here means "what the user typed" and "what got registered" can
// diverge. Returning null forces every caller to handle "invalid alias"
// explicitly instead of silently proceeding with a mangled value.
const ALIAS_PATTERN = /^[A-Z0-9_]{3,20}$/;

export function normalizeAlias(input: string): string | null {
  const candidate = input.trim().toUpperCase();
  return ALIAS_PATTERN.test(candidate) ? candidate : null;
}
