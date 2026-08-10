# GF-XX | Self-hosted TURN (coturn) — replace Twilio NTS before public launch

**Priority:** High (pre-launch blocker for privacy claims)
**Category:** Infrastructure / Privacy

## Context

`/api/ice-config` currently serves STUN-only (no `TWILIO_*` or `TURN_*` set on
Railway), which is why video calls are one-way and degraded behind NAT.
Twilio NTS (`api-server/src/routes/iceConfig.ts`, `twilioConfig()`) is already
wired up server-side as the interim fix — it just needs `TWILIO_ACCOUNT_SID` /
`TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` set to start working. This ticket
is about what replaces it before launch, not about shipping Twilio long-term.

## Why

Every call that can't complete on a direct/STUN path gets its media relayed
through a TURN server, and whoever runs that TURN server sees the caller and
callee's real IP addresses, session timing, and byte counts for the
duration of the call — even though the SRTP payload itself stays encrypted.
Twilio NTS makes Twilio that third party.

That's a real gap against how this app is positioned: sealed sender, double
ratchet, X3DH, post-quantum key exchange, disappearing messages, no-logs —
the whole pitch is that no outside party sees who's talking to whom or when.
A relayed call quietly handing IP-and-metadata visibility to a US
third-party SaaS vendor contradicts that pitch the moment someone's behind
strict NAT (which is most calls on cellular/carrier-grade NAT). This isn't
a performance nice-to-have, it's a privacy claim we can't honestly make
with Twilio in the relay path.

Self-hosting coturn on infrastructure we already operate (same trust
boundary as api-server/Postgres, already on Railway) removes that third
party. It doesn't make the relay disappear — whoever runs it always has
that metadata visibility — but it stops widening the trust boundary to an
outside vendor, and lets us actually write down and enforce our own
no-logging policy on relay traffic instead of trusting Twilio's.

## Scope

- Deploy coturn (or equivalent) as a Railway service, reachable on
  3478/udp+tcp (STUN/TURN) and 5349/tcp (TURNS) plus a relay port range
  (typically 49152-65535/udp — check Railway's UDP/port-range support first,
  this may force a different host than Railway).
- Generate short-lived, per-call credentials using coturn's REST API
  auth mechanism (HMAC-SHA1 over a shared secret + expiry timestamp) rather
  than static username/password — mirrors how Twilio NTS tokens already
  work, so `/api/ice-config`'s response shape barely changes.
- Update `iceConfig.ts`: add a `coturnConfig()` source (same `IceServer[]`
  shape as `twilioConfig()`/`staticConfigFromEnv()`) that generates these
  credentials from a `TURN_SHARED_SECRET` env var, and make it the
  top-priority source ahead of Twilio.
- TLS cert for `turns://` (coturn needs its own cert, distinct from the
  api-server's — Let's Encrypt via the same domain infra is fine).
- Explicit log/retention policy for coturn itself (rotate fast, no
  persistent connection logs) — this is the whole point of the migration,
  so it needs to actually be configured, not just assumed.
- Decommission Twilio NTS env vars once coturn is confirmed working
  end-to-end (both directions, behind real NAT, not just same-network
  testing).

## Acceptance criteria

- [ ] Two devices on separate cellular/carrier-grade-NAT networks (not the
      same wifi) complete a video call with two-way audio+video.
- [ ] `/api/ice-config` `source` field reads `"coturn"` (or equivalent), not
      `"twilio"` or `"stun-only"`, in production.
- [ ] Coturn access logs/connection logs are confirmed short-retention or
      disabled per the policy above.
- [ ] `TWILIO_*` env vars removed from Railway once coturn is verified.
- [ ] Runbook/doc for rotating `TURN_SHARED_SECRET` and cert renewal.

## Out of scope

- The one-way-video negotiation bug (getMedia race → asymmetric SDP) and
  the missing capture/bitrate constraints — separate, already-diagnosed
  issues, fixed independently of which TURN backend is behind it.

## Related

- Interim: enable Twilio NTS now (env vars only, no code change needed) to
  unblock testing/launch-adjacent work while coturn is built out.
