/**
 * Identity-key pinning (audit #12).
 *
 * Trust-on-first-use for a contact's long-term X25519 identity key (X3DH
 * `ikA`), plus a hard block when that key later changes.
 *
 * WHY THIS EXISTS
 *
 * The receive path already binds a claimed sender alias to an identity key by
 * asking the server what key it holds for that alias, then requiring the wire
 * header's `ikA` to match. That defends against one PEER claiming another
 * peer's alias. It does not defend against the SERVER, because both halves of
 * the comparison come from the server in the same breath: substitute the
 * prekey bundle and the `/users/exists` answer together and the check is
 * satisfied by the substituted key. The comparison is self-consistent, not
 * anchored to anything the device saw before.
 *
 * Pinning supplies the anchor. The first key we ever see for a contact is
 * recorded on the conversation — inside the encrypted conversation blob, never
 * on the wire — and every later key for that contact is compared against it.
 * A server that swaps a key mid-conversation now has to disagree with a value
 * it never had access to.
 *
 * WHY A MISMATCH MUST BLOCK RATHER THAN WARN
 *
 * The safety number derived in `generateSafetyNumberFromKeys` (audit #11) does
 * change when a peer's identity key is substituted — that is what makes it a
 * real control. But it is recomputed and overwritten on every session rebuild,
 * so a substitution silently rewrites the one artifact that would reveal it.
 * The user is then shown a perfectly normal-looking safety number that simply
 * differs from the one they verified out of band, which nobody re-reads. A
 * warning that repaints the evidence it is warning about is not a control.
 *
 * So on mismatch the caller must refuse the session AND leave both the pin and
 * the stored safety number untouched.
 *
 * RECOVERY
 *
 * A legitimate key change is a real event here: WIPE DEVICE and re-onboard is
 * a supported flow and aliases are reusable afterwards. A block with no way
 * out would make the first contact who reinstalls permanently unreachable, and
 * users would learn to delete and recreate conversations — which discards the
 * pin and defeats the control. Recovery is therefore an explicit, deliberate
 * user action that re-pins and drops any prior verification, never an
 * automatic adoption.
 */

/** Result of comparing a presented identity key against a stored pin. */
export type PinVerdict =
  /** No pin stored yet — caller should record `normalized` as the pin. */
  | "first-use"
  /** Presented key equals the pin. */
  | "match"
  /**
   * Presented key differs from the pin, OR the stored pin is unreadable.
   * Both are blocking: a pin we cannot parse is a pin we cannot verify
   * against, and the safe reading of "cannot verify" is "do not proceed".
   */
  | "mismatch";

export interface PinCheck {
  verdict: PinVerdict;
  /**
   * The presented key, normalised (trimmed, lowercased). Always present —
   * `checkIdentityPin` throws rather than returning a verdict when the
   * presented key is malformed, so there is no verdict without a usable key.
   */
  normalized: string;
}

/**
 * Normalise an identity key to the form used for storage and comparison.
 *
 * Hex reaches call sites from two different sources — a fetched prekey bundle
 * on the initiator side, a wire X3DH header on the responder side — and the
 * codebase compares such keys with `.toLowerCase()` elsewhere. Without
 * normalising, two identical keys could compare unequal and hard-block a
 * legitimate contact, which is a denial of service dressed up as security.
 *
 * Throws on anything that is not 64 hex chars. A pin must never be set from,
 * or compared against, input we could not parse.
 */
export function normalizeIdentityKey(key: unknown, label = "identity"): string {
  const k = (typeof key === "string" ? key : "").trim().toLowerCase();
  if (k.length !== 64 || !/^[0-9a-f]+$/.test(k)) {
    throw new Error(
      `[identityPin] ${label} key must be 64 hex chars — refusing to pin or ` +
        `compare against unparseable key material`,
    );
  }
  return k;
}

/**
 * Compare a presented identity key against the stored pin.
 *
 * @param pinned    The pin held on the conversation, or undefined/null on
 *                  first contact. A malformed stored pin yields "mismatch"
 *                  (fail-closed) rather than throwing, so corrupted local
 *                  state locks the conversation instead of silently
 *                  re-pinning it.
 * @param presented The key offered now — bundle `ikPublicKey` on the
 *                  initiator side, header `ikA` on the responder side.
 *
 * @throws if `presented` is malformed. That is a caller bug or a hostile
 *         server response, and neither should be resolvable into a verdict.
 */
export function checkIdentityPin(
  pinned: string | null | undefined,
  presented: unknown,
): PinCheck {
  const normalized = normalizeIdentityKey(presented, "presented");

  if (pinned === undefined || pinned === null || pinned === "") {
    return { verdict: "first-use", normalized };
  }

  let pin: string;
  try {
    pin = normalizeIdentityKey(pinned, "pinned");
  } catch {
    return { verdict: "mismatch", normalized };
  }

  return { verdict: pin === normalized ? "match" : "mismatch", normalized };
}
