#!/usr/bin/env python3
"""
Minimal WireGuard peer-management agent. Exposes exactly two operations over
HTTPS, authenticated with a bearer secret read from /etc/vpn-agent/secret:
  POST   /peer   {"publicKey": "...", "tunnelIp": "10.66.0.X"}  -> add/update peer
  DELETE /peer    {"publicKey": "..."}                          -> remove peer
  GET    /healthz                                               -> liveness probe
Mutates the live `wg0` interface via `wg set` and persists the change into
/etc/wireguard/wg0.conf so it survives a reboot (wg-quick re-reads that file).
Pure stdlib - no pip installs on this box.

Rewritten 24 Aug 2026 after the agent sat wedged for 29 hours. The previous
version wrapped TLS around the *listening* socket, which put the handshake
inline in the single-threaded accept loop: one client that connected and never
finished the handshake froze the whole server, permanently, while systemd
still reported active (running). See STATUS.md ACTIVE INCIDENT.
"""
import http.server
import json
import os
import re
import socket
import socketserver
import ssl
import subprocess
import sys
import threading
import hmac

SECRET = open("/etc/vpn-agent/secret").read().strip()
WG_CONF = "/etc/wireguard/wg0.conf"
PUBKEY_RE = re.compile(r"^[A-Za-z0-9+/]{42,44}=?=?$")
TUNNEL_IP_RE = re.compile(r"^10\.66\.0\.(\d{1,3})$")

# Every one of these existed as "no limit" before, which is why a single stalled
# client could hold the process forever.
HANDSHAKE_TIMEOUT_S = 10    # client must complete the TLS handshake in this
REQUEST_TIMEOUT_S = 15      # ...and then the request/response in this
WG_COMMAND_TIMEOUT_S = 10   # a hung `wg` must not pin a worker thread
MAX_BODY_BYTES = 8 * 1024   # Content-Length is attacker-controlled; bound it

# The config helpers below are read-modify-write on a single file. That was
# safe only because the old server was single-threaded — the fix for the hang
# is what makes this a race, so the mutation is serialised explicitly.
_conf_lock = threading.Lock()


def log(msg):
    """Deliberately never logs headers or bodies — the bearer token lives there.
    The old agent suppressed logging entirely, which is why 29 hours of serving
    nothing produced no signal at all."""
    print(msg, file=sys.stderr, flush=True)


def run(cmd):
    subprocess.run(cmd, check=True, timeout=WG_COMMAND_TIMEOUT_S)


def add_peer_to_conf(pubkey, tunnel_ip):
    remove_peer_from_conf(pubkey)  # idempotent: replace if re-registering
    with open(WG_CONF, "a") as f:
        f.write(f"\n[Peer]\nPublicKey = {pubkey}\nAllowedIPs = {tunnel_ip}/32\n")


def remove_peer_from_conf(pubkey):
    with open(WG_CONF) as f:
        content = f.read()
    parts = re.split(r"\n(?=\[Peer\])", content)
    kept = [p for p in parts if f"PublicKey = {pubkey}" not in p]
    # Rejoin with "\n". The split pattern CONSUMES the newline before each
    # [Peer], so the original '"".join(kept)' silently welded sections together
    # ("ListenPort = 51820[Peer]") and produced a wg0.conf that wg-quick cannot
    # parse. It corrupted from the second peer onward and was never hit only
    # because no peer had ever been registered successfully.
    _atomic_write(WG_CONF, "\n".join(kept).rstrip() + "\n")


def _atomic_write(path, text):
    """Write via temp file + rename. wg-quick reads this at boot, so a crash
    or full disk part-way through a plain write would leave the interface
    unable to come back up."""
    tmp = f"{path}.tmp"
    with open(tmp, "w") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


