import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
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

/** Products MCP can queue through the governed connector path. */
export type McpConnectorProduct = "kelpie" | "tawny" | "brolga";

function encryptionKey(): string {
  const key = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!key)
    throw new McpToolError(
      "not_configured",
      "Connector encryption is not configured.",
    );
  return key;
}

const PRODUCT_LABEL: Record<McpConnectorProduct, string> = {
  kelpie: "Kelpie",
  tawny: "Tawny",
  brolga: "Brolga",
};

function productLabel(product: McpConnectorProduct): string {
  return PRODUCT_LABEL[product];
}

async function findProductIntegration(
  db: Database,
  organisationId: string,
  product: McpConnectorProduct,
) {
  // An organisation may have reconfigured or rotated instances over time;
  // deterministically prefer the most recently touched, unarchived one
  // rather than an arbitrary row.
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
        eq(schema.integrationRecords.product, product),
        isNull(schema.integrationRecords.archivedAt),
      ),
    )
    .orderBy(desc(schema.integrationRecords.updatedAt))
    .limit(1);
  if (!integration || !["configured", "healthy"].includes(integration.status))
    throw new McpToolError(
      "not_configured",
      `${productLabel(product)} is not configured for this organisation.`,
    );
  return integration;
}

/**
 * Queues a product read through the existing governed connector path
 * (integration_query_runs -> outbox -> the unmodified worker's
 * processConnectorQuery), rather than opening a second execution path.
 */
export async function queueConnectorQuery(
  db: Database,
  subject: AuthorisationSubject,
  request: {
    product: McpConnectorProduct;
    templateKey: string;
    input: Record<string, unknown>;
    idempotencyKey: string;
    traceId: string;
    requestedByActorType: z.infer<typeof ActorTypeSchema>;
  },
): Promise<{ id: string; duplicate: boolean }> {
  const label = productLabel(request.product);
  const integration = await findProductIntegration(
    db,
    subject.organisationId,
    request.product,
  );
  const limits = ConnectorConfigurationSchema.shape.limits.parse(
    (integration.configuration as Record<string, unknown>).limits,
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
      `${label} query template is not enabled for this organisation.`,
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
    // Advisory lock scoped to this integration serialises the rate-limit
    // check with the insert, the same way appendAuditEvent serialises audit
    // sequence assignment per organisation — closing the race where
    // concurrent calls could each observe a sub-limit count and all insert.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${integration.id}, 1))`,
    );
    const [recent] = await tx
      .select({ value: count() })
      .from(schema.integrationQueryRuns)
      .where(
        and(
          eq(
            schema.integrationQueryRuns.organisationId,
            subject.organisationId,
          ),
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
        `${label} connector request rate limit reached.`,
      );
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
        product: request.product,
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
        product: request.product,
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

export interface ConnectorRunResult {
  status: string;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
}

/** @deprecated Prefer ConnectorRunResult — alias kept for existing imports. */
export type KelpieRunResult = ConnectorRunResult;

/**
 * Polls the authoritative run row for a bounded window. The MCP tool call
 * must return promptly; if the worker has not settled the run within the
 * window, the caller learns the run id is still processing instead of
 * blocking indefinitely.
 */
export async function pollConnectorQuery(
  db: Database,
  subject: AuthorisationSubject,
  runId: string,
  options: { timeoutMs: number; intervalMs: number },
  product: McpConnectorProduct = "kelpie",
): Promise<ConnectorRunResult> {
  const label = productLabel(product);
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
      throw new McpToolError(
        "not_found",
        `${label} query run does not exist.`,
      );
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
        `${label} query is still processing; retry shortly.`,
      );
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}

/** Kelpie-shaped wrapper: same governed path, product fixed to kelpie. */
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
  return queueConnectorQuery(db, subject, { ...request, product: "kelpie" });
}

export async function pollKelpieQuery(
  db: Database,
  subject: AuthorisationSubject,
  runId: string,
  options: { timeoutMs: number; intervalMs: number },
): Promise<ConnectorRunResult> {
  return pollConnectorQuery(db, subject, runId, options, "kelpie");
}
