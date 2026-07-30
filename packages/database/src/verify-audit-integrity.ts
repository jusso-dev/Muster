import { asc, eq } from "drizzle-orm";
import { verifyAuditIntegrity } from "@muster/audit";
import {
  auditIntegrityExitCodes,
  describeAuditIntegrity,
  resolveAuditOrganisationId,
  type AuditOrganisationChoice,
} from "./audit-integrity-cli.ts";
import { closeDatabase, database, schema } from "./index.ts";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

async function organisationChoices(): Promise<AuditOrganisationChoice[]> {
  try {
    return await database()
      .select({
        id: schema.organisations.id,
        slug: schema.organisations.slug,
        name: schema.organisations.name,
      })
      .from(schema.organisations)
      .limit(25);
  } catch {
    // Listing is only an aid for the usage message; an unreachable database
    // must not replace the reason the operator is being shown it.
    return [];
  }
}

async function main() {
  const candidate =
    arg("organisation") ?? process.env.MUSTER_AUDIT_ORGANISATION_ID;
  const resolved = resolveAuditOrganisationId(
    candidate,
    candidate ? [] : await organisationChoices(),
  );
  if ("usage" in resolved) {
    process.stderr.write(`${resolved.usage}\n`);
    process.exitCode = auditIntegrityExitCodes.usage;
    return;
  }
  const { organisationId } = resolved;

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
  process.stderr.write(`${describeAuditIntegrity(report)}\n`);
  process.exitCode = auditIntegrityExitCodes[report.outcome];
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Audit verification could not run: ${
      error instanceof Error ? error.message : "unknown error"
    }\n`,
  );
  process.exitCode = auditIntegrityExitCodes.unavailable;
} finally {
  await closeDatabase();
}