class Handler(http.server.BaseHTTPRequestHandler):
    def _authed(self):
        auth = self.headers.get("Authorization", "")
        token = auth[7:] if auth.startswith("Bearer ") else ""
        return hmac.compare_digest(token, SECRET)

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_BODY_BYTES:
            raise ValueError("body too large")
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw)

    def do_GET(self):
        # Unauthenticated on purpose: it reveals nothing beyond "this process is
        # answering", and a probe that needs the bearer secret is a probe nobody
        # will wire up. This is the signal that was missing while systemd
        # reported the wedged process as healthy.
        if self.path == "/healthz":
            return self._json(200, {"ok": True})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/peer" or not self._authed():
            return self._json(403 if self.path == "/peer" else 404, {"error": "forbidden"})
        try:
            data = self._body()
            pubkey = data["publicKey"]
            tunnel_ip = data["tunnelIp"]
            if not PUBKEY_RE.match(pubkey) or not TUNNEL_IP_RE.match(tunnel_ip):
                return self._json(400, {"error": "invalid publicKey or tunnelIp"})
            with _conf_lock:
                run(["wg", "set", "wg0", "peer", pubkey, "allowed-ips", f"{tunnel_ip}/32"])
                add_peer_to_conf(pubkey, tunnel_ip)
            log(f"peer added tunnelIp={tunnel_ip}")
            self._json(200, {"ok": True})
        except Exception as e:
            log(f"POST /peer failed: {type(e).__name__}: {e}")
            self._json(500, {"error": str(e)})

    def do_DELETE(self):
        if self.path != "/peer" or not self._authed():
            return self._json(403 if self.path == "/peer" else 404, {"error": "forbidden"})
        try:
            data = self._body()
            pubkey = data["publicKey"]
            if not PUBKEY_RE.match(pubkey):
                return self._json(400, {"error": "invalid publicKey"})
            with _conf_lock:
                run(["wg", "set", "wg0", "peer", pubkey, "remove"])
                remove_peer_from_conf(pubkey)
            log("peer removed")
            self._json(200, {"ok": True})
        except Exception as e:
            log(f"DELETE /peer failed: {type(e).__name__}: {e}")
            self._json(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        pass  # keep the peer bearer token etc. out of stray logs


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """Threaded, with the TLS handshake moved off the accept loop.

    The previous version did `ctx.wrap_socket(server.socket)` — wrapping the
    LISTENING socket. That makes every handshake part of accept(), so a client
    that opens a connection and stalls blocks all other clients forever. Here
    accept() only hands back a raw socket; the handshake happens in
    finish_request, which ThreadingMixIn already runs on a worker thread.
    """

    daemon_threads = True
    # Was the stdlib default of 5, and it was full (Recv-Q 6) during the outage.
    request_queue_size = 128
    allow_reuse_address = True

    def __init__(self, addr, handler, ctx):
        self.ctx = ctx
        super().__init__(addr, handler)

    def get_request(self):
        sock, addr = self.socket.accept()
        # Applies to the handshake below; tightened again once it succeeds.
        sock.settimeout(HANDSHAKE_TIMEOUT_S)
        return sock, addr

    def finish_request(self, request, client_address):
        try:
            tls = self.ctx.wrap_socket(request, server_side=True)
        except OSError as e:
            # A failed or abandoned handshake is expected background noise on a
            # public port — the internet scans it. Costs one worker thread for
            # at most HANDSHAKE_TIMEOUT_S and never touches the accept loop.
            log(f"handshake failed from {client_address[0]}: {type(e).__name__}")
            return
        try:
            tls.settimeout(REQUEST_TIMEOUT_S)
            self.RequestHandlerClass(tls, client_address, self)
        finally:
            try:
                tls.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            tls.close()


if __name__ == "__main__":
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain("/etc/vpn-agent/cert.pem", "/etc/vpn-agent/key.pem")
    server = Server(("0.0.0.0", 8443), Handler, ctx)
    log("vpn-agent listening on 0.0.0.0:8443 (threaded, per-connection TLS)")
    server.serve_forever()
