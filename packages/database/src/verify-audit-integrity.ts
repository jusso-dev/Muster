import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { verifyAuditIntegrity } from "@muster/audit";
import { closeDatabase, database, schema } from "./index.ts";

const organisationIdResult = z
  .string()
  .uuid()
  .safeParse(process.env.MUSTER_AUDIT_ORGANISATION_ID);

if (!organisationIdResult.success) {
  throw new Error(
    "MUSTER_AUDIT_ORGANISATION_ID is required and must be a UUID",
  );
}
const organisationId = organisationIdResult.data;

try {
  const events = await database()
    .select({
      organisationId: schema.auditEvents.organisationId,
      sequence: schema.auditEvents.sequence,
      actorId: schema.auditEvents.actorId,
      actorType: schema.auditEvents.actorType,
      action: schema.auditEvents.action,
      targetType: schema.auditEvents.targetType,
      targetId: schema.auditEvents.targetId,
      previousHash: schema.auditEvents.previousHash,
      eventHash: schema.auditEvents.eventHash,
      metadata: schema.auditEvents.metadata,
      traceId: schema.auditEvents.traceId,
      createdAt: schema.auditEvents.createdAt,
    })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.organisationId, organisationId))
    .orderBy(asc(schema.auditEvents.sequence));

  const report = verifyAuditIntegrity(
    events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        organisationId,
        eventCount: events.length,
        verifiedAt: new Date().toISOString(),
        ...report,
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode =
    report.outcome === "strict-valid"
      ? 0
      : report.outcome === "legacy-compatible-not-strict"
        ? 2
        : 1;
} finally {
  await closeDatabase();
}
