import { desc, eq, sql } from "drizzle-orm";
import { hashAuditEvent } from "@muster/audit";
import type { ActorTypeSchema } from "@muster/contracts";
import type { z } from "zod";
import type { database } from "./index.ts";
import { newId } from "./ids.ts";
import { auditEvents } from "./schema.ts";

type Database = ReturnType<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface AuditWrite {
  organisationId: string;
  actorId: string;
  actorType: z.infer<typeof ActorTypeSchema>;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  traceId: string;
}

export async function appendAuditEvent(tx: Transaction, input: AuditWrite) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.organisationId}, 0))`,
  );
  const [previous] = await tx
    .select({
      sequence: auditEvents.sequence,
      eventHash: auditEvents.eventHash,
    })
    .from(auditEvents)
    .where(eq(auditEvents.organisationId, input.organisationId))
    .orderBy(desc(auditEvents.sequence))
    .limit(1);
  const createdAt = new Date();
  const sequence = (previous?.sequence ?? 0) + 1;
  const previousHash = previous?.eventHash ?? "0".repeat(64);
  const hashable = {
    organisationId: input.organisationId,
    sequence,
    actorId: input.actorId,
    actorType: input.actorType,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    previousHash,
    metadata: input.metadata ?? {},
    traceId: input.traceId,
    createdAt: createdAt.toISOString(),
  };
  const eventHash = hashAuditEvent(hashable);
  const id = newId();
  await tx.insert(auditEvents).values({
    id,
    ...input,
    metadata: input.metadata ?? {},
    sequence,
    previousHash,
    eventHash,
    createdAt,
  });
  return { id, sequence, eventHash };
}
