import { createHash } from "crypto";
import * as https from "https";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, deviceTokensTable, vpnPeersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { toErrorMessage } from "../utils/error";
import { normalizeAlias } from "../utils/alias";
import { logger } from "../lib/logger";
import { RateLimiter, getIpKey } from "../lib/rateLimiter";

const router: IRouter = Router();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// See messages.ts for the reasoning: only failed auth charges this, so carrier
// NAT and our own VPN egress cannot make real users share one budget.
const authFailureGate = new RateLimiter({ windowMs: 60_000, max: 30, prefix: "authFail" });

/** Same bearer-device-token-vs-path-userId check used by push.ts/prekeys.ts. */
async function requireDeviceAuth(req: Request, res: Response, next: () => void): Promise<void> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  // Gate on prior failures from this address before the device-token lookup
  // below, so an unauthenticated flood cannot drive DB load. Only failures
  // charge it — see the note on authFailureGate.
  const ipKey = getIpKey(req);
  if (!(await authFailureGate.allowed(ipKey))) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  if (!token) {
    await authFailureGate.record(ipKey);
    res.status(401).json({ error: "Authorization: Bearer <token> header required" });
    return;
  }

  const normalizedUserId = normalizeAlias((req.params["userId"] as string) ?? "");
  if (!normalizedUserId) {
    res.status(400).json({ error: "userId must be 3-20 characters: A-Z, 0-9, underscore only" });
    return;
  }
  req.params["userId"] = normalizedUserId;

  const hash = hashToken(token);
  const [row] = await db
    .select()
    .from(deviceTokensTable)
    .where(and(eq(deviceTokensTable.userId, normalizedUserId), eq(deviceTokensTable.tokenHash, hash)));

  if (!row) {
    await authFailureGate.record(ipKey);
    res.status(403).json({ error: "Invalid or mismatched device token for userId" });
    return;
  }

  next();
}

// WireGuard base64 public key: 32 raw bytes -> 44 base64 chars, last char '='.
const WG_PUBKEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

const TUNNEL_SUBNET_PREFIX = "10.66.0."; // .1 is the server itself; peers get .2-.254
const TUNNEL_SUBNET_MIN = 2;
const TUNNEL_SUBNET_MAX = 254;

const limiter = new RateLimiter({ windowMs: 60 * 60 * 1000, max: 30, prefix: "vpnRegister" });


