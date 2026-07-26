import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import type { QueueName } from "@muster/contracts";
import type { database } from "./index.ts";
import { newId } from "./ids.ts";
import { outboxEvents } from "./schema.ts";

type Transaction = Parameters<
  Parameters<ReturnType<typeof database>["transaction"]>[0]
>[0];

export interface OutboxWrite {
  organisationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  queueName: QueueName;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  traceId: string;
}

export function writeOutbox(tx: Transaction, event: OutboxWrite) {
  return tx.insert(outboxEvents).values({
    id: newId(),
    ...event,
  });
}

export async function claimOutboxBatch(
  db: ReturnType<typeof database>,
  limit = 100,
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(
        and(
          isNull(outboxEvents.dispatchedAt),
          lte(outboxEvents.availableAt, new Date()),
        ),
      )
      .orderBy(asc(outboxEvents.createdAt))
      .limit(Math.min(limit, 500))
      .for("update", { skipLocked: true });
    return rows;
  });
}

export async function markOutboxDispatched(
  db: ReturnType<typeof database>,
  id: string,
) {
  await db
    .update(outboxEvents)
    .set({ dispatchedAt: new Date(), attempts: sql`${outboxEvents.attempts} + 1` })
    .where(and(eq(outboxEvents.id, id), isNull(outboxEvents.dispatchedAt)));
}

export async function markOutboxFailed(
  db: ReturnType<typeof database>,
  id: string,
  error: string,
  retryAt: Date,
) {
  await db
    .update(outboxEvents)
    .set({
      attempts: sql`${outboxEvents.attempts} + 1`,
      lastError: error.slice(0, 2_000),
      availableAt: retryAt,
    })
    .where(eq(outboxEvents.id, id));
}
