# GHOSTFACE VPN — implementation plan

**Status:** plan only. No VPN code has been written. Prepared 22 Aug 2026.

## 0. Where we are today

There is **no VPN**. `connectVPN()` in `context/AppContext.tsx:2433` sets
`vpnConnected: true` in React state and persists the chosen server id. That is
the entire implementation. No tunnel is negotiated, no traffic is routed, and
no VPN library is installed (no WireGuard, no OpenVPN, no NetworkExtension
entitlement in `app.json`).

Parts of `app/(tabs)/vpn.tsx` are already honest — the IP is really fetched
from ipify, "PING" is a genuinely measured round trip, and the connect spinner
waits on a real request rather than a made-up 1500 ms. Those were deliberate
earlier fixes and should be kept.

### ⚠️ One thing to fix now, independent of this plan

`app/(tabs)/vpn.tsx:362-373` currently does this:

| State | Label | Value |
|---|---|---|
| Disconnected | `YOUR EXPOSED IP` (red) | the user's real IP |
| "Connected" | `IP ADDRESS` | `●●●.●●●.●●●.●●●` |

Tapping the shield masks the IP and drops the word "exposed", and the icon
becomes `shield-checkmark`. Nothing about the user's network has changed. The
screen tells someone they are protected when they are not.

A real VPN is months away (see §7). **This should be corrected before the next
build**, not left in place waiting for the real implementation. See §8.

## 1. Blockers and their current state

| Blocker | State |
|---|---|
| **App Store Guideline 5.4** — VPN apps "may only be offered by developers enrolled as an organization" | ✅ **Organization enrolment submitted 22 Aug 2026.** Verification (incl. D-U-N-S) typically takes days-to-weeks; treat as pending until Apple confirms. |
| **Packet Tunnel Provider entitlement** | ✅ Not a blocker. Self-serve since Nov 2016 — enable the capability in Xcode/developer portal, no Apple request or wait. (Only Hotspot Helper and NE App Push remain managed.) |
| **Android** | ✅ No approval needed. `VpnService` + `BIND_VPN_SERVICE`, with the system consent dialog. |
| **Server infrastructure** | ❌ Does not exist. Six regions are advertised in the UI with nothing behind them. |

<!-- TODO: confirm in the developer portal once verification completes, then
     update the "Apple Team" row in the repo root CLAUDE.md, which still reads
     "98337579X8 (BENJAMIN HENDERSON, Individual)". -->

### ⚠️ Migration question raised by the org enrolment

If Apple issued a **new organization team** rather than converting the existing
individual one, then everything currently signed under `98337579X8` has to move:

- ASC App ID `6781518828` (app transfer, or re-create the listing)
- Distribution certificates and provisioning profiles
- The APNs auth key (`APNS_KEY_ID` / `APNS_TEAM_ID` on the Railway api-server)
- EAS credentials
- TestFlight testers and existing build history

**An app transfer also cannot happen while the app has certain states pending**,
and push credentials must be reissued under the new team or VoIP/CallKit push
breaks. This needs answering before any build is cut under the new team.

## 2. Architecture options

### Option A — self-hosted WireGuard (full control)

```
app ──► WireGuard tunnel ──► GHOSTFACE VPN node (region)
                                   │
                              exit to internet
        control plane: api-server issues peer configs, gated on subscription
```

- **Pros:** full control, no third party sees user traffic, fits the product's
  privacy positioning, ties naturally to SPECTER/PHANTOM tiers.
- **Cons:** you become a network operator (§5). Real per-region cost. Key
  management, peer lifecycle, abuse handling and capacity all become yours.

### Option B — white-label / SDK partner

License an existing VPN provider's SDK and infrastructure.

- **Pros:** far faster; no servers to run; abuse handling and IP reputation are
  the partner's problem.
- **Cons:** a third party carries user traffic, which contradicts "NO FACE. NO
  TRACE." unless disclosed plainly. Recurring per-user cost. Guideline 5.4 bars
  selling/disclosing VPN data to third parties — the partner contract has to be
  compatible with that commitment.

**Recommendation:** Option A, but launch **one region**, not six. Six advertised
regions with no infrastructure is the current problem; shipping one real region
is more honest than six fake ones and cuts initial cost ~6×.

<!-- TODO: decision needed — A or B. Everything below assumes A. -->

## 3. Client implementation

### iOS
- New **app extension target**: `NEPacketTunnelProvider` (separate binary from
  the main app).
- Entitlement `com.apple.developer.networking.networkextension` with
  `packet-tunnel-provider`; App Group for sharing config between app and
  extension; Keychain sharing for peer keys.