// Uses Node's built-in `https` module directly rather than global fetch —
// pinning the agent's self-signed cert via `ca` needs a Node https.Agent,
// and undici's fetch takes a `dispatcher` (from the separate `undici`
// package) not a plain `agent`, which would be a new dependency for one
// call. This avoids both that and a bare rejectUnauthorized:false bypass.
async function callAgent(method: "POST" | "DELETE", body: Record<string, string>): Promise<void> {
  const url = process.env.VPN_AGENT_URL?.trim();
  const secret = process.env.VPN_AGENT_SECRET?.trim();
  const cert = process.env.VPN_AGENT_CERT_PEM?.trim();
  if (!url || !secret || !cert) {
    throw new Error("VPN_AGENT_URL/VPN_AGENT_SECRET/VPN_AGENT_CERT_PEM are not configured");
  }
  const { hostname, port, pathname } = new URL(`${url}/peer`);
  const payload = JSON.stringify(body);

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        method,
        hostname,
        port: port || 443,
        path: pathname,
        ca: cert,
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 8_000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`VPN agent ${method} /peer failed: ${res.statusCode} ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("VPN agent request timed out")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function allocateTunnelIp(): Promise<string> {
  const rows = await db.select({ tunnelIp: vpnPeersTable.tunnelIp }).from(vpnPeersTable);
  const used = new Set(rows.map((r) => Number(r.tunnelIp.slice(TUNNEL_SUBNET_PREFIX.length))));
  for (let i = TUNNEL_SUBNET_MIN; i <= TUNNEL_SUBNET_MAX; i++) {
    if (!used.has(i)) return `${TUNNEL_SUBNET_PREFIX}${i}`;
  }
  throw new Error("VPN tunnel subnet exhausted (10.66.0.0/24)");
}

type VpnConfigResponse = {
  serverPublicKey: string;
  endpoint: string;
  tunnelIp: string;
  allowedIps: string;
  dns: string;
};

function buildConfigResponse(tunnelIp: string): VpnConfigResponse | null {
  const serverPublicKey = process.env.VPN_SERVER_PUBLIC_KEY?.trim();
  const endpoint = process.env.VPN_SERVER_ENDPOINT?.trim();
  if (!serverPublicKey || !endpoint) return null;
  return {
    serverPublicKey,
    endpoint,
    tunnelIp,
    allowedIps: "0.0.0.0/0, ::/0",
    dns: "1.1.1.1, 1.0.0.1",
  };
}

/**
 * Register (or re-register, on key rotation/reinstall) this device's
 * WireGuard tunnel. Body: { publicKey }. The client generates its own
 * keypair on-device and only ever sends the public half — see
 * lib/wireguard.ts on the mobile side. One peer per identity, mirroring
 * deviceTokensTable's one-device model.
 */
router.post("/vpn/:userId/register", requireDeviceAuth, async (req: Request, res: Response) => {
  // requireDeviceAuth has already proved the bearer token belongs to this
  // userId, so key the quota on the user rather than their address.
  if (!(await limiter.check(req.params["userId"] as string))) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  try {
    const userId = req.params["userId"] as string;
    const { publicKey } = req.body as { publicKey?: string };
    if (!publicKey || !WG_PUBKEY_PATTERN.test(publicKey)) {
      res.status(400).json({ error: "publicKey must be a valid WireGuard public key" });
      return;
    }

    const [existing] = await db.select().from(vpnPeersTable).where(eq(vpnPeersTable.userId, userId));

    if (existing && existing.publicKey === publicKey) {
      // Idempotent re-registration with the same key — just hand back the config.
      const config = buildConfigResponse(existing.tunnelIp);
      if (!config) {
        res.status(503).json({ error: "VPN server not configured" });
        return;
      }
      res.json(config);
      return;
    }

    const tunnelIp = existing?.tunnelIp ?? (await allocateTunnelIp());

    // Push the new peer before touching old state — if the agent call fails
    // we want to fail loudly with nothing changed, not leave the DB and the
    // live WireGuard interface disagreeing about who's a valid peer.
    await callAgent("POST", { publicKey, tunnelIp });

    if (existing && existing.publicKey !== publicKey) {
      // Key rotated for the same identity — remove the old peer from the
      // live interface so a stale key can't still connect.
      await callAgent("DELETE", { publicKey: existing.publicKey }).catch((err) =>
        logger.warn({ err, userId }, "Failed to remove superseded VPN peer from agent"),
      );
    }

    if (existing) {
      await db
        .update(vpnPeersTable)
        .set({ publicKey, tunnelIp, updatedAt: new Date() })
        .where(eq(vpnPeersTable.userId, userId));
    } else {
      await db.insert(vpnPeersTable).values({ userId, publicKey, tunnelIp });
    }

    const config = buildConfigResponse(tunnelIp);
    if (!config) {
      res.status(503).json({ error: "VPN server not configured" });
      return;
    }
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: toErrorMessage(err) });
  }
});

/** Re-fetch the current peer's config without re-registering (app reopened, needs to rebuild its tunnel config). */
router.get("/vpn/:userId/register", requireDeviceAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.params["userId"] as string;
    const [existing] = await db.select().from(vpnPeersTable).where(eq(vpnPeersTable.userId, userId));
    if (!existing) {
      res.status(404).json({ error: "No VPN peer registered for this device" });
      return;
    }
    const config = buildConfigResponse(existing.tunnelIp);
    if (!config) {
      res.status(503).json({ error: "VPN server not configured" });
      return;
    }
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: toErrorMessage(err) });
  }
});

/** Revoke this device's VPN access — removes the peer from the live interface and the DB. */
router.delete("/vpn/:userId/register", requireDeviceAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.params["userId"] as string;
    const [existing] = await db.select().from(vpnPeersTable).where(eq(vpnPeersTable.userId, userId));
    if (!existing) {
      res.json({ ok: true });
      return;
    }
    await callAgent("DELETE", { publicKey: existing.publicKey });
    await db.delete(vpnPeersTable).where(eq(vpnPeersTable.userId, userId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: toErrorMessage(err) });
  }
});

export default router;
