import { Router, type IRouter, type Request, type Response } from "express";
import { db, messagesTable, identityKeysTable, deviceTokensTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createHash } from "crypto";
import { RateLimiter, getIpKey } from "../lib/rateLimiter";
import { normalizeAlias } from "../utils/alias";
import { toErrorMessage } from "../utils/error";
import { ensureDeliveryId } from "../utils/delivery";

const router: IRouter = Router();

// 120 message-pending polls per minute per IP (2/sec — ample for normal use)
const pendingPollLimiter = new RateLimiter({ windowMs: 60_000, max: 120 });

// 60 user-exists lookups per minute per IP (prevents alias enumeration)
const userExistsLimiter = new RateLimiter({ windowMs: 60_000, max: 60 });

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function getAuthedAlias(req: Request): Promise<string | null> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const alias = req.query.alias as string | undefined;
  if (!alias) return null;
  const normalizedAlias = normalizeAlias(alias);
  if (!normalizedAlias) return null;
  const hash = hashToken(token);
  const [row] = await db
    .select()
    .from(deviceTokensTable)
    .where(
      and(
        eq(deviceTokensTable.userId, normalizedAlias),
        eq(deviceTokensTable.tokenHash, hash),
      ),
    );
  return row ? normalizedAlias : null;
}

router.get("/users/exists/:alias", async (req: Request, res: Response) => {
  if (!userExistsLimiter.check(getIpKey(req))) {
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
  if (!pendingPollLimiter.check(getIpKey(req))) {
    return res.status(429).json({ error: "Too many requests" });
  }
  try {
    const alias = await getAuthedAlias(req);
    if (!alias) {
      return res.status(401).json({ error: "Authorization required. Pass alias as query param." });
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

    if (pending.length > 0) {
      await Promise.all(
        pending.map((m) =>
          db.update(messagesTable).set({ delivered: true }).where(eq(messagesTable.id, m.id)),
        ),
      );
    }

    return res.json({ messages: pending });
  } catch (err) {
    return res.status(500).json({ error: toErrorMessage(err) });
  }
});

export default router;
