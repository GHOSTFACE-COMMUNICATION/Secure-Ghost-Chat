import { db, invitesTable, pool } from "@workspace/db";
import { and, eq, isNull, lte } from "drizzle-orm";
import { WebSocket } from "ws";
import { connectedClients } from "../ws/manager";
import { normalizeAlias } from "../utils/alias";
import { logger } from "./logger";

const TICK_INTERVAL_MS = 5 * 60_000; // every 5 minutes
const INITIAL_DELAY_MS = 45_000; // give the server time to warm up
const MAX_PER_TICK = 500;
const EXPIRY_LOCK_KEY = 8831047293n;

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Deliver expired-invite notices to owners who are currently online.
 * Called by the scheduler tick. Offline users are handled by
 * deliverPendingInviteExpiries() in ws/manager.ts on their next connect.
 */
async function tick(): Promise<void> {
  if (running) return;
  running = true;

  const lockRes = await pool.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [EXPIRY_LOCK_KEY.toString()],
  );
  if (!lockRes.rows[0]?.locked) {
    running = false;
    return;
  }

  try {
    const now = new Date();
    const due = await db
      .select()
      .from(invitesTable)
      .where(
        and(
          eq(invitesTable.redeemed, false),
          lte(invitesTable.expiresAt, now),
          isNull(invitesTable.ownerNotifiedAt),
        ),
      )
      .limit(MAX_PER_TICK);

    if (due.length === 0) return;

    logger.info({ count: due.length }, "[inviteExpiry] Processing expired invites");

    for (const row of due) {
      const normalized = normalizeAlias(row.ownerAlias);
      const client = connectedClients.get(normalized);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify({ type: "invite-expired", code: row.code }));
          await db
            .update(invitesTable)
            .set({ ownerNotifiedAt: new Date() })
            .where(eq(invitesTable.id, row.id));
          logger.debug(
            { code: row.code, owner: normalized },
            "[inviteExpiry] Notified online owner",
          );
        } catch (err) {
          logger.warn({ err, code: row.code }, "[inviteExpiry] Failed to notify owner live");
        }
      }
      // Offline owners: leave ownerNotifiedAt null so deliverPendingInviteExpiries
      // picks them up the next time they authenticate.
    }
  } catch (err) {
    logger.error({ err }, "[inviteExpiry] Tick failed");
  } finally {
    await pool.query(`SELECT pg_advisory_unlock($1)`, [EXPIRY_LOCK_KEY.toString()]);
    running = false;
  }
}

export function startInviteExpiryScheduler(): void {
  if (timer) return;
  setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
  logger.info({ intervalMs: TICK_INTERVAL_MS }, "[inviteExpiry] Scheduler started");
}

export const __testing = { tick };
