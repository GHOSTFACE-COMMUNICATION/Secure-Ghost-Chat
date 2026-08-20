// Kept in sync with api-server/src/utils/alias.ts — strict allowlist,
// reject rather than strip. The previous version silently deleted every
// character outside [\w-], so a decorated/Unicode alias (e.g. pasted from a
// "fancy font" generator) could collapse into an unrelated short ASCII
// string with no warning — and since the alias IS the identity key
// server-side, "what you typed" and "what got registered" could diverge.
const ALIAS_PATTERN = /^[A-Z0-9_]{3,20}$/;

export function normalizeAlias(input: string): string | null {
  const candidate = input.trim().toUpperCase();
  return ALIAS_PATTERN.test(candidate) ? candidate : null;
}