- WireGuardKit (Apple-platform bindings) inside the extension.
- **Expo impact:** requires a config plugin and a prebuild — this cannot work in
  Expo Go, and the extension target must be generated at prebuild time.
  <!-- TODO: verify WireGuardKit licensing for App Store distribution before
       committing to it. -->

### Android
- Foreground `VpnService` + `BIND_VPN_SERVICE`, system consent dialog on first
  connect.
- `wireguard-android` (`com.wireguard.android:tunnel`), which ships a Go
  userspace backend and an optional kernel path.
- Config plugin for the service/permission entries.

### Shared client work
- Fetch peer config from the api-server, store keys in existing encrypted
  storage (`lib/secureStorage.ts`), never in plain AsyncStorage.
- Real connection state machine driven by tunnel callbacks — replacing the
  current boolean.
- **Kill switch** ("block traffic if the tunnel drops"). Users of a privacy app
  will assume this exists; if it isn't implemented, the UI must not imply it.
- Genuine per-region latency once real endpoints exist (the current single
  measured ping can then become per-server).

## 4. Server side

Per region: a WireGuard node (`wg0`), NAT/forwarding, and a control agent that
adds/removes peers on demand.

Control plane on the existing api-server:
- `POST /api/vpn/session` → verify subscription entitlement, allocate an IP from
  the region's pool, register the peer's public key, return the peer config.
- `DELETE /api/vpn/session` → deregister.
- Peer expiry/reaping so abandoned sessions don't exhaust the pool.

**Auth must reuse the existing entitlement check** (`/api/crypto/entitlement`),
so region access follows GHOST/SPECTER/PHANTOM rather than being a second,
parallel notion of who has paid.

**Note:** the client only ever sends its WireGuard **public** key. Private keys
are generated on-device and never transmitted — the same posture as the
messaging identity keys.

## 5. Legal and policy — the part that is easy to underestimate

Running a VPN makes GHOSTFACE Limited a network operator carrying third-party
traffic. That brings obligations no other part of this app has:

- **Logging policy.** Guideline 5.4 requires a clear declaration of what is
  collected, before purchase, and a commitment in the privacy policy not to
  sell/disclose it. A "no logs" claim must be *true* and defensible.
- **Abuse handling.** Exit IPs will be used for abuse; expect DMCA notices, spam
  complaints, and blocklisting of the exit IPs. Someone must answer these.
- **Law enforcement requests**, under NZ law and the law of each exit region.
- **VPN licensing** in territories that require it — Apple wants the licence
  details in App Review Notes for those markets.
- **Privacy policy update.** The policy published at `/privacy` on 21 Aug does
  **not** mention VPN at all. It must cover it before a VPN ships.
- **Existing external claims** already assert a VPN: `STORE_SUBMISSION.md`
  ("VPN Dashboard", tag `vpn`) and the **Stripe** business description
  ("an integrated VPN"). These should match reality in whichever direction it
  lands.

<!-- TODO: legal review, ideally with the same counsel handling GF-01. -->

## 6. Cost

<!-- TODO: no figures here on purpose — they depend on region count, instance
     size, and bandwidth commit, none of which are decided. Model it before
     committing. The shape of it: per-region compute is the small part;
     egress bandwidth is the part that scales with users and is easy to
     underestimate. Note the EAS build account is already ~$110 into
     pay-as-you-go overage this period, so infra spend is not free headroom. -->

## 7. Phasing

| Phase | Work | Gate |
|---|---|---|
| 0 | Fix the misleading UI (§8) | **Do now** — does not depend on any of the below |
| 1 | Confirm org enrolment; resolve the team-migration question (§1) | Apple verification |
| 2 | Decide Option A vs B; decide region count | Product/cost call |
| 3 | Stand up **one** WireGuard region + control-plane endpoints | — |
| 4 | Android client first (no Apple dependency, faster loop) | — |
| 5 | iOS NetworkExtension target + Expo config plugin + prebuild | Phase 1 complete |
| 6 | Kill switch, reconnect handling, real per-region latency | — |
| 7 | Legal: logging policy, privacy policy update, abuse process | Before any public release |

Phase 4 before 5 deliberately: Android has no Apple dependency, so the whole
control plane and tunnel lifecycle can be proven while Apple verification and
the team migration are still in flight.

## 8. Interim state (Phase 0) — recommended now

Until a real tunnel exists, the VPN screen should stop asserting protection:

- Keep showing the **real IP** in both states; remove the `●●●.●●●.●●●.●●●`
  masking.
- Replace the connected/`shield-checkmark` framing with an explicit
  not-yet-active state.
- Label the six regions as **planned**, not selectable endpoints.
- Keep the genuinely real parts: measured ping, real IP lookup, real round-trip
  on connect.

This is a small change and is worth doing before the next build regardless of
which architecture option is chosen.
