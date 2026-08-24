#!/usr/bin/env bash
# Restrict the vpn-agent port (8443) to the api-server's Railway static egress
# IPs. Everything else on that port is dropped.
#
# Deliberately narrow: touches ONLY tcp/8443 via its own chain. SSH (22),
# WireGuard (51820/udp) and the INPUT policy are untouched, so this cannot
# lock anyone out — which is also why ufw is left disabled. To undo:
#
#   iptables -D INPUT -p tcp --dport 8443 -j VPNAGENT && iptables -F VPNAGENT && iptables -X VPNAGENT
#
# Idempotent: safe to re-run. Re-run it after changing the Railway static IPs,
# which happens if the service is moved to another region.
set -uo pipefail

# railway outbound-network static-ip status --service api-server
ALLOW=(
  127.0.0.1          # local healthchecks / on-box monitoring
  162.220.232.251
  152.55.177.181
  152.55.177.193
)

echo "== creating VPNAGENT chain =="
iptables -N VPNAGENT 2>/dev/null && echo "  created" || echo "  already existed"
iptables -F VPNAGENT
echo "  flushed"

for ip in "${ALLOW[@]}"; do
  iptables -A VPNAGENT -s "$ip" -j ACCEPT && echo "  allow $ip"
done
iptables -A VPNAGENT -j DROP && echo "  drop everything else"

echo "== wiring INPUT -> VPNAGENT for tcp/8443 =="
if iptables -C INPUT -p tcp --dport 8443 -j VPNAGENT 2>/dev/null; then
  echo "  jump already present"
else
  iptables -I INPUT -p tcp --dport 8443 -j VPNAGENT && echo "  jump inserted"
fi

echo
echo "== resulting VPNAGENT chain =="
iptables -L VPNAGENT -n --line-numbers
echo
echo "== INPUT =="
iptables -L INPUT -n --line-numbers
echo
echo "== local healthz (must still work) =="
curl -sS -k -m 5 https://127.0.0.1:8443/healthz || echo "  LOCAL HEALTHZ FAILED"
