import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import type { ActorTypeSchema } from "@muster/contracts";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import {
  ConnectorConfigurationSchema,
  QueryTemplateSchema,
  encryptConnectorPayload,
} from "@muster/integrations";
import type { z } from "zod";
import { McpToolError } from "./errors.ts";

type Database = ReturnType<typeof database>;

function encryptionKey(): string {
  const key = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!key)
    throw new McpToolError(
      "not_configured",
      "Connector encryption is not configured.",
    );
  return key;
}

async function findKelpieIntegration(db: Database, organisationId: string) {
  // An organisation may have reconfigured or rotated Kelpie instances over
  // time; deterministically prefer the most recently touched, unarchived
  // one rather than an arbitrary row.
  const [integration] = await db
    .select({
      id: schema.integrationRecords.id,
      status: schema.integrationRecords.status,
      configuration: schema.integrationRecords.configuration,
    })
    .from(schema.integrationRecords)
    .where(
      and(
        eq(schema.integrationRecords.organisationId, organisationId),
        eq(schema.integrationRecords.product, "kelpie"),
        isNull(schema.integrationRecords.archivedAt),
      ),
    )
    .orderBy(desc(schema.integrationRecords.updatedAt))
    .limit(1);
  if (!integration || !["configured", "healthy"].includes(integration.status))
    throw new McpToolError(
      "not_configured",
      "Kelpie is not configured for this organisation.",
    );
  return integration;
}

/**
 * Queues a Kelpie read through the existing governed connector path
 * (integration_query_runs -> outbox -> the unmodified worker's
 * processConnectorQuery), rather than opening a second execution path.
 */
export async function queueKelpieQuery(
  db: Database,
  subject: AuthorisationSubject,
  request: {
    templateKey: string;
    input: Record<string, unknown>;
    idempotencyKey: string;
    traceId: string;
    requestedByActorType: z.infer<typeof ActorTypeSchema>;
  },
): Promise<{ id: string; duplicate: boolean }> {
  const integration = await findKelpieIntegration(db, subject.organisationId);
  const limits = ConnectorConfigurationSchema.shape.limits.parse(
    (integration.configuration as Record<string, unknown>).limits,
  );
  const [recent] = await db
    .select({ value: count() })
    .from(schema.integrationQueryRuns)
    .where(
      and(
        eq(schema.integrationQueryRuns.organisationId, subject.organisationId),
        eq(schema.integrationQueryRuns.integrationId, integration.id),
        gte(
          schema.integrationQueryRuns.createdAt,
          new Date(Date.now() - 60_000),
        ),
      ),
    );
  if ((recent?.value ?? 0) >= limits.requestsPerMinute)
    throw new McpToolError(
      "rate_limited",
      "Kelpie connector request rate limit reached.",
    );
  const [template] = await db
    .select()
    .from(schema.integrationQueryTemplates)
    .where(
      and(
        eq(
          schema.integrationQueryTemplates.organisationId,
          subject.organisationId,
        ),
        eq(schema.integrationQueryTemplates.integrationId, integration.id),
        eq(schema.integrationQueryTemplates.templateKey, request.templateKey),
        eq(schema.integrationQueryTemplates.enabled, true),
      ),
    )
    .orderBy(desc(schema.integrationQueryTemplates.version))
    .limit(1);
  if (!template)
    throw new McpToolError(
      "not_configured",
      "Kelpie query template is not enabled for this organisation.",
    );
  const definition = QueryTemplateSchema.parse(template.definition);
  requireCapability(subject, definition.requiredCapability);
  return db.transaction(async (tx) => {
    const [duplicate] = await tx
      .select({ id: schema.integrationQueryRuns.id })
      .from(schema.integrationQueryRuns)
      .where(
        and(
          eq(
            schema.integrationQueryRuns.organisationId,
            subject.organisationId,
          ),
          eq(
            schema.integrationQueryRuns.idempotencyKey,
            request.idempotencyKey,
          ),
        ),
      )
      .limit(1);
    if (duplicate) return { id: duplicate.id, duplicate: true };
    const id = newId();
    await tx.insert(schema.integrationQueryRuns).values({
      id,
      organisationId: subject.organisationId,
      integrationId: integration.id,
      templateId: template.id,
      requestedByActorId: subject.actorId,
      idempotencyKey: request.idempotencyKey,
      traceId: request.traceId,
      input: {
        envelope: encryptConnectorPayload(request.input, encryptionKey()),
      },
      requestMetadata: {
        templateKey: definition.key,
        templateVersion: definition.version,
        via: "mcp",
      },
    });
    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: request.requestedByActorType,
      action: "connector.query.queued",
      targetType: "integration_query",
      targetId: id,
      metadata: {
        integrationId: integration.id,
        templateKey: definition.key,
        templateVersion: definition.version,
        via: "mcp",
      },
      traceId: request.traceId,
    });
    await writeOutbox(tx, {
      organisationId: subject.organisationId,
      eventType: "connector.query.queued",
      aggregateType: "integration_query",
      aggregateId: id,
      queueName: "muster-integrations",
      payload: { queryRunId: id },
      idempotencyKey: `connector.query:${id}`,
      traceId: request.traceId,
    });
    return { id, duplicate: false };
  });
}

export interface KelpieRunResult {
  status: string;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Polls the authoritative run row for a bounded window. The MCP tool call
 * must return promptly; if the worker has not settled the run within the
 * window, the caller learns the run id is still processing instead of
 * blocking indefinitely.
 */
export async function pollKelpieQuery(
  db: Database,
  subject: AuthorisationSubject,
  runId: string,
  options: { timeoutMs: number; intervalMs: number },
): Promise<KelpieRunResult> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const [run] = await db
      .select({
        status: schema.integrationQueryRuns.status,
        result: schema.integrationQueryRuns.result,
        errorCode: schema.integrationQueryRuns.errorCode,
        errorMessage: schema.integrationQueryRuns.errorMessage,
      })
      .from(schema.integrationQueryRuns)
      .where(
        and(
          eq(
            schema.integrationQueryRuns.organisationId,
            subject.organisationId,
          ),
          eq(schema.integrationQueryRuns.id, runId),
        ),
      )
      .limit(1);
    if (!run)
      throw new McpToolError("not_found", "Kelpie query run does not exist.");
    if (run.status === "succeeded" || run.status === "failed")
      return {
        status: run.status,
        result: run.result,
        errorCode: run.errorCode,
        errorMessage: run.errorMessage,
      };
    if (Date.now() >= deadline)
      throw new McpToolError(
        "timeout",
        "Kelpie query is still processing; retry shortly.",
      );
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}
