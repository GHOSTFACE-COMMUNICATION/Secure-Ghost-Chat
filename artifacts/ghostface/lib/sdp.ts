/**
 * Does this offer actually want video?
 *
 * True when the SDP carries a video m-line the caller is willing to SEND on
 * (sendrecv/sendonly, or no direction attribute at all — the SDP default is
 * sendrecv). A `recvonly`/`inactive` video section, or a port-0 one, means the
 * far end is not offering a picture, so opening this device's camera would be
 * wrong. Returns null when the SDP can't be read at all, so the caller can
 * fall back to whatever the navigation claimed rather than guessing "voice".
 *
 * Deliberately a string scan rather than a parse: an m-section's direction
 * attribute is line-oriented and this only needs one bit out of it, and the
 * answer this feeds is still produced by the real SDP machinery.
 */
export function offerWantsVideo(payloadJson: string): boolean | null {
  let sdp: string;
  try {
    const parsed = JSON.parse(payloadJson) as { sdp?: string };
    if (typeof parsed?.sdp !== "string") return null;
    sdp = parsed.sdp;
  } catch {
    return null;
  }
  // Split on m-lines, keeping the section each attribute belongs to: a
  // direction attribute is scoped to its own m-section (and a session-level
  // one applies to all), so a scan over the whole SDP would happily read the
  // audio section's "sendrecv" as the video section's.
  const sections = sdp.split(/^m=/m);
  const video = sections.find((sec) => sec.startsWith("video "));
  if (!video) return false;
  // "m=video 0 ..." is a rejected/disabled section.
  if (/^video\s+0\s/.test(video)) return false;
  if (/^a=(recvonly|inactive)\s*$/m.test(video)) return false;
  return true;
}
