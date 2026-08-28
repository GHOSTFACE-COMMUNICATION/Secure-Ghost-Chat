import { Router, type IRouter, type Request, type Response } from "express";
import { db, messagesTable, identityKeysTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getAuthedAlias } from "../lib/auth";
import { RateLimiter, GlobalLimiter, getIpKey } from "../lib/rateLimiter";
import { normalizeAlias } from "../utils/alias";
import { toErrorMessage } from "../utils/error";
import { ensureDeliveryId } from "../utils/delivery";

const router: IRouter = Router();

// 120 message-pending polls per minute PER ALIAS (2/sec — ample for normal use).
// Keyed per user, not per IP: mobile carrier NAT puts thousands of subscribers
// behind one address, and our own VPN egresses them all from a single endpoint,
// so an IP key would have real users sharing one person's budget.
const pendingPollLimiter = new RateLimiter({ windowMs: 60_000, max: 120, prefix: "pendingPoll" });

// Failed-auth gate, per IP. Deliberately NOT a general request gate: a coarse
// per-IP ceiling sized to survive carrier NAT would have to be so high it
// protects nothing. Only requests that fail authentication charge this bucket,
// so legitimate NATed users never touch it, while an unauthenticated flood is
// cut off before it reaches the device-token lookup below.
const authFailureGate = new RateLimiter({ windowMs: 60_000, max: 30, prefix: "authFail" });

// 60 user-exists lookups per minute per IP (prevents alias enumeration).
// This endpoint is unauthenticated by nature — it IS the enumeration surface,
// so there is no alias to key on and it has to stay IP-keyed. Raised from 60 so
// a carrier NAT of real users does not trip it, with a global cap below to
// bound total enumeration regardless of how many addresses it comes from.
const userExistsLimiter = new RateLimiter({ windowMs: 60_000, max: 600, prefix: "userExists" });
const userExistsGlobal = new GlobalLimiter({ windowMs: 60_000, max: 6_000, prefix: "userExistsGlobal" });

router.get("/users/exists/:alias", async (req: Request, res: Response) => {
  if (!(await userExistsLimiter.check(getIpKey(req))) || !(await userExistsGlobal.check())) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const alias = normalizeAlias(req.params.alias as string);
    if (!alias) {
      return res.status(400).json({ error: "userId must be 3-20 characters: A-Z, 0-9, underscore only" });
    }
    const [row] = await db
      .select({ userId: identityKeysTable.userId, ikPublicKey: identityKeysTable.ikPublicKey })
      .from(identityKeysTable)
      .where(eq(identityKeysTable.userId, alias));

    if (row) {
      // Also hand back the opaque delivery token so a peer that already has a
      // session (e.g. a recipient replying) can address messages without
      // consuming one of the user's one-time prekeys via the bundle endpoint.
      // `ikPublicKey` lets a recipient bind a sealed-sender message's claimed
      // alias to its registered identity key (anti-spoofing) — it's public key
      // material, already exposed via the bundle, so this leaks nothing new.
      const deliveryId = await ensureDeliveryId(row.userId);
      return res.json({
        exists: true,
        alias: row.userId,
        deliveryId,
        ikPublicKey: row.ikPublicKey,
      });
    }
    return res.status(404).json({ exists: false });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

router.get("/messages/pending", async (req: Request, res: Response) => {
  const ipKey = getIpKey(req);
  // Gate on prior auth failures from this address before touching the DB.
  if (!(await authFailureGate.allowed(ipKey))) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const alias = await getAuthedAlias(req, "query");
    if (!alias) {
      await authFailureGate.record(ipKey);
      return res.status(401).json({ error: "Authorization required. Pass alias as query param." });
    }
    // Real quota, charged to the authenticated user rather than their address.
    if (!(await pendingPollLimiter.check(alias))) {
      return res.status(429).json({ error: "Too many requests" });
    }

    // Messages are addressed to the opaque delivery token, never the alias.
    const deliveryId = await ensureDeliveryId(alias);
    if (!deliveryId) {
      return res.json({ messages: [] });
    }

    const pending = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.toDeliveryId, deliveryId), eq(messagesTable.delivered, false)));

    // Not marked delivered here — this HTTP path has no ack of its own, and
    // flagging on a response the caller might never receive was exactly the
    // bug this removes (see TRACKER). A caller that reaches the client's
    // real decrypt path acks over the WS `msgAck` message instead, which
    // deletes the row; this endpoint only peeks. A pre-ack legacy client
    // (there is no ack path for it to speak) keeps re-fetching the same
    // backlog until it ages out via the purge job.
    return res.json({ messages: pending });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

export default router;
