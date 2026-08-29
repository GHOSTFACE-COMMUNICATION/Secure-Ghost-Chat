import { test } from "node:test";
import assert from "node:assert/strict";

import { offerWantsVideo } from "@/lib/sdp";

// The callee used to decide "is this a video call?" purely from the `mode`
// route param, which has to survive call-ring -> banner/VoIP push -> CallKit
// -> router params. Whenever that hop lost it, the callee joined a video call
// as voice: no camera, video answered recvonly, media one-way. These cover the
// offer shapes that decision is now made from instead.

function offer(sdp: string): string {
  return JSON.stringify({ type: "offer", sdp });
}

const AUDIO_SECTION = ["m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=mid:0", "a=sendrecv"].join("\r\n");

function withVideo(videoLines: string[]): string {
  return ["v=0", "o=- 0 0 IN IP4 127.0.0.1", "s=-", "t=0 0", AUDIO_SECTION, ...videoLines].join("\r\n");
}

test("a sendrecv video m-line wants video", () => {
  const sdp = withVideo(["m=video 9 UDP/TLS/RTP/SAVPF 96", "a=mid:1", "a=sendrecv"]);
  assert.equal(offerWantsVideo(offer(sdp)), true);
});

test("a sendonly video m-line wants video", () => {
  const sdp = withVideo(["m=video 9 UDP/TLS/RTP/SAVPF 96", "a=mid:1", "a=sendonly"]);
  assert.equal(offerWantsVideo(offer(sdp)), true);
});

test("a video m-line with no direction attribute wants video (sendrecv is the SDP default)", () => {
  const sdp = withVideo(["m=video 9 UDP/TLS/RTP/SAVPF 96", "a=mid:1"]);
  assert.equal(offerWantsVideo(offer(sdp)), true);
});

test("an audio-only offer does not want video", () => {
  const sdp = ["v=0", "o=- 0 0 IN IP4 127.0.0.1", "s=-", "t=0 0", AUDIO_SECTION].join("\r\n");
  assert.equal(offerWantsVideo(offer(sdp)), false);
});

test("a recvonly video m-line does not want video", () => {
  const sdp = withVideo(["m=video 9 UDP/TLS/RTP/SAVPF 96", "a=mid:1", "a=recvonly"]);
  assert.equal(offerWantsVideo(offer(sdp)), false);
});

test("an inactive video m-line does not want video", () => {
  const sdp = withVideo(["m=video 9 UDP/TLS/RTP/SAVPF 96", "a=mid:1", "a=inactive"]);
  assert.equal(offerWantsVideo(offer(sdp)), false);
});

test("a rejected (port 0) video m-line does not want video", () => {
  const sdp = withVideo(["m=video 0 UDP/TLS/RTP/SAVPF 96", "a=mid:1", "a=sendrecv"]);
  assert.equal(offerWantsVideo(offer(sdp)), false);
});

// The audio section's own direction must not be read as the video section's —
// this is why the scan is per-m-section rather than over the whole SDP.
test("a sendrecv audio section does not make a recvonly video section want video", () => {
  const sdp = withVideo(["m=video 9 UDP/TLS/RTP/SAVPF 96", "a=mid:1", "a=recvonly"]);
  assert.equal(offerWantsVideo(offer(sdp)), false);
});

test("unreadable payloads return null so the caller can fall back", () => {
  assert.equal(offerWantsVideo("not json"), null);
  assert.equal(offerWantsVideo(JSON.stringify({ type: "offer" })), null);
});
