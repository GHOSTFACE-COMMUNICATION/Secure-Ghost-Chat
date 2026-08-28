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
 * Delete a batch of messages the client has confirmed it decrypted and
 * persisted locally (the `msgAck` ws message). Deleting rather than flagging
 * is deliberate: a `delivered` boolean that gets set on send (not receipt)
 * is exactly the bug this replaces — see TRACKER's "delivered does not mean
 * delivered". A row's mere existence is now the "not yet confirmed" signal,
 * so there is nothing left to flag once the client has it.
 */
export async function deleteAckedMessages(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  for (const batch of chunked(ids, MAX_IDS_PER_STATEMENT)) {
    await db.delete(messagesTable).where(inArray(messagesTable.id, batch));
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
