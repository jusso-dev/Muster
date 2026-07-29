import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import { redactForObservation } from "@muster/config";
import { database, schema } from "@muster/database";
import { z } from "zod";
import type { AuditEventSummary } from "@/types/os";

const ListAuditSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().trim().max(200).optional(),
  actorId: z.string().uuid().optional(),
  targetType: z.string().trim().max(120).optional(),
  targetId: z.string().trim().max(200).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  until: z.iso.datetime({ offset: true }).optional(),
  q: z.string().trim().max(200).optional(),
});

function redactMetadata(value: unknown): Record<string, unknown> {
  const redacted = redactForObservation(value);
  if (redacted && typeof redacted === "object" && !Array.isArray(redacted)) {
    return redacted as Record<string, unknown>;
  }
  return {};
}

export async function listAuditEvents(
  subject: AuthorisationSubject,
  rawQuery: Record<string, string | undefined>,
): Promise<{ records: AuditEventSummary[]; limit: number; truncated: boolean }> {
  requireCapability(subject, "administration.manage");
  const args = ListAuditSchema.parse({
    limit: rawQuery.limit,
    action: rawQuery.action || undefined,
    actorId: rawQuery.actorId || undefined,
    targetType: rawQuery.targetType || undefined,
    targetId: rawQuery.targetId || undefined,
    since: rawQuery.since || undefined,
    until: rawQuery.until || undefined,
    q: rawQuery.q || undefined,
  });

  const db = database();
  const conditions = [
    eq(schema.auditEvents.organisationId, subject.organisationId),
  ];
  if (args.action) conditions.push(eq(schema.auditEvents.action, args.action));
  if (args.actorId)
    conditions.push(eq(schema.auditEvents.actorId, args.actorId));
  if (args.targetType)
    conditions.push(eq(schema.auditEvents.targetType, args.targetType));
  if (args.targetId)
    conditions.push(eq(schema.auditEvents.targetId, args.targetId));
  if (args.since)
    conditions.push(gte(schema.auditEvents.createdAt, new Date(args.since)));
  if (args.until)
    conditions.push(lte(schema.auditEvents.createdAt, new Date(args.until)));
  if (args.q) {
    const pattern = `%${args.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conditions.push(
      sql`(${schema.auditEvents.action} ilike ${pattern} or ${schema.auditEvents.targetType} ilike ${pattern} or ${schema.auditEvents.targetId} ilike ${pattern} or ${schema.auditEvents.traceId} ilike ${pattern})`,
    );
  }

  const rows = await db
    .select({
      id: schema.auditEvents.id,
      sequence: schema.auditEvents.sequence,
      actorId: schema.auditEvents.actorId,
      actorType: schema.auditEvents.actorType,
      actorName: schema.actors.displayName,
      action: schema.auditEvents.action,
      targetType: schema.auditEvents.targetType,
      targetId: schema.auditEvents.targetId,
      metadata: schema.auditEvents.metadata,
      ipAddress: schema.auditEvents.ipAddress,
      traceId: schema.auditEvents.traceId,
      createdAt: schema.auditEvents.createdAt,
      eventHash: schema.auditEvents.eventHash,
    })
    .from(schema.auditEvents)
    .leftJoin(
      schema.actors,
      and(
        eq(schema.actors.id, schema.auditEvents.actorId),
        eq(schema.actors.organisationId, schema.auditEvents.organisationId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.auditEvents.sequence))
    .limit(args.limit);

  const records: AuditEventSummary[] = rows.map((row) => {
    const metadata = redactMetadata(row.metadata);
    const outcome =
      typeof metadata.outcome === "string"
        ? metadata.outcome
        : typeof metadata.result === "string"
          ? metadata.result
          : null;
    return {
      id: row.id,
      sequence: row.sequence,
      actorId: row.actorId,
      actorType: row.actorType,
      actorName: row.actorName,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      outcome,
      metadata,
      ipAddress: row.ipAddress,
      traceId: row.traceId,
      createdAt: row.createdAt.toISOString(),
      eventHash: row.eventHash,
    };
  });

  return {
    records,
    limit: args.limit,
    truncated: records.length === args.limit,
  };
}
