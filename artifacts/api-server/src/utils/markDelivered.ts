import { db, messagesTable, departuresTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// Postgres caps a statement at 65535 bound parameters, and `inArray` binds one
// per id. Chunking keeps a pathological backlog (a dormant account inside the
// retention window, a client that never acks) from turning into a statement
// that fails outright — and keeps any single UPDATE's row lock short.
const MAX_IDS_PER_STATEMENT = 1_000;

function* chunked<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

/**
 * Flip a batch of queued messages to delivered.
 *
 * Previously each call site issued one UPDATE round-trip per message inside a
 * `Promise.all`, so a user returning to a large backlog fired that many
 * concurrent statements — all competing for the same connection pool as live
 * traffic. One statement per chunk instead.
 *
 * NOTE: "delivered" here still means the server *attempted* delivery, not that
 * the client confirmed receipt — the client never sends the ack the server
 * handles. Batching does not change that; see TRACKER.
 */
export async function markMessagesDelivered(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  for (const batch of chunked(ids, MAX_IDS_PER_STATEMENT)) {
    await db.update(messagesTable).set({ delivered: true }).where(inArray(messagesTable.id, batch));
  }
}

/** Same batching for queued self-destruct notices. */
export async function markDeparturesDelivered(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  for (const batch of chunked(ids, MAX_IDS_PER_STATEMENT)) {
    await db
      .update(departuresTable)
      .set({ delivered: true })
      .where(inArray(departuresTable.id, batch));
  }
}

export const __testing = { chunked, MAX_IDS_PER_STATEMENT };
