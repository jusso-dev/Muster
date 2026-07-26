import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import { queueNames, type QueueName } from "@muster/contracts";
import { jsonLog, queuePolicies } from "@muster/config";
import {
  appendAuditEvent,
  claimOutboxBatch,
  closeDatabase,
  database,
  markOutboxDispatched,
  markOutboxFailed,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import {
  ConnectorConfigurationSchema,
  GovernedConnectorError,
  IntegrationActionRequestSchema,
  QueryTemplateSchema,
  decryptConnectorAuth,
  decryptConnectorPayload,
  executeGovernedActionRequest,
  executeGovernedQuery,
  redactUntrusted,
  type ConnectorAuth,
  type ConnectorConfiguration,
  type IntegrationActionRequest,
} from "@muster/integrations";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  maxRetriesPerRequest: null,
};
const queues = new Map<QueueName, Queue>();
const workers: Worker[] = [];
let ready = false;

for (const name of queueNames) {
  const policy = queuePolicies[name];
  queues.set(
    name,
    new Queue(name, {
      connection,
      defaultJobOptions: {
        attempts: policy.attempts,
        backoff: policy.backoff,
        removeOnComplete: { age: 86_400, count: 10_000 },
        removeOnFail: false,
      },
    }),
  );
}

const authoritativeProcessor: Processor = async (job) => {
  // Bodies contain identifiers only. Every processor reloads authoritative state
  // from PostgreSQL before side effects and records its idempotency key there.
  jsonLog("info", "job.started", {
    queue: job.queueName,
    jobId: job.id,
    traceId: job.data.traceId,
    organisationId: job.data.organisationId,
  });
  if (!job.data.organisationId || !job.data.traceId)
    throw new Error("Missing execution metadata");
  if (
    job.queueName === "muster-integrations" &&
    job.name === "connector.query.queued"
  ) {
    await processConnectorQuery(
      job.data.organisationId,
      job.data.aggregateId,
      job.data.traceId,
      job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
    );
  }
  if (
    job.queueName === "muster-integrations" &&
    job.name === "integration.action.queued"
  ) {
    await processIntegrationAction(
      job.data.organisationId,
      job.data.aggregateId,
      job.data.traceId,
    );
  }
  if (job.queueName === "muster-agents") {
    const response = await fetch(
      `${process.env.AGENT_GATEWAY_URL ?? "http://agent-gateway:3002"}/v1/runs/dispatch`,
      {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Agent gateway dispatch failed with ${response.status}`);
    }
  }
  return {
    processedAt: new Date().toISOString(),
    authoritativeStateLoaded: true,
  };
};

async function processConnectorQuery(
  organisationId: string,
  runId: string,
  traceId: string,
  finalAttempt: boolean,
) {
  const db = database();
  const [row] = await db
    .select({
      run: schema.integrationQueryRuns,
      integration: schema.integrationRecords,
      template: schema.integrationQueryTemplates,
      credential: schema.integrationConnectorCredentials,
      actor: schema.actors,
    })
    .from(schema.integrationQueryRuns)
    .innerJoin(
      schema.integrationRecords,
      and(
        eq(schema.integrationRecords.organisationId, organisationId),
        eq(
          schema.integrationRecords.id,
          schema.integrationQueryRuns.integrationId,
        ),
      ),
    )
    .innerJoin(
      schema.integrationQueryTemplates,
      and(
        eq(schema.integrationQueryTemplates.organisationId, organisationId),
        eq(
          schema.integrationQueryTemplates.id,
          schema.integrationQueryRuns.templateId,
        ),
      ),
    )
    .innerJoin(
      schema.integrationConnectorCredentials,
      and(
        eq(
          schema.integrationConnectorCredentials.organisationId,
          organisationId,
        ),
        eq(
          schema.integrationConnectorCredentials.integrationId,
          schema.integrationQueryRuns.integrationId,
        ),
      ),
    )
    .innerJoin(
      schema.actors,
      and(
        eq(schema.actors.organisationId, organisationId),
        eq(schema.actors.id, schema.integrationQueryRuns.requestedByActorId),
      ),
    )
    .where(
      and(
        eq(schema.integrationQueryRuns.organisationId, organisationId),
        eq(schema.integrationQueryRuns.id, runId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Authoritative connector query state not found");
  if (row.run.status === "succeeded") return;
  const definition = QueryTemplateSchema.parse(row.template.definition);
  const capabilities = Array.isArray(row.actor.capabilityAssignments)
    ? row.actor.capabilityAssignments
    : [];
  if (!capabilities.includes(definition.requiredCapability))
    throw new Error("Connector capability was revoked before execution");
  const key = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!key) throw new Error("Connector encryption is not configured");
  const auth = decryptConnectorAuth(row.credential.encryptedCredential, key);
  const { authType: _storedAuthType, ...storedConfiguration } = row.integration
    .configuration as Record<string, unknown>;
  const configuration = ConnectorConfigurationSchema.parse({
    ...storedConfiguration,
    auth,
  });
  await db
    .update(schema.integrationQueryRuns)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.integrationQueryRuns.organisationId, organisationId),
        eq(schema.integrationQueryRuns.id, runId),
      ),
    );
  try {
    const storedInput = row.run.input as { envelope?: unknown };
    if (typeof storedInput.envelope !== "string")
      throw new GovernedConnectorError(
        "invalid_input",
        "Connector input envelope is missing",
      );
    const result = await executeGovernedQuery({
      configuration,
      auth,
      template: definition,
      values: decryptConnectorPayload(storedInput.envelope, key) as Record<
        string,
        unknown
      >,
    });
    await db.transaction(async (tx) => {
      await tx
        .update(schema.integrationQueryRuns)
        .set({
          status: "succeeded",
          result: redactUntrusted(result.data),
          responseMetadata: result.metadata,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.integrationQueryRuns.organisationId, organisationId),
            eq(schema.integrationQueryRuns.id, runId),
          ),
        );
      await tx
        .update(schema.integrationRecords)
        .set({
          status: "healthy",
          health: {
            status: "healthy",
            checkedAt: new Date().toISOString(),
            lastQueryRunId: runId,
          },
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.integrationRecords.organisationId, organisationId),
            eq(schema.integrationRecords.id, row.integration.id),
          ),
        );
      await appendAuditEvent(tx, {
        organisationId,
        actorId: row.actor.id,
        actorType: row.actor.actorType,
        action: "connector.query.succeeded",
        targetType: "integration_query",
        targetId: runId,
        metadata: {
          integrationId: row.integration.id,
          templateKey: definition.key,
          templateVersion: definition.version,
          ...result.metadata,
        },
        traceId,
      });
      const requestMetadata =
        row.run.requestMetadata &&
        typeof row.run.requestMetadata === "object" &&
        !Array.isArray(row.run.requestMetadata)
          ? (row.run.requestMetadata as Record<string, unknown>)
          : {};
      if (typeof requestMetadata.roomId === "string") {
        const messageId = newId();
        const plainText = `${row.integration.displayName} ${definition.displayName} completed with ${result.metadata.records} bounded records. External content is untrusted evidence.`;
        await tx
          .insert(schema.messages)
          .values({
            id: messageId,
            organisationId,
            roomId: requestMetadata.roomId,
            authorActorId: row.actor.id,
            messageType: "query-result",
            document: {
              type: "integration-query-result",
              queryRunId: runId,
              integrationId: row.integration.id,
              templateKey: definition.key,
              records: result.metadata.records,
              trust: "untrusted-evidence",
              ...(typeof requestMetadata.taskId === "string"
                ? { taskId: requestMetadata.taskId }
                : {}),
            },
            plainText,
            dataClassification: "internal",
            idempotencyKey: `connector.query.message:${runId}`,
          })
          .onConflictDoNothing();
        await writeOutbox(tx, {
          organisationId,
          eventType: "room.message.created",
          aggregateType: "message",
          aggregateId: messageId,
          queueName: "muster-outbox",
          payload: { messageId, roomId: requestMetadata.roomId },
          idempotencyKey: `room.message.created:connector.query.message:${runId}`,
          traceId,
        });
      }
    });
    await maybeQueueJessieAnalysis(organisationId, runId, traceId);
  } catch (error) {
    const failure =
      error instanceof GovernedConnectorError
        ? error
        : new GovernedConnectorError(
            "source_unavailable",
            "Connector query failed safely",
          );
    await db.transaction(async (tx) => {
      await tx
        .update(schema.integrationQueryRuns)
        .set({
          status: "failed",
          errorCode: failure.code,
          errorMessage: failure.message,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.integrationQueryRuns.organisationId, organisationId),
            eq(schema.integrationQueryRuns.id, runId),
          ),
        );
      await tx
        .update(schema.integrationRecords)
        .set({
          status: "degraded",
          health: {
            status: "degraded",
            checkedAt: new Date().toISOString(),
            errorCode: failure.code,
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.integrationRecords.organisationId, organisationId),
            eq(schema.integrationRecords.id, row.integration.id),
          ),
        );
      await appendAuditEvent(tx, {
        organisationId,
        actorId: row.actor.id,
        actorType: row.actor.actorType,
        action: "connector.query.failed",
        targetType: "integration_query",
        targetId: runId,
        metadata: {
          integrationId: row.integration.id,
          templateKey: definition.key,
          errorCode: failure.code,
        },
        traceId,
      });
    });
    const retryable =
      failure.code === "rate_limited" || failure.code === "source_unavailable";
    if (retryable && !finalAttempt) throw failure;
    await maybeQueueJessieAnalysis(organisationId, runId, traceId);
  }
}

async function maybeQueueJessieAnalysis(
  organisationId: string,
  queryRunId: string,
  traceId: string,
) {
  const db = database();
  const [link] = await db
    .select({
      huntId: schema.huntQueries.huntId,
      agentRunId: schema.huntRuns.agentRunId,
    })
    .from(schema.huntQueries)
    .innerJoin(
      schema.huntRuns,
      and(
        eq(schema.huntRuns.organisationId, organisationId),
        eq(schema.huntRuns.id, schema.huntQueries.huntId),
      ),
    )
    .where(
      and(
        eq(schema.huntQueries.organisationId, organisationId),
        eq(schema.huntQueries.queryRunId, queryRunId),
      ),
    )
    .limit(1);
  if (!link) return;
  const statuses = await db
    .select({ status: schema.integrationQueryRuns.status })
    .from(schema.huntQueries)
    .innerJoin(
      schema.integrationQueryRuns,
      and(
        eq(schema.integrationQueryRuns.organisationId, organisationId),
        eq(schema.integrationQueryRuns.id, schema.huntQueries.queryRunId),
      ),
    )
    .where(
      and(
        eq(schema.huntQueries.organisationId, organisationId),
        eq(schema.huntQueries.huntId, link.huntId),
      ),
    );
  const terminal = new Set(["succeeded", "failed", "cancelled"]);
  if (
    statuses.length === 0 ||
    statuses.some((query) => !terminal.has(query.status))
  ) {
    return;
  }
  await db.transaction(async (tx) => {
    const [queued] = await tx
      .update(schema.agentRuns)
      .set({
        status: "queued",
        progress: { stage: "sources_collected", percent: 60 },
      })
      .where(
        and(
          eq(schema.agentRuns.organisationId, organisationId),
          eq(schema.agentRuns.id, link.agentRunId),
          eq(schema.agentRuns.status, "waiting_sources"),
        ),
      )
      .returning({
        id: schema.agentRuns.id,
        agentId: schema.agentRuns.agentId,
      });
    if (!queued) return;
    const succeeded = statuses.filter(
      (query) => query.status === "succeeded",
    ).length;
    await tx
      .update(schema.huntRuns)
      .set({ status: "analysing", updatedAt: new Date() })
      .where(
        and(
          eq(schema.huntRuns.organisationId, organisationId),
          eq(schema.huntRuns.id, link.huntId),
        ),
      );
    await tx
      .update(schema.tasks)
      .set({ agentRunStatus: "queued", updatedAt: new Date() })
      .where(
        and(
          eq(schema.tasks.organisationId, organisationId),
          eq(schema.tasks.agentRunId, link.agentRunId),
        ),
      );
    await tx.insert(schema.agentRunEvents).values({
      id: newId(),
      organisationId,
      runId: link.agentRunId,
      eventType: "sources_collected",
      message: "Governed hunt sources reached a terminal state",
      payload: {
        huntId: link.huntId,
        queryCount: statuses.length,
        succeeded,
        failed: statuses.length - succeeded,
      },
    });
    await writeOutbox(tx, {
      organisationId,
      eventType: "agent.run.queued",
      aggregateType: "agent_run",
      aggregateId: link.agentRunId,
      queueName: "muster-agents",
      payload: { runId: link.agentRunId, huntId: link.huntId },
      idempotencyKey: `agent.run.queued:jessie-hunt:${link.huntId}`,
      traceId,
    });
    await appendAuditEvent(tx, {
      organisationId,
      actorId: queued.agentId,
      actorType: "agent",
      action: "hunt.sources.collected",
      targetType: "hunt_run",
      targetId: link.huntId,
      metadata: {
        agentRunId: link.agentRunId,
        queryCount: statuses.length,
        succeeded,
      },
      traceId,
    });
  });
}

const TawnyActionResponseSchema = z
  .object({
    id: z.uuid(),
    agent_id: z.uuid(),
    action_type: z.string(),
    status: z.string(),
  })
  .passthrough();
const KelpieCaseSchema = z
  .object({
    id: z.string(),
    caseNumber: z.string(),
    status: z.string().optional(),
    summary: z.string().nullable().optional(),
    version: z.number().int().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

function actionMarker(idempotencyKey: string) {
  return `muster-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function executeIntegrationAction(
  request: IntegrationActionRequest,
  configuration: ConnectorConfiguration,
  auth: ConnectorAuth,
) {
  const marker = actionMarker(request.idempotencyKey);
  switch (request.operation) {
    case "tawny.isolate_host": {
      const path = `/api/agents/${encodeURIComponent(request.agentId)}/actions`;
      const existing = await executeGovernedActionRequest({
        configuration,
        auth,
        method: "GET",
        path,
        schema: z.array(
          z
            .object({
              id: z.uuid(),
              status: z.string(),
              payload: z.unknown(),
            })
            .passthrough(),
        ),
      });
      const duplicate = existing.find(
        (action) =>
          objectValue(action.payload).muster_idempotency_key === marker,
      );
      if (duplicate)
        return {
          externalId: duplicate.id,
          externalReference: request.agentId,
          externalStatus: duplicate.status,
          externalDuplicate: true,
        };
      const created = await executeGovernedActionRequest({
        configuration,
        auth,
        method: "POST",
        path,
        body: {
          action_type: "isolate_host",
          payload: {
            reason: request.reason,
            muster_idempotency_key: marker,
          },
        },
        schema: TawnyActionResponseSchema,
      });
      return {
        externalId: created.id,
        externalReference: created.agent_id,
        externalStatus: created.status,
        externalDuplicate: false,
      };
    }
    case "kelpie.case.create": {
      const existing = await executeGovernedActionRequest({
        configuration,
        auth,
        method: "GET",
        path: "/api/v1/cases?limit=200",
        schema: z.object({ cases: z.array(KelpieCaseSchema) }),
      });
      const duplicate = existing.cases.find((item) =>
        item.tags?.includes(marker),
      );
      if (duplicate)
        return {
          externalId: duplicate.id,
          externalReference: duplicate.caseNumber,
          externalStatus: duplicate.status ?? "open",
          externalDuplicate: true,
          caseId: duplicate.id,
        };
      const created = await executeGovernedActionRequest({
        configuration,
        auth,
        method: "POST",
        path: "/api/v1/cases",
        body: {
          title: request.title,
          summary: request.summary,
          severity: request.severity,
          tlp: request.tlp,
          pap: request.pap,
          classification: request.classification,
          tags: [...new Set([...request.tags, marker])],
        },
        schema: z.object({ id: z.string(), caseNumber: z.string() }),
      });
      return {
        externalId: created.id,
        externalReference: created.caseNumber,
        externalStatus: "open",
        externalDuplicate: false,
        caseId: created.id,
      };
    }
    case "kelpie.case.update": {
      const path = `/api/v1/cases/${encodeURIComponent(request.caseId)}`;
      const existing = await executeGovernedActionRequest({
        configuration,
        auth,
        method: "GET",
        path,
        schema: KelpieCaseSchema,
      });
      const alreadyApplied =
        (request.status === undefined || existing.status === request.status) &&
        (request.summary === undefined || existing.summary === request.summary);
      if (alreadyApplied)
        return {
          externalId: existing.id,
          externalReference: existing.caseNumber,
          externalStatus: existing.status ?? "open",
          externalDuplicate: true,
          caseId: existing.id,
        };
      const updated = await executeGovernedActionRequest({
        configuration,
        auth,
        method: "PATCH",
        path,
        body: {
          version: request.version ?? existing.version,
          ...(request.status ? { status: request.status } : {}),
          ...(request.summary !== undefined
            ? { summary: request.summary }
            : {}),
        },
        schema: KelpieCaseSchema,
      });
      return {
        externalId: updated.id,
        externalReference: updated.caseNumber,
        externalStatus: updated.status ?? request.status ?? "open",
        externalDuplicate: false,
        caseId: updated.id,
      };
    }
    case "kelpie.timeline.comment": {
      const path = `/api/v1/cases/${encodeURIComponent(request.caseId)}/comments`;
      const existing = await executeGovernedActionRequest({
        configuration,
        auth,
        method: "GET",
        path,
        schema: z.object({
          comments: z.array(
            z.object({ id: z.string(), body: z.string() }).passthrough(),
          ),
        }),
      });
      const duplicate = existing.comments.find((comment) =>
        comment.body.includes(`[${marker}]`),
      );
      if (duplicate)
        return {
          externalId: duplicate.id,
          externalReference: request.caseId,
          externalStatus: "recorded",
          externalDuplicate: true,
          caseId: request.caseId,
        };
      const evidence =
        request.evidenceReferences.length > 0
          ? `\nEvidence: ${request.evidenceReferences.join(", ")}`
          : "";
      const created = await executeGovernedActionRequest({
        configuration,
        auth,
        method: "POST",
        path,
        body: { body: `${request.body}${evidence}\n[${marker}]` },
        schema: z.object({ id: z.string() }).passthrough(),
      });
      return {
        externalId: created.id,
        externalReference: request.caseId,
        externalStatus: "recorded",
        externalDuplicate: false,
        caseId: request.caseId,
      };
    }
    case "kelpie.observable.add": {
      const path = `/api/v1/cases/${encodeURIComponent(request.caseId)}/observables`;
      const existing = await executeGovernedActionRequest({
        configuration,
        auth,
        method: "GET",
        path,
        schema: z.object({
          observables: z.array(
            z
              .object({
                id: z.string(),
                value: z.string(),
                tags: z.array(z.string()).optional(),
              })
              .passthrough(),
          ),
        }),
      });
      const duplicate = existing.observables.find((observable) =>
        observable.tags?.includes(marker),
      );
      if (duplicate)
        return {
          externalId: duplicate.id,
          externalReference: request.caseId,
          externalStatus: "recorded",
          externalDuplicate: true,
          caseId: request.caseId,
        };
      const created = await executeGovernedActionRequest({
        configuration,
        auth,
        method: "POST",
        path,
        body: {
          type: request.observableType,
          value: request.value,
          tlp: request.tlp,
          description: request.description,
          isIoc: request.isIoc,
          tags: [...new Set([...request.tags, marker])],
        },
        schema: z.object({ id: z.string() }),
      });
      return {
        externalId: created.id,
        externalReference: request.caseId,
        externalStatus: "recorded",
        externalDuplicate: false,
        caseId: request.caseId,
      };
    }
  }
}

function actionCapability(operation: IntegrationActionRequest["operation"]) {
  if (operation === "tawny.isolate_host") return "tawny.response.isolate_host";
  if (operation === "kelpie.case.create") return "kelpie.cases.create";
  return "kelpie.cases.update";
}

async function processIntegrationAction(
  organisationId: string,
  deliveryId: string,
  traceId: string,
) {
  const db = database();
  const [row] = await db
    .select({
      delivery: schema.integrationDeliveries,
      integration: schema.integrationRecords,
      credential: schema.integrationConnectorCredentials,
    })
    .from(schema.integrationDeliveries)
    .innerJoin(
      schema.integrationRecords,
      and(
        eq(schema.integrationRecords.organisationId, organisationId),
        eq(
          schema.integrationRecords.id,
          schema.integrationDeliveries.integrationId,
        ),
      ),
    )
    .innerJoin(
      schema.integrationConnectorCredentials,
      and(
        eq(
          schema.integrationConnectorCredentials.organisationId,
          organisationId,
        ),
        eq(
          schema.integrationConnectorCredentials.integrationId,
          schema.integrationDeliveries.integrationId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.integrationDeliveries.organisationId, organisationId),
        eq(schema.integrationDeliveries.id, deliveryId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Authoritative integration action not found");
  if (row.delivery.status === "succeeded") return;
  if (row.delivery.status === "awaiting_approval")
    throw new Error("Integration action still awaits approval");

  const metadata = z
    .object({
      actorId: z.uuid(),
      actorType: z.string(),
      envelope: z.string(),
      approvalId: z.uuid().optional(),
      roomId: z.uuid().optional(),
      taskId: z.uuid().optional(),
    })
    .passthrough()
    .parse(row.delivery.requestMetadata);
  const [actor] = await db
    .select()
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, organisationId),
        eq(schema.actors.id, metadata.actorId),
        eq(schema.actors.status, "active"),
      ),
    )
    .limit(1);
  if (!actor) throw new Error("Integration action actor is unavailable");
  const key = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!key) throw new Error("Connector encryption is not configured");
  const request = IntegrationActionRequestSchema.parse(
    decryptConnectorPayload(metadata.envelope, key),
  );
  if (request.integrationId !== row.integration.id)
    throw new Error("Integration action target changed");
  const requiredCapability = actionCapability(request.operation);
  if (
    !Array.isArray(actor.capabilityAssignments) ||
    !actor.capabilityAssignments.includes(requiredCapability)
  )
    throw new Error("Integration action capability was revoked");
  if (metadata.approvalId) {
    const [approval] = await db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.organisationId, organisationId),
          eq(schema.approvals.id, metadata.approvalId),
          eq(schema.approvals.status, "approved"),
        ),
      )
      .limit(1);
    const decisions = z
      .array(z.object({ actorId: z.uuid(), status: z.string() }))
      .safeParse(approval?.decisions);
    const approvedCount = decisions.success
      ? new Set(
          decisions.data
            .filter((decision) => decision.status === "approved")
            .map((decision) => decision.actorId),
        ).size
      : 0;
    if (!approval || approvedCount < approval.requiredApprovalCount)
      throw new Error("Executable integration approval is missing");
  }
  const auth = decryptConnectorAuth(row.credential.encryptedCredential, key);
  const { authType: _authType, ...storedConfiguration } = objectValue(
    row.integration.configuration,
  );
  const configuration = ConnectorConfigurationSchema.parse({
    ...storedConfiguration,
    auth,
  });
  await db
    .update(schema.integrationDeliveries)
    .set({
      status: "running",
      attemptCount: sql`${schema.integrationDeliveries.attemptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.integrationDeliveries.organisationId, organisationId),
        eq(schema.integrationDeliveries.id, deliveryId),
      ),
    );

  try {
    const result = await executeIntegrationAction(request, configuration, auth);
    await db.transaction(async (tx) => {
      const safeResult = redactUntrusted({
        externalId: result.externalId,
        externalReference: result.externalReference,
        externalStatus: result.externalStatus,
        externalDuplicate: result.externalDuplicate,
        completedAt: new Date().toISOString(),
      });
      await tx
        .update(schema.integrationDeliveries)
        .set({
          status: "succeeded",
          responseMetadata: safeResult,
          error: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.integrationDeliveries.organisationId, organisationId),
            eq(schema.integrationDeliveries.id, deliveryId),
          ),
        );
      await tx
        .update(schema.integrationRecords)
        .set({
          status: "healthy",
          health: {
            status: "healthy",
            checkedAt: new Date().toISOString(),
            lastDeliveryId: deliveryId,
          },
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.integrationRecords.organisationId, organisationId),
            eq(schema.integrationRecords.id, row.integration.id),
          ),
        );
      await tx
        .insert(schema.integrationEntities)
        .values({
          id: newId(),
          organisationId,
          integrationId: row.integration.id,
          entityType: request.operation,
          externalId: result.externalId,
          displayName: result.externalReference,
          status: result.externalStatus,
          posture: {
            deliveryId,
            trust: "untrusted-evidence",
            duplicateSuppressed: result.externalDuplicate,
          },
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            schema.integrationEntities.organisationId,
            schema.integrationEntities.integrationId,
            schema.integrationEntities.entityType,
            schema.integrationEntities.externalId,
          ],
          set: {
            status: result.externalStatus,
            posture: {
              deliveryId,
              trust: "untrusted-evidence",
              duplicateSuppressed: result.externalDuplicate,
            },
            lastSeenAt: new Date(),
          },
        });
      if (
        request.operation === "kelpie.case.create" &&
        request.investigationId
      ) {
        await tx
          .update(schema.investigations)
          .set({
            linkedKelpieCaseId: result.caseId,
            status: "promoted",
            promotionDecision: {
              approvalId: metadata.approvalId,
              deliveryId,
              externalReference: result.externalReference,
            },
            lastActivityAt: new Date(),
            version: sql`${schema.investigations.version} + 1`,
          })
          .where(
            and(
              eq(schema.investigations.organisationId, organisationId),
              eq(schema.investigations.id, request.investigationId),
            ),
          );
      }
      if (metadata.taskId && request.operation === "kelpie.case.create") {
        await tx
          .update(schema.tasks)
          .set({ relatedCaseId: result.caseId, updatedAt: new Date() })
          .where(
            and(
              eq(schema.tasks.organisationId, organisationId),
              eq(schema.tasks.id, metadata.taskId),
            ),
          );
      }
      if (metadata.roomId) {
        const messageId = newId();
        const plainText = `${row.integration.displayName} ${request.operation} ${result.externalDuplicate ? "confirmed existing" : "completed"} as ${result.externalReference}. External content is untrusted evidence.`;
        await tx
          .insert(schema.messages)
          .values({
            id: messageId,
            organisationId,
            roomId: metadata.roomId,
            authorActorId: actor.id,
            messageType:
              request.operation === "tawny.isolate_host"
                ? "response-action"
                : "case-event",
            document: {
              type: "integration-action-result",
              deliveryId,
              operation: request.operation,
              externalId: result.externalId,
              externalReference: result.externalReference,
              trust: "untrusted-evidence",
              ...(metadata.taskId ? { taskId: metadata.taskId } : {}),
            },
            plainText,
            dataClassification: "internal",
            relatedCaseId: result.caseId ?? null,
            relatedInvestigationId:
              request.operation === "kelpie.case.create"
                ? (request.investigationId ?? null)
                : null,
            idempotencyKey: `integration.action.message:${deliveryId}`,
          })
          .onConflictDoNothing();
        await writeOutbox(tx, {
          organisationId,
          eventType: "room.message.created",
          aggregateType: "message",
          aggregateId: messageId,
          queueName: "muster-outbox",
          payload: { messageId, roomId: metadata.roomId },
          idempotencyKey: `room.message.created:integration.action:${deliveryId}`,
          traceId,
        });
      }
      if (metadata.approvalId) {
        await tx
          .update(schema.approvals)
          .set({ status: "executed", executedAt: new Date() })
          .where(
            and(
              eq(schema.approvals.organisationId, organisationId),
              eq(schema.approvals.id, metadata.approvalId),
            ),
          );
      }
      await appendAuditEvent(tx, {
        organisationId,
        actorId: actor.id,
        actorType: actor.actorType,
        action: "integration.action.succeeded",
        targetType: "integration_delivery",
        targetId: deliveryId,
        metadata: {
          integrationId: row.integration.id,
          operation: request.operation,
          externalId: result.externalId,
          externalDuplicate: result.externalDuplicate,
          approvalId: metadata.approvalId,
        },
        traceId,
      });
    });
  } catch (error) {
    const failure =
      error instanceof GovernedConnectorError
        ? error
        : new GovernedConnectorError(
            "source_unavailable",
            "Integration action failed safely",
          );
    const retryable =
      failure.code === "rate_limited" ||
      failure.code === "source_unavailable" ||
      failure.code === "timeout";
    await db.transaction(async (tx) => {
      await tx
        .update(schema.integrationDeliveries)
        .set({
          status: "failed",
          error: failure.message,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.integrationDeliveries.organisationId, organisationId),
            eq(schema.integrationDeliveries.id, deliveryId),
          ),
        );
      await tx
        .update(schema.integrationRecords)
        .set({
          status: "degraded",
          health: {
            status: "degraded",
            checkedAt: new Date().toISOString(),
            errorCode: failure.code,
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.integrationRecords.organisationId, organisationId),
            eq(schema.integrationRecords.id, row.integration.id),
          ),
        );
      if (metadata.approvalId && !retryable) {
        await tx
          .update(schema.approvals)
          .set({ status: "failed" })
          .where(
            and(
              eq(schema.approvals.organisationId, organisationId),
              eq(schema.approvals.id, metadata.approvalId),
            ),
          );
      }
      await appendAuditEvent(tx, {
        organisationId,
        actorId: actor.id,
        actorType: actor.actorType,
        action: "integration.action.failed",
        targetType: "integration_delivery",
        targetId: deliveryId,
        metadata: {
          integrationId: row.integration.id,
          operation: request.operation,
          errorCode: failure.code,
          approvalId: metadata.approvalId,
        },
        traceId,
      });
    });
    if (retryable) throw failure;
  }
}

for (const name of queueNames.filter((queue) => queue !== "muster-outbox")) {
  const policy = queuePolicies[name];
  const workerOptions = {
    connection,
    concurrency: policy.concurrency,
    lockDuration: Math.min(policy.timeoutMs, 300_000),
    ...(policy.rateLimit ? { limiter: policy.rateLimit } : {}),
  };
  const worker = new Worker(name, authoritativeProcessor, workerOptions);
  worker.on("completed", (job) =>
    jsonLog("info", "job.completed", { queue: name, jobId: job.id }),
  );
  worker.on("failed", (job, error) =>
    jsonLog("error", "job.failed", {
      queue: name,
      jobId: job?.id,
      error: error.message,
    }),
  );
  workers.push(worker);
}

async function dispatchOutbox() {
  const db = database();
  const events = await claimOutboxBatch(db, 100);
  for (const event of events) {
    try {
      const queue = queues.get(event.queueName as QueueName);
      if (!queue) throw new Error(`Unknown outbox queue ${event.queueName}`);
      const policy = queuePolicies[event.queueName as QueueName];
      const options: JobsOptions = {
        jobId: event.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, "_"),
        attempts: policy.attempts,
        backoff: policy.backoff,
      };
      await queue.add(
        event.eventType,
        {
          outboxEventId: event.id,
          organisationId: event.organisationId,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          traceId: event.traceId,
        },
        options,
      );
      await markOutboxDispatched(db, event.id);
    } catch (error) {
      const attempt = event.attempts + 1;
      const retryMs = Math.min(300_000, 1_000 * 2 ** attempt);
      await markOutboxFailed(
        database(),
        event.id,
        error instanceof Error ? error.message : "dispatch failed",
        new Date(Date.now() + retryMs),
      );
    }
  }
}

const dispatcher = setInterval(() => void dispatchOutbox(), 1_000);
dispatcher.unref();
await dispatchOutbox();
ready = true;

const healthServer = createServer((request, response) => {
  if (request.url === "/metrics") {
    response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    response.end(
      `muster_worker_ready ${ready ? 1 : 0}\nmuster_worker_queues ${queueNames.length}\n`,
    );
    return;
  }
  response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      status: ready ? "ready" : "starting",
      queues: queueNames,
    }),
  );
});
healthServer.listen(Number(process.env.WORKER_HEALTH_PORT ?? 3001));

async function shutdown(signal: string) {
  ready = false;
  jsonLog("info", "worker.shutdown", { signal });
  clearInterval(dispatcher);
  healthServer.close();
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  await closeDatabase();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
