# STATUS — living session state

Read this at the start of every session (Cowork or Claude Code); update it
before ending one. This file is the cross-session memory: if it's stale,
sessions re-derive context wrong.

Last updated: 2026-08-24 (Claude Code session — VPN health check found the
VPN P0 RESOLVED: agent unwedged, 8443 firewalled to Railway static egress,
agent rewritten so a stalled client cannot wedge it, and the first successful
peer registration ever, verified end to end. See RESOLVED INCIDENT below.
Earlier the same day: WireGuard native client — PacketTunnelProvider.swift +
native bridge module both written; full-app build blocked by an unrelated
fmt/Clang compiler bug — needs Benji's call on how to proceed)

## ✅ RESOLVED INCIDENT — VPN peer agent down, box unfirewalled (24 Aug)

**Closed 24 Aug.** All three steps of the recorded fix order are done and the
control plane is verified end to end — for the first time since it was built.

**Resolution:**
1. **Unwedged.** Dropped the stalling host (`129.213.151.234`) *before*
   restarting, not after — the recorded order restarted first, which would
   have let the same still-connected client re-wedge the fresh process within
   seconds. New pid, `Recv-Q` back to 0, the six CLOSE-WAIT sockets gone,
   localhost answering in 5ms.
2. **Firewalled.** `infra/vpn-agent/firewall.sh` restricts tcp/8443 to the
   api-server's three Railway static outbound IPs plus localhost, via its own
   `VPNAGENT` chain — SSH, WireGuard and the INPUT policy untouched, so no
   lockout risk and `ufw` stays off. Static Outbound IPs had to be enabled on
   the Railway service first (they were off; Pro feature). Persisted across
   reboot by `vpn-agent-firewall.service`, ordered after `wg-quick@wg0`.
   Verified from an outside IP: 8443 now times out; SSH, api and coturn
   unaffected.
3. **Rewritten.** `infra/vpn-agent/agent.py` — now in the repo rather than
   only on the box. TLS moved off the accept loop (the root cause), threaded,
   backlog 5 -> 128, timeouts on handshake/request/`wg`, bounded
   Content-Length, and a `GET /healthz`. Reproduced the exact attack (7
   concurrent stalled TLS connections) against production: `/healthz` kept
   answering throughout.

**Two pre-existing bugs found while testing the rewrite locally, both latent
only because no peer had ever registered successfully:**
- `remove_peer_from_conf` corrupted `wg0.conf`. `re.split` consumes the
  newline before each `[Peer]` and `"".join(kept)` never restored it, welding
  sections together (`ListenPort = 51820[Peer]`) into a file `wg-quick` cannot
  parse. It corrupts from the **second** peer onward — it would have hit the
  day the VPN started working, and looked nothing like the agent.
- Making the server threaded turns that read-modify-write into a race. Config
  mutation is now serialised under a lock, and writes are atomic
  (temp + `os.replace`) so a crash cannot truncate the file `wg-quick` reads
  at boot.

**End-to-end verified** (throwaway alias `ZZVPNTEST1`, entirely through the
app's own API, no hand-written DB rows): register -> `200` in 1.15s returning a
full client config with `tunnelIp 10.66.0.2`; GET confirmed persistence; DELETE
removed the peer; identity deleted; alias confirmed gone. Prod left as found.
That `200` also proves the allowlist is correct — the api-server really does
egress from one of those three static IPs, which no label could confirm.

⚠️ **Standing coupling:** Railway reassigns static outbound IPs when a service
changes region, and api-server moved `sfo` -> `us-west2`. Another move breaks
peer registration silently and will look exactly like this incident. Re-run
`firewall.sh` with fresh values from
`railway outbound-network static-ip status --service api-server`.

**Still true: end-to-end tunnel is NOT achieved.** The control plane works; the
*client* does not exist yet (`lib/wireguard.ts` and AppContext wiring not
started, Network Extension entitlement not requested, EAS lacks a Go
toolchain). **Do not cancel or downgrade Mullvad.**

<details>
<summary>Original incident report (24 Aug) — kept for the diagnosis</summary>


Found by a read-only health check on 24 Aug ~08:50 UTC. **Nothing was changed
or fixed** — report-before-code. Full writeup was in the session scratchpad;
the substance is here.

**P0 — `vpn-agent` on `ghostface-vpn-eu1` is hard-wedged, and has never once
served a successful request.** systemd reports `active (running)`, so nothing
alerts, but the process answers nothing.
- pid 3443 is single-threaded (`nlwp 1`) and blocked in `tcp_recvmsg` /
  `sk_wait_data` reading fd 4 — an ESTAB connection from 129.213.151.234
  (Oracle Cloud, unrecognised). Listener sits at `Recv-Q 6 / Send-Q 5`: the
  accept queue is saturated past its backlog, so new SYNs are dropped and the
  port reads as "filtered" from outside. Six more conns from that same IP are
  in CLOSE-WAIT with 1780 unread bytes each. A TLS handshake from *localhost*
  times out, so this is the process, not the network.
- Never succeeded since its 23 Aug 07:19:57 start: `/etc/wireguard/wg0.conf`
  has mtime 23 Aug 06:58:36 — 21 min *before* the agent started — and holds 0
  `[Peer]` blocks; `wg show` lists no peers. Every successful POST /peer would
  have rewritten that file. **Any agent testing after 23 Aug 07:19 silently
  failed.**
- Root cause in `/etc/vpn-agent/agent.py`: `http.server.HTTPServer` is
  single-threaded with default `request_queue_size = 5`; no socket or handler
  timeout is set anywhere; and `ctx.wrap_socket(server.socket, server_side=True)`
  wraps the *listening* socket, putting the TLS handshake inline in the accept
  loop. One client that connects and stalls blocks the server forever. Not
  self-healing — `Restart=` never fires because the process never dies.
- Zero observability by design: `log_message` is overridden to `pass` (to keep
  the bearer token out of logs), so there is no request log and no liveness
  signal. Whatever replaces this needs a `GET /healthz`.
- Blast radius: all `POST`/`DELETE /vpn/:userId/register` fail. `callAgent`'s
  `timeout: 8_000` means prod fails cleanly rather than hanging Node — that
  part is correct. `GET` still works (DB-only). No user impact today: there is
  no working client yet. No DB/interface drift is possible either, because
  `POST` calls the agent *before* writing the DB, so a wedged agent inserts
  nothing. (`select count(*) from vpn_peers` was not run — should be 0.)

**P1 — the box has no firewall at all.** `ufw` is `inactive`; `nft` has no
`inet filter` table, only NAT/masquerade and a `policy accept` forward chain.
Ports 22 and 8443 were confirmed reachable from an unprivileged home IP.
(51820/udp unverified — WireGuard is silent to unauthenticated packets, so no
reply proves nothing.) This is not a host-vs-Hetzner-Cloud-firewall
distinction: the Oracle Cloud IP established a TCP connection to 8443, so
nothing upstream filters it either. That is how it reached and wedged the
agent. The bearer secret and pinned cert still gate *actions* — this is a
pre-auth availability hole, not peer injection.

**Verified healthy:** `wg-quick@wg0` active + enabled, wg0 = 10.66.0.1/24 +
fd66::1/64 on 51820; `ip_forward = 1`; NAT masquerade present (v4 + v6);
`GET /api/healthz` -> 200; VPN routes mounted with correct auth (401 no token,
403 bad token); all 5 `VPN_*` env vars present on Railway api-server prod.

**Fix order when Benji calls it:** (1) restart `vpn-agent` — seconds to
restore, but it will wedge again on the next stalled connection; (2) firewall
8443 to Railway egress only; (3) fix the agent properly —
`ThreadingHTTPServer`, per-connection timeout, wrap the socket per-connection
rather than the listener, add `GET /healthz`.

**Not done:** no live register -> verify -> delete round-trip. It is a prod
write (inserts `vpn_peers`, mutates `wg0`) and cannot pass until the agent is
unwedged — ask for it explicitly.

**Bearing on the Mullvad decision: end-to-end is NOT achieved.** Control plane
up != tunnel works. Do not cancel or downgrade Mullvad.

</details>

## 24 Aug session changes (cont.)

- **Native bridge module written, but exposed a second unrelated compiler
  bug that now blocks the full app build.** `native/vpn-tunnel/` (new dir,
  survives `expo prebuild --clean` same as `targets/`) holds
  `VPNTunnelModule.swift` + `.m` — a classic RN native module (`RCTEventEmitter`
  + `RCT_EXTERN_MODULE`, no new dependency: `expo-modules-core`'s presence
  was checked but this uses the plain React Native bridge module pattern
  instead, matching how `react-native-callkeep` etc. already work in this
  app) exposing `connect(config)`/`disconnect()`/`getStatus()`/`getLastError()`/
  `getRuntimeConfiguration()` plus a `VPNTunnelStatusDidChange` event, driving
  `NETunnelProviderManager` from the main app. `lib/vpnTunnelModule.ts` is
  the typed JS wrapper. `scripts/link-wireguard-kit.mjs` now also links
  `native/vpn-tunnel/` into the `GHOSTFACE` target as a synchronized group
  (Xcode 16's folder-reference mechanism, same one `@bacons/apple-targets`
  already uses for `targets/network-packet-tunnel/`) — verified correct via
  direct `.pbxproj` inspection (group created, added to `mainGroup`, added to
  the target's `fileSystemSynchronizedGroups`). tsc clean.
  - **New blocker, confirmed real via a controlled isolation test (2/2 both
    ways):** adding this module to the `GHOSTFACE` target's build graph
    causes `fmt` (pinned to `11.0.2` by RN 0.81's `RCT-Folly` podspec) to be
    compiled from source instead of coming from React Native's prebuilt
    `ReactNativeDependencies.xcframework` — and that from-source compile
    fails deterministically: `error: call to consteval function ... is not a
    constant expression` in `fmt/format-inl.h`. Root cause understood
    precisely: `fmt`'s own `base.h` decides whether to trust `consteval`
    based on `__apple_build_version__ >= 14000029` (a hardcoded "Apple Clang
    14+ has working consteval" assumption) — true for this machine's
    bleeding-edge Xcode/Clang, but the assumption is wrong for whatever
    specific Clang build ships with it. **Not fixable via a build-setting
    override** — confirmed by testing (`-D FMT_CONSTEVAL=` had zero effect;
    traced why: `fmt`'s header unconditionally `#define`s `FMT_USE_CONSTEVAL`/
    `FMT_CONSTEVAL` itself with no `#ifndef` guard, so any externally-injected
    value gets silently clobbered). A real fix needs either patching `fmt`'s
    header (via a `Podfile` `post_install` hook — `ios/Podfile` is
    regenerated every `expo prebuild`, so this would need a config plugin,
    not a one-off edit) or undefining a libc++ feature-test macro build-wide
    (`-U__cpp_lib_is_constant_evaluated`), which has a blast radius well
    past this one library. **Deliberately not applied without asking** — this
    is the *second* unrelated toolchain bug surfaced by this pre-release
    macOS 27 + stable Xcode 26.6 combination (first was the Explicit Modules
    `.pcm` cache bug, see above), and whether to keep patching around this
    specific OS or wait for a stable release is Benji's call, not mine to
    make unilaterally.
  - Not yet root-caused *why* adding one Objective-C-visible native module
    changes whether `fmt` gets pulled in from source at all — plausible but
    unconfirmed hypothesis: RN's New Architecture interop layer for legacy
    bridge modules pulls in Folly-dependent codegen output that the prebuilt
    binary doesn't cover. Untested whether a TurboModule (proper Codegen'd
    native module, not the legacy `RCT_EXTERN_MODULE` pattern) would avoid
    this.
  - `lib/wireguard.ts` (on-device keypair generation — `@noble/curves`
    already has `x25519`, no new dependency needed) and wiring
    `AppContext.tsx`'s mock `connectVPN()`/`disconnectVPN()` to this module
    are still not started.

## 24 Aug session changes

- **WireGuard native client: full local build now succeeds end-to-end.**
  Continuing the 23 Aug native-client work below. `networkpackettunnel`
  (the app extension) now compiles and links cleanly against the real
  `WireGuardKit`/`WireGuardKitC`/`WireGuardKitGo` core, producing a valid
  `networkpackettunnel.appex`, via one reproducible command:
  `npx expo prebuild -p ios --clean && node scripts/link-wireguard-kit.mjs
  && pnpm run ios:sim:build` (new npm script, `artifacts/ghostface/`).
  - **Root cause of the prior blocker**: Xcode's Explicit Modules build path
    hit a non-deterministic "module file ... not found" fatal error compiling
    `WireGuardKitC`'s C sources — traced to running stable Xcode 26.6 on
    pre-release macOS 27 (Homebrew itself flags this OS as unsupported).
    Neither of Benji's two suggestions ("delete xcode better" / "or
    rocketship") was the actual cause — confirmed via `xcodebuild -version`
    (genuinely stable 26.6, not a beta) and RocketSim only touching the
    Simulator runtime, not Xcode's build-time compiler.
  - **Fix**: `CLANG_ENABLE_EXPLICIT_MODULES=NO SWIFT_ENABLE_EXPLICIT_MODULES=NO`.
    This does NOT propagate through project.pbxproj-level build settings to
    the SPM package graph (confirmed empirically — a project-level-only
    version of the fix still failed) — it must be passed as an `xcodebuild`
    command-line override, which is why it's baked into the new
    `ios:sim:build` npm script rather than the linking script.
  - Also fixed along the way: an all-architectures build (arm64 + x86_64)
    fails on x86_64 alone — `libwg-go.a`'s Go runtime references
    `_fdopendir$INODE64`/`_readdir_r$INODE64`, symbols recent SDKs dropped
    for the Intel simulator slice. `ios:sim:build` forces `ARCHS=arm64
    ONLY_ACTIVE_ARCH=YES` (correct anyway on this Apple Silicon Mac).
  - **Workflow constraint confirmed**: only `expo prebuild --clean` is safe
    before `link-wireguard-kit.mjs` — a non-clean prebuild on top of the
    script's manual `project.pbxproj` mutations crashes
    `@bacons/apple-targets`' own diffing logic
    (`withIosXcodeProjectBeta2BaseMod: Cannot read properties of undefined`).
  - **Not yet done**: `targets/network-packet-tunnel/PacketTunnelProvider.swift`
    is still the unedited scaffold stub — the actual tunnel logic (wiring
    `WireGuardAdapter` to the `api-server` `/vpn/:userId/register` config)
    hasn't been written, nor has the main-app native bridge module for
    `NETunnelProviderManager` start/stop. EAS cloud build support (Go
    toolchain on EAS's build servers) also still outstanding — this build
    fix is proven locally only so far.
  - No git commit yet for any of this (`app.json`, `targets/`,
    `scripts/link-wireguard-kit.mjs`, `package.json` script + new
    devDependencies) — per this repo's report-before-code convention,
    holding until asked.

## 23 Aug session changes

- **GF-01: MinterEllison ENGAGED — materials sent, opinion due early next
  week (25 Aug).** Superseding the "held off" note below: the engagement went
  ahead. Materials (crypto inventory + research memo) were sent through to
  Sarah Salmond, and she has now confirmed receipt — "we'll review the
  materials and come back to you if we have any questions… we expect to
  provide our advice early next week." So the written opinion (both the US EAR
  mass-market/CCATS question and the NZ strategic-goods/cryptography question)
  is expected ~week of 1 Sep. **`eas submit` stays FROZEN until that written
  opinion lands**, and the `ITSAppUsesNonExemptEncryption: false` flag is to be
  re-decided against it before any submission. No action needed now beyond
  standing by for Sarah's questions; chase only if nothing arrives by ~Wed 3
  Sep. Torres/Wiley US outreach (22 Aug) can be stood down with a courtesy
  note if they reply, now that MinterEllison covers the US question in-house.
- **GF-01: MinterEllison replied, held off pending US firms.** Partner in
  MinterEllisonRuddWatts' International Trade and Regulatory team responded
  to the 19 Aug enquiry with a proposal: written opinion covering BOTH the
  US EAR mass-market/CCATS question AND the NZ strategic goods/cryptography
  exemption question, $4,000–$7,000 NZD + GST + office services charge,
  5 business days. Explicitly excludes engaging US counsel themselves unless
  their review says otherwise — i.e. their estimate assumes they answer the
  US question in-house too, which overlaps with the two US-specialist
  enquiries (Torres Trade Law, Wiley Rein) already in flight from 22 Aug.
  **Decision: held off, waiting for Torres/Wiley to reply first** — Benji's
  read is the crypto stack already meets mass-market self-classification
  guidelines, so paying MinterEllison now would mainly be paying for
  confirmation of a foregone conclusion. If the US firms come back with
  anything short of a clean opinion, MinterEllison's NZ-side coverage is
  still on the table — no reply sent to them yet, no engagement declined.
  Chase-Monday reminder from the prior update is now moot (they replied).

- **Self-hosted WireGuard VPN — infra and control-plane live, native client
  blocked on Go toolchain wiring.** Real (not mock) VPN, replacing the
  previous cosmetic `connectVPN()`/`disconnectVPN()` state-flip in
  `AppContext.tsx`:
  - Hetzner VPS `ghostface-vpn-eu1` (Nuremberg, cpx22) — WireGuard server on
    `wg0`. ⚠️ **This entry originally claimed the box was "firewalled to
    SSH(22)/WireGuard(51820 udp)/agent(8443 tcp) only" — that is not true
    of the running box; corrected 24 Aug, see ACTIVE INCIDENT above.**
    A small Python-stdlib peer-management agent runs on it (bearer-secret +
    pinned self-signed TLS), adding/removing WireGuard peers.
  - `api-server`: `POST/GET/DELETE /vpn/:userId/register` (live in prod) —
    device generates its own keypair, sends only the public key; server
    allocates a 10.66.0.0/24 tunnel IP, persists to a new `vpn_peers` table
    (`lib/db/src/schema/vpn.ts`), and calls the box's agent.
  - Apple Developer portal: `com.ghostface.app` and new
    `com.ghostface.app.tunnel` (extension) App IDs both have Network
    Extensions + Personal VPN capabilities enabled. **Still needed**: the
    separate formal Network Extension entitlement request via
    https://developer.apple.com/contact/request/network-extension/ — has
    its own days/weeks approval lag, not yet submitted.
  - Mobile: `targets/network-packet-tunnel/` extension target scaffolded via
    `@bacons/apple-targets` (new devDependency, approved) + `@bacons/xcode`
    (also added). `scripts/link-wireguard-kit.mjs` links WireGuard's
    official `wireguard-apple` SPM package into the target as a
    post-prebuild step (config-plugin mod ordering made this unworkable as
    a plugin — see the script's own comments).
  - **Blocker**: official `WireGuardKit` needs a Go toolchain to compile its
    `wireguard-go-bridge` core via a manually-wired Xcode "External Build
    System" target — not something SPM or `@bacons/apple-targets` automates.
    Go 1.27.0 now installed locally (`brew install go`). EAS's cloud build
    servers do NOT have Go by default — a custom EAS build hook will be
    needed before cloud builds work, separate from local build support.
  - Old fake VPN UI already reworked: radial-menu VPN node turns gold
    (`#F5D26B`) when `vpnConnected`, was previously a no-op.
  - Do not cancel/downgrade any existing third-party VPN (e.g. Mullvad) —
    explicitly told to hold off until GHOSTFACE's VPN is tested end-to-end.

## 22 Aug session changes

- **GF-01 outreach widened.** Emails sent 22 Aug from benjamin@ghostface.co.nz
  to two US encryption-export specialists: Olga Torres (olga@torrestradelaw.com,
  Torres Trade Law) and Lori Scheetz (lscheetz@wiley.law, Wiley Rein). Bounded
  ask: one-page opinion on §740.17(b)(1) mass-market self-classification vs
  CCATS re kdfRkPQ, fixed fee requested. MinterEllison (original 19 Aug
  enquiry) replied 23 Aug — see above.
- Copies of counsel emails were forwarded to jjules@ — Benji's mother, an
  intended recipient, not a leak. ⚠️ However the two spellings used were
  `xtra.com` and `xtra.co`, while NZ Xtra addresses are `@xtra.co.nz`. Both
  domains used are real and separately owned, so confirm she actually
  received it; if not, the mail reached whoever holds jjules@ there.
- **Google account recovered** (was locked). Gmail connector authorized in
  Cowork; send-as alias benjamin@ghostface.co.nz confirmed working.
  Follow-ups from the lockout list still open: Vercel 2nd login method,
  CrazyDomains recovery, domain-expiry check.
- **Apple Developer: migrating Individual → Organisation (Ghostface
  Limited), still processing as of 22 Aug (~1 day).** Once cleared: check
  whether Team ID `98337579X8` changed and update CLAUDE.md's iOS
  identifiers; the org D-U-N-S number then also unblocks a Google Play
  **organisation** developer account (decided: org, matching Apple) —
  signup deliberately deferred until Apple verification clears.
- Cowork scheduled tasks created: daily 7am briefing, Monday 8am weekly
  roadmap, one-shot counsel-chase reminder (Mon 24 Aug).

## ⏳ OPEN LOOPS (as of last session)

- **Alias normalization vulnerability — FOUND AND FIXED (20 Aug).**
  `normalizeAlias()` used to silently strip decorated/Unicode "fancy font"
  characters instead of rejecting them, applied inconsistently between
  client and server. Onboarding never previewed the actual normalized
  alias before registration, so a user could type a stylized alias, watch
  it pass every visible check, and register under a totally different
  short ASCII fragment with no warning — which could collide with (or be
  probed for) an existing real account via the add-contact flow. Fixed:
  `normalizeAlias` now rejects (returns `null`) instead of stripping,
  enforced everywhere with a strict `^[A-Z0-9_]{3,20}$` allowlist (client
  keystroke filter in onboarding.tsx + shared normalizer used consistently
  across api-server's routes and ws/manager.ts). Verified independently:
  `tsc --noEmit` clean on both api-server and ghostface, api-server's
  vitest suite 53/1/0 (passed/skipped/failed), and a prod query
  (`SELECT user_id FROM identity_keys WHERE user_id !~
  '^[A-Z0-9_]{3,20}$'`) returned **zero rows** — no existing aliases
  needed grandfathering. Committed this session.

- **GF-01 counsel email — STILL UNSENT, highest priority.** Draft is
  ready (in chat history); ask Cowork to regenerate it. Send from Benji's
  iCloud address now — do NOT wait on the ghostface.co.nz mailbox. Asks
  two questions: US EAR self-classification vs CCATS, AND NZ strategic-
  goods / MFAT permit vs Wassenaar mass-market exemption. Attach the
  research memo + crypto inventory (in Benji's claude.ai project, not this
  repo). kdfRkPQ (bespoke KDF from standard primitives) is the crux for
  both regimes.
- **Account lockouts:** Google account locked; CrazyDomains (registrar for
  ghostface.co.nz) locked. Vercel is reachable (via Google device). Action:
  add a 2nd login method to Vercel before the Google session drops; start
  CrazyDomains ID recovery; CHECK DOMAIN EXPIRY (couldn't read whois from
  sandbox) — a locked registrar + expiring domain = losing the domain +
  api.ghostface.co.nz with it.
- **Company email setup — DONE (19 Aug):** iCloud Custom Email Domain for
  ghostface.co.nz verified; DNS records live in Vercel panel. Confirm the
  addresses (benjamin@ / support@ / legal@) exist and do one test-send to
  benjamin@ to prove delivery. Use benjamin@ghostface.co.nz on the counsel
  email from here on.
- ⚠ **Vercel access token was pasted into chat this session** (vcp_… ,
  redacted). Assistant refused to use it. Benji to REVOKE it (Vercel →
  Account Settings → Tokens) if not already done. Never paste secrets in
  chat; use a scoped, expiring token in a secrets store if automation is
  needed later.
- **Domain switch — VERIFIED SAME SERVICE (20 Aug), no eas.json change
  needed.** `api.ghostface.co.nz` and `api-server-production-b252.up.railway.app`
  are both domains on the same `api-server` service (Railway project
  `secure-ghost-chat-api`, confirmed via the Domains tab) — `/api/healthz`
  returns identical `{"status":"ok"}` on both. The earlier EAS submission
  401 (`8f390802...`) was root-caused separately: the upload/processing
  succeeded on Apple's side, but EAS's own status-polling loop outlived
  its ~20min App Store Connect JWT during a slow processing run — a
  client-side polling timeout, not a domain or credential problem.
- **Claude Code credits restored** — the prior out-of-credits block has
  cleared; this session ran normally.
- ⚠ **Ignored a suspicious command this session:**
  `curl -fsSL https://fx.sh/setup.sh | bash` — untrusted pipe-to-shell,
  not run. If it reappears, still don't.

## ✅ CLOSED INCIDENT — Postgres password rotation (2026-08-19)

## ✅ CLOSED INCIDENT — Postgres password rotation (2026-08-19)

Trigger: a password fragment leaked into a session's tool output. First
rotation attempt caused a degraded window (replicas fell back to
pgBackRest archive recovery; a transient wrong-node leader-lock reading
caused a pause + staged recovery). Cluster was fully recovered, then a
**second, clean rotation** was executed end-to-end with zero outage:
secrets-store write + read-back verify first, ALTER ROLE, PgBouncer
+13s / api-server +15s, then hand-edit patroni.yml + patronictl reload
on all three nodes (local trust auth means no restart needed — the
primary redeploy was never required). Final state verified: postgres-1
Leader/running TL4, postgres-2/3 streaming lag 0, live write test via
PgBouncer passed, api-server clean.

Durable facts:
- **Canonical credential location: secrets-store key
  `postgres-ha-cluster-password` (v1)** — with audit trail. Railway vars
  hold copies; the store is the source of truth.
- Topology: Patroni members are postgres-1 ("Postgres" service),
  postgres-2, postgres-3; **"Postgres HA" is the HAProxy/router, not a
  DB node**. Scope `postgres-ha`, 3× etcd, PgBouncer in front.
- Rotation runbook that works, zero-outage: secrets store first →
  ALTER ROLE → PgBouncer/api-server vars immediately (pre-staged) →
  per-node patroni.yml hand-edit + patronictl reload (NO redeploys, NO
  pause). Pause mode disables Patroni's own recovery — don't use it for
  rotations.
- Incident tmp scripts (artifacts/api-server/_*-tmp.*) deleted after
  close. The "public Patroni API domain" from an early readout could not
  be found on re-check — treat as misread, nothing to restrict.
- ✅ pg_dumpall backup cleanup done (19 Aug, Claude Code session): found
  and deleted `pre-rotation-dump-20260819.sql` (1.8MB cluster dump incl.
  role password hashes) + its `.stderr` sibling, sitting in Claude Code
  session `e968c7a2`'s scratchpad. Only one file turned up despite this
  note's original claim of two ("one per rotation") — exhaustive search
  of home, /tmp, /var, and every session scratchpad on this Mac found
  nothing else. If a second dump genuinely exists (different machine, or
  a session already cleaned up), it's still out there — flag to Benji.
- Seven `artifacts/api-server/_*-tmp.*` scripts are incident tooling from
  that session — untracked on purpose; delete after the incident closes.

## Crypto audit (docs at artifacts/ghostface/docs/AUDIT_FINDINGS.md)

Resolved, tested, pushed: **#1** (canonical AEAD AD), **#3** (PQ downgrade
rejection, REQUIRE_PQ), **#5** (CSPRNG chokepoint + boot assert),
**#6** (storage/message AD + migration tiers), **#7** (Stealth AD, GHX3,
permanent GHX2 decode), **#8** (Stealth passphrase required; decrypt keeps
default forever, default-key reveals labelled).

Open: **#2 and #4 — finding text was never delivered**; it exists only in
Benji's separate audit conversation on Claude.ai. Placeholders in
AUDIT_FINDINGS.md.

Test suite: `npm test` from `artifacts/ghostface/` — 89/89 at last run.
Typecheck: `npx tsc -p tsconfig.json --noEmit`, clean.

## Pre-ship gates for build 72 (all must pass before any EAS build)

1. **DB prekey check — PASSED 2026-08-19**: all 9 registered users have
   complete signing + PQ prekey material (query in the Claude Code
   session; re-run if new registrations happen before shipping).
2. **CSPRNG on-device smoke test — NOT DONE**: physical iOS + Android,
   clean install, verify clean boot (assert runs before router entry);
   plan approved, see session notes.
3. **TestFlight coordination — release note drafted, not published**: AD
   wire cutover means old↔new builds cannot exchange messages at all;
   mixed-window messages unrecoverable. Note text lives in the Cowork
   session; testers must update together.

## Workflow between the two Claudes

Benji runs Claude Code for implementation and pastes its reports into the
Cowork session, which independently verifies (re-runs tests, reads diffs,
checks claims against source) and hands back a one-liner instruction.
Pattern: investigate → report → wait for approval → code → verify → commit
→ push. Keep it.

## Repo housekeeping (done 2026-08-18/19)

- vault2fa moved out to `~/Projects/vault2fa` (own git, own remote).
- mockup-sandbox / ghostface-1 / SETUP-READ-ME-FIRST.md archived to
  `~/Projects/_archive/ghostface-clean-2026-08-18/` (110 UI mockup files
  live in mockup-sandbox — recoverable).
- pnpm-workspace.yaml now lists packages explicitly, no globs.
- CSR untracked from git (`ce8319c`); gitignore covers it now.
- Branch: `feat/push-notifications`, in sync with origin at last check.

## Broader GF tracker context (from project memory)

GF-01 export compliance: blocked on counsel referral, chase after 3–4
working days. GF-02: build-71 ASC questionnaire screenshots → crypto
inventory. GF-07: iOS build pre-flight ready; `eas submit` forbidden
(GF-11 ASC API key broken + export block). Never run EAS builds without
explicit go-ahead — costs real money.
