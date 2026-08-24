# vpn-agent

WireGuard peer-management agent for the VPN box (`88.99.225.231`), called by
`artifacts/api-server/src/routes/vpn.ts` via `callAgent`.

Deployed to `/etc/vpn-agent/agent.py`, run by `vpn-agent.service` as root.
Reads its bearer secret from `/etc/vpn-agent/secret` and its TLS keypair from
`/etc/vpn-agent/{cert,key}.pem`; the api-server pins that cert via
`VPN_AGENT_CERT_PEM`.

**This file lives here so it is reviewable and version-controlled.** It was
previously only on the box, which is part of why the config-corruption bug
below survived unnoticed.

## Contract (defined by the caller, not by this file)

| Method | Path | Body | Auth |
|---|---|---|---|
| `POST` | `/peer` | `{"publicKey", "tunnelIp"}` | `Authorization: Bearer <secret>` |
| `DELETE` | `/peer` | `{"publicKey"}` | `Authorization: Bearer <secret>` |
| `GET` | `/healthz` | — | none |

Success is any 2xx. The api-server times out at 8s.

## Deploying

```
scp infra/vpn-agent/agent.py root@88.99.225.231:/etc/vpn-agent/agent.py.new
ssh root@88.99.225.231 'cp /etc/vpn-agent/agent.py /etc/vpn-agent/agent.py.bak-$(date +%F) \
  && mv /etc/vpn-agent/agent.py.new /etc/vpn-agent/agent.py \
  && systemctl restart vpn-agent'
```

Verify: `curl -k https://88.99.225.231:8443/healthz` -> `{"ok": true}`.

## What the 24 Aug rewrite fixed

1. **TLS was wrapped around the listening socket**, putting the handshake
   inside the single-threaded accept loop. One client that connected and
   stalled froze the server permanently — which is exactly what happened for
   29 hours from 23 Aug 07:19. TLS now happens per-connection on a worker
   thread.
2. **Single-threaded** `HTTPServer` with the default backlog of 5, which was
   full during the outage. Now threaded with a backlog of 128.
3. **No timeouts anywhere** — so "stalled" meant "forever". Handshake, request
   and `wg` invocation are all bounded now.
4. **No liveness signal.** `log_message` was suppressed and there was no `GET`
   handler, so systemd reported `active (running)` for 29 hours while the
   process served nothing. There is now a `/healthz` and errors are logged
   (never headers or bodies — the bearer token lives there).
5. **`remove_peer_from_conf` destroyed the config.** `re.split` consumes the
   newline before each `[Peer]`, and the old `"".join(kept)` never restored
   it, welding sections together (`ListenPort = 51820[Peer]`) into a file
   `wg-quick` cannot parse. It corrupted from the *second* peer onward and had
   never fired only because no peer had ever registered successfully. Found by
   testing the rewrite locally before deploying.
6. **The threading fix introduced a race** on that same read-modify-write, so
   config mutation is serialised under a lock, and writes are atomic
   (temp + `os.replace`) so a crash cannot truncate the file `wg-quick` reads
   at boot.

Verified locally before deploy: 7 concurrent stalled TLS connections (the
attack that caused the outage) while `/healthz` still answered in 3ms; 12
concurrent registrations producing exactly 12 intact `[Peer]` blocks with no
welding; auth rejecting missing and wrong tokens; idempotent re-registration;
and delete removing the peer cleanly.

## Firewall

`firewall.sh` restricts tcp/8443 to the api-server's Railway static outbound
IPs, plus localhost for healthchecks. It touches only that port, via its own
`VPNAGENT` chain — SSH, WireGuard and the `INPUT` policy are left alone, so it
cannot lock you out. That is also why `ufw` stays disabled on this box.

Deploy:

```
scp infra/vpn-agent/firewall.sh root@88.99.225.231:/etc/vpn-agent/firewall.sh
scp infra/vpn-agent/vpn-agent-firewall.service root@88.99.225.231:/etc/systemd/system/
ssh root@88.99.225.231 'chmod +x /etc/vpn-agent/firewall.sh \
  && systemctl daemon-reload \
  && systemctl enable --now vpn-agent-firewall'
```

The rules are plain iptables (`iptables-nft` on this box — it writes into
`table ip filter`, alongside the NAT rules wg-quick installs). They do **not**
survive a reboot on their own, which is what the systemd unit is for.

**Re-run `firewall.sh` if the Railway static IPs change** — they are reassigned
when the service moves region. Current values come from:

```
railway outbound-network static-ip status --service api-server
```
