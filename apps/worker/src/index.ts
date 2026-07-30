import { createServer } from "node:http";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import {
  processSlackNotificationJob,
  slackHarnessMetrics,
  SlackGovernanceAdapter,
} from "@muster/agent-harness";
import {
  runSlackSocketMode,
  slackSocketMetrics,
} from "@muster/agent-harness/slack-socket";
import {
  queueNames,
  ReportManifestSchema,
  ResearchBriefSchema,
  type QueueName,
} from "@muster/contracts";
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
import { processSyntheticCleanupObjectDeletion } from "./synthetic-cleanup-object.ts";
import { processPackHandoffAccepted } from "./pack-handoff.ts";
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
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  matchesWatchlist,
  parseResearchFeed,
  ResearchFeedSchema,
  type ResearchFinding,
} from "./research-feed.ts";
import {
  finalResearchAttempt,
  researchRunIdempotencyKey,
  staleResearchEvidence,
} from "./research-scheduler.ts";
import { appendResearchTerminalMessage } from "./research-status.ts";
import { queueDueParkerReports } from "./parker-scheduler.ts";
import { processParkerReport } from "./parker-report.ts";
import {
  AgentDirectMessageDomainService,
  type DirectMessageInvocation,
} from "@muster/rooms";
import {
  capabilities,
  type AuthorisationSubject,
  type Capability,
} from "@muster/authz";

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
    job.queueName === "muster-maintenance" &&
    job.name === "research.schedule.tick"
  ) {
    await queueDueResearchRuns(
      job.data.organisationId,
      job.data.traceId,
      job.data.aggregateId,
    );
  }
  if (
    job.queueName === "muster-maintenance" &&
    job.name === "maintenance.synthetic_cleanup.object_delete.queued"
  ) {
    await processSyntheticCleanupObjectDeletion({
      organisationId: job.data.organisationId,
      aggregateType: job.data.aggregateType,
      aggregateId: job.data.aggregateId,
      traceId: job.data.traceId,
    });
  }
  if (
    job.queueName === "muster-maintenance" &&
    job.name === "research.run.queued"
  ) {
    await processResearchRun(
      job.data.organisationId,
      job.data.aggregateId,
      job.data.traceId,
      finalResearchAttempt(job.attemptsMade, job.opts.attempts ?? 1),
    );
  }
  if (
    job.queueName === "muster-notifications" &&
    (job.name === "slack.event.received" ||
      job.name === "agent.run.settled" ||
      job.name === "agent.run.progress" ||
      job.name === "pack_handoff.notice")
  ) {
    await processSlackNotificationJob(job.name, job.data.aggregateId);
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
  if (
    job.queueName === "muster-agents" &&
    job.name === "report.generate.queued"
  ) {
    await processParkerReport(
      job.data.organisationId,
      job.data.aggregateId,
      job.data.traceId,
      job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
    );
  }
  if (
    job.queueName === "muster-agents" &&
    job.name === "agent.direct_message.evaluate"
  ) {
    await processDirectMessageEvaluate(
      job.data.organisationId,
      job.data.aggregateId,
      job.data.traceId,
    );
  }
  if (
    job.queueName === "muster-agents" &&
    job.name === "pack_handoff.accepted"
  ) {
    await processPackHandoffAccepted(
      job.data.organisationId,
      job.data.aggregateId,
      job.data.traceId,
    );
  }
  if (
    job.queueName === "muster-agents" &&
    job.name !== "report.generate.queued" &&
    job.name !== "agent.direct_message.evaluate" &&
    // Dispatch is handled above; it queues its own agent.run.queued wake-up.
    job.name !== "pack_handoff.accepted"
  ) {
    const gatewayToken = process.env.MUSTER_AGENT_GATEWAY_TOKEN?.trim();
    if (!gatewayToken) throw new Error("Agent gateway token is not configured");
    const response = await fetch(
      `${process.env.AGENT_GATEWAY_URL ?? "http://agent-gateway:3002"}/v1/runs/dispatch`,
      {
        headers: {
          authorization: `Bearer ${gatewayToken}`,
          "x-muster-organisation-id": job.data.organisationId,
        },
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Agent gateway dispatch failed with ${response.status}`);
    }
  }
  if (
    job.queueName === "muster-notifications" &&
    job.name === "report.email.queued"
  ) {
    await processReportEmail(
      job.data.organisationId,
      job.data.aggregateId,
      job.data.traceId,
    );
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

async function processReportEmail(
  organisationId: string,
  deliveryId: string,
  traceId: string,
) {
  const db = database();
  const [delivery] = await db
    .select()
    .from(schema.reportDeliveries)
    .where(
      and(
        eq(schema.reportDeliveries.organisationId, organisationId),
        eq(schema.reportDeliveries.id, deliveryId),
      ),
    )
    .limit(1);
  if (!delivery || delivery.status !== "queued") return;
  const host = process.env.SMTP_HOST;
  if (host) {
    const [report] = await db
      .select()
      .from(schema.reportManifests)
      .where(
        and(
          eq(schema.reportManifests.organisationId, organisationId),
          eq(schema.reportManifests.id, delivery.reportId),
        ),
      )
      .limit(1);
    if (!report) throw new Error("Approved report no longer exists");
    const manifest = ReportManifestSchema.parse(report.manifest);
    const text = manifest.narrative.slice(0, 10_000);
    try {
      if (manifest.classification !== "internal") {
        throw new Error("Report classification is not approved for email");
      }
      const transport = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        ...(process.env.SMTP_USER
          ? {
              auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD ?? "",
              },
            }
          : {}),
        tls: {
          minVersion: "TLSv1.2",
          rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== "false",
        },
      });
      const sent = await transport.sendMail({
        from: process.env.MUSTER_EMAIL_FROM ?? "Muster <no-reply@muster.local>",
        to: delivery.recipient,
        subject: `Muster ${manifest.audience} report`.slice(0, 160),
        text,
      });
      if (sent.accepted.length === 0 || sent.rejected.length > 0) {
        throw new Error("SMTP rejected the report recipient");
      }
      await db.transaction(async (tx) => {
        await tx
          .update(schema.reportDeliveries)
          .set({
            status: "delivered",
            result: {
              messageId: sent.messageId,
              accepted: sent.accepted,
              rejected: sent.rejected,
              response: sent.response,
            },
            deliveredAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.reportDeliveries.organisationId, organisationId),
              eq(schema.reportDeliveries.id, deliveryId),
              eq(schema.reportDeliveries.status, "queued"),
            ),
          );
        await tx
          .update(schema.approvals)
          .set({ status: "executed", executedAt: new Date() })
          .where(
            and(
              eq(schema.approvals.organisationId, organisationId),
              eq(schema.approvals.id, delivery.approvalId),
              eq(schema.approvals.status, "approved"),
            ),
          );
        await appendAuditEvent(tx, {
          organisationId,
          actorId: delivery.requestedByActorId,
          actorType: "human",
          action: "report.email.delivered",
          targetType: "report_delivery",
          targetId: deliveryId,
          metadata: {
            accepted: sent.accepted.length,
            rejected: sent.rejected.length,
          },
          traceId,
        });
      });
      return;
    } catch (error) {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.reportDeliveries)
          .set({
            status: "failed",
            result: { code: "smtp_delivery_failed" },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.reportDeliveries.organisationId, organisationId),
              eq(schema.reportDeliveries.id, deliveryId),
              eq(schema.reportDeliveries.status, "queued"),
            ),
          );
        await tx
          .update(schema.approvals)
          .set({ status: "failed", executedAt: new Date() })
          .where(
            and(
              eq(schema.approvals.organisationId, organisationId),
              eq(schema.approvals.id, delivery.approvalId),
              eq(schema.approvals.status, "approved"),
            ),
          );
        await appendAuditEvent(tx, {
          organisationId,
          actorId: delivery.requestedByActorId,
          actorType: "human",
          action: "report.email.failed",
          targetType: "report_delivery",
          targetId: deliveryId,
          metadata: { code: "smtp_delivery_failed" },
          traceId,
        });
      });
      throw error;
    }
  }
  // Email transport is deliberately absent until an organisation configures a
  // dedicated connector. Record a bounded, auditable result instead of
  // claiming a delivery that did not happen.
  await db.transaction(async (tx) => {
    await tx
      .update(schema.reportDeliveries)
      .set({
        status: "failed",
        result: { code: "email_transport_unconfigured" },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.reportDeliveries.organisationId, organisationId),
          eq(schema.reportDeliveries.id, deliveryId),
          eq(schema.reportDeliveries.status, "queued"),
        ),
      );
    await tx
      .update(schema.approvals)
      .set({ status: "failed", executedAt: new Date() })
      .where(
        and(
          eq(schema.approvals.organisationId, organisationId),
          eq(schema.approvals.id, delivery.approvalId),
          eq(schema.approvals.status, "approved"),
        ),
      );
    await appendAuditEvent(tx, {
      organisationId,
      actorId: delivery.requestedByActorId,
      actorType: "human",
      action: "report.email.failed",
      targetType: "report_delivery",
      targetId: deliveryId,
      metadata: { code: "email_transport_unconfigured" },
      traceId,
    });
  });
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

function researchOrigins() {
  const testOrigins =
    process.env.MUSTER_RESEARCH_TEST_MODE === "true"
      ? [
          "http://127.0.0.1:4123",
          "http://localhost:4123",
          ...(process.env.MUSTER_RESEARCH_TEST_ORIGINS ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ]
      : [];
  return new Set([
    "https://www.cisa.gov",
    ...testOrigins,
    ...(process.env.MUSTER_RESEARCH_ALLOWED_FEED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
}

function strings(value: unknown, max = 50) {
  return Array.isArray(value)
    ? value
        .map((entry) =>
          typeof entry === "string" ? entry.slice(0, 160).trim() : "",
        )
        .filter(Boolean)
        .slice(0, max)
    : [];
}

async function queueDueResearchRuns(
  organisationId: string,
  traceId: string,
  onlyWatchlistId?: string,
) {
  const db = database();
  const now = new Date();
  await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(schema.researchWatchlists)
      .where(
        and(
          eq(schema.researchWatchlists.organisationId, organisationId),
          eq(schema.researchWatchlists.enabled, true),
          lte(schema.researchWatchlists.nextRunAt, now),
          ...(onlyWatchlistId
            ? [eq(schema.researchWatchlists.id, onlyWatchlistId)]
            : []),
        ),
      )
      .for("update", { skipLocked: true });
    if (!due.length) return;
    const [alfie] = await tx
      .select()
      .from(schema.agentDefinitions)
      .where(
        and(
          eq(schema.agentDefinitions.organisationId, organisationId),
          eq(schema.agentDefinitions.name, "Alfie"),
          eq(schema.agentDefinitions.status, "active"),
        ),
      )
      .limit(1);
    if (!alfie)
      throw new Error("Alfie is not configured for this organisation");
    for (const watchlist of due) {
      const idempotencyKey = researchRunIdempotencyKey(
        watchlist.id,
        watchlist.cadenceMinutes,
        now,
      );
      const [existing] = await tx
        .select({ id: schema.researchRuns.id })
        .from(schema.researchRuns)
        .where(
          and(
            eq(schema.researchRuns.organisationId, organisationId),
            eq(schema.researchRuns.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      await tx
        .update(schema.researchWatchlists)
        .set({
          lastRunAt: now,
          nextRunAt: new Date(
            now.valueOf() + watchlist.cadenceMinutes * 60_000,
          ),
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.researchWatchlists.organisationId, organisationId),
            eq(schema.researchWatchlists.id, watchlist.id),
          ),
        );
      if (existing) continue;
      const researchRunId = newId();
      const agentRunId = newId();
      await tx.insert(schema.agentRuns).values({
        id: agentRunId,
        agentId: alfie.id,
        organisationId,
        roomId: watchlist.roomId,
        requestedByActorId: alfie.id,
        trigger: "schedule",
        status: "queued",
        request: { researchRunId, watchlistId: watchlist.id },
        progress: { stage: "queued", percent: 0 },
        inputHash: createHash("sha256").update(idempotencyKey).digest("hex"),
        promptVersion: alfie.systemPromptVersion,
        runtime: alfie.runtime,
        model: alfie.model,
        maximumRuntimeSeconds: Math.min(alfie.maximumRuntimeSeconds, 900),
        maximumTokenBudget: Math.min(alfie.maximumTokenBudget, 30_000),
        maximumCostCents: Math.min(alfie.maximumCostCents, 500),
        idempotencyKey,
      });
      await tx.insert(schema.researchRuns).values({
        id: researchRunId,
        organisationId,
        watchlistId: watchlist.id,
        agentRunId,
        sourceLimit: 5,
        tokenBudget: Math.min(alfie.maximumTokenBudget, 30_000),
        costLimitCents: Math.min(alfie.maximumCostCents, 500),
        timeLimitSeconds: Math.min(alfie.maximumRuntimeSeconds, 900),
        idempotencyKey,
      });
      await appendAuditEvent(tx, {
        organisationId,
        actorId: alfie.id,
        actorType: "agent",
        action: "research.run.queued",
        targetType: "research_run",
        targetId: researchRunId,
        metadata: {
          watchlistId: watchlist.id,
          sourceLimit: 5,
          tokenBudget: Math.min(alfie.maximumTokenBudget, 30_000),
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId,
        eventType: "research.run.queued",
        aggregateType: "research_run",
        aggregateId: researchRunId,
        queueName: "muster-maintenance",
        payload: { researchRunId },
        idempotencyKey: `research.run.queued:${researchRunId}`,
        traceId,
      });
    }
  });
}

async function fetchResearchFeed(source: { name: string; url: string }) {
  const parsed = new URL(source.url);
  if (
    (parsed.protocol !== "https:" &&
      process.env.MUSTER_RESEARCH_TEST_MODE !== "true") ||
    !researchOrigins().has(parsed.origin)
  ) {
    throw new Error("Research source is not allowlisted");
  }
  const response = await fetch(parsed, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(`Research feed returned ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > 2_000_000) throw new Error("Research feed exceeds size limit");
  const body = await response.text();
  if (body.length > 2_000_000)
    throw new Error("Research feed exceeds size limit");
  return JSON.parse(body) as unknown;
}

async function processResearchRun(
  organisationId: string,
  researchRunId: string,
  traceId: string,
  finalAttempt: boolean,
) {
  const db = database();
  const [run] = await db
    .select({
      run: schema.researchRuns,
      watchlist: schema.researchWatchlists,
      agentRun: schema.agentRuns,
      agent: schema.agentDefinitions,
    })
    .from(schema.researchRuns)
    .innerJoin(
      schema.researchWatchlists,
      and(
        eq(schema.researchWatchlists.id, schema.researchRuns.watchlistId),
        eq(schema.researchWatchlists.organisationId, organisationId),
      ),
    )
    .innerJoin(
      schema.agentRuns,
      and(
        eq(schema.agentRuns.id, schema.researchRuns.agentRunId),
        eq(schema.agentRuns.organisationId, organisationId),
      ),
    )
    .innerJoin(
      schema.agentDefinitions,
      and(
        eq(schema.agentDefinitions.id, schema.agentRuns.agentId),
        eq(schema.agentDefinitions.organisationId, organisationId),
      ),
    )
    .where(
      and(
        eq(schema.researchRuns.organisationId, organisationId),
        eq(schema.researchRuns.id, researchRunId),
      ),
    )
    .limit(1);
  if (!run) throw new Error("Authoritative research run not found");
  if (run.run.status === "completed" || run.run.status === "failed") return;
  if (!strings(run.agent.allowedTools).includes("research.feeds.read"))
    throw new Error("Alfie feed tool is revoked");
  await db.transaction(async (tx) => {
    await tx
      .update(schema.researchRuns)
      .set({ status: "running", updatedAt: new Date() })
      .where(
        and(
          eq(schema.researchRuns.organisationId, organisationId),
          eq(schema.researchRuns.id, researchRunId),
        ),
      );
    await tx
      .update(schema.agentRuns)
      .set({
        status: "running",
        startedAt: new Date(),
        progress: { stage: "fetching approved feeds", percent: 20 },
      })
      .where(
        and(
          eq(schema.agentRuns.organisationId, organisationId),
          eq(schema.agentRuns.id, run.run.agentRunId),
        ),
      );
    await appendAuditEvent(tx, {
      organisationId,
      actorId: run.agent.id,
      actorType: "agent",
      action: "research.run.started",
      targetType: "research_run",
      targetId: researchRunId,
      metadata: { watchlistId: run.watchlist.id },
      traceId,
    });
  });
  try {
    const feeds = z
      .array(ResearchFeedSchema)
      .min(1)
      .max(run.run.sourceLimit)
      .parse(run.watchlist.sources);
    const findings: Array<
      ResearchFinding & { source: { name: string; url: string } }
    > = [];
    for (const source of feeds) {
      const feed = await fetchResearchFeed(source);
      for (const finding of parseResearchFeed(feed, source)) {
        if (staleResearchEvidence(finding.publishedAt)) continue;
        if (
          matchesWatchlist(
            finding,
            strings(run.watchlist.vendors),
            strings(run.watchlist.technologies),
          )
        )
          findings.push({ ...finding, source });
      }
    }
    await db.transaction(async (tx) => {
      let posted = 0;
      const publishedBriefHashes: string[] = [];
      for (const finding of findings.slice(0, 200)) {
        const fingerprint = createHash("sha256")
          .update(`${finding.source.url}|${finding.id}`)
          .digest("hex");
        const sourceHash = createHash("sha256")
          .update(`${finding.source.url}|${finding.title}|${finding.summary}`)
          .digest("hex");
        const verifiedCaseIds = finding.caseIds.length
          ? (
              await tx
                .select({ externalId: schema.integrationEntities.externalId })
                .from(schema.integrationEntities)
                .where(
                  and(
                    eq(
                      schema.integrationEntities.organisationId,
                      organisationId,
                    ),
                    eq(schema.integrationEntities.entityType, "kelpie.case"),
                    inArray(
                      schema.integrationEntities.externalId,
                      finding.caseIds,
                    ),
                  ),
                )
            ).map((item) => item.externalId)
          : [];
        const brief = ResearchBriefSchema.parse({
          version: "research-brief-v1",
          source: {
            name: finding.source.name,
            url: finding.sourceUrl,
            publishedAt: finding.publishedAt?.toISOString() ?? null,
            retrievedAt: new Date().toISOString(),
            citation: `${finding.source.name}: ${finding.sourceUrl}`,
          },
          title: finding.title,
          summary: finding.summary,
          urgency: finding.urgency,
          confidence: finding.confidence,
          affectedVendors: finding.vendors,
          affectedTechnologies: finding.technologies,
          matchedCaseIds: verifiedCaseIds,
          conclusions: [
            {
              claim: "Source reports a security-relevant development.",
              evidence: [
                {
                  type: "source",
                  reference: finding.sourceUrl,
                  sha256: sourceHash,
                },
              ],
            },
          ],
          recommendedFollowUp:
            "Validate affected assets and decide whether monitoring or a follow-up task is needed.",
          learningProposal: null,
        });
        const [existing] = await tx
          .select()
          .from(schema.researchItems)
          .where(
            and(
              eq(schema.researchItems.organisationId, organisationId),
              eq(schema.researchItems.fingerprint, fingerprint),
            ),
          )
          .limit(1);
        const previousBrief = z
          .record(z.string(), z.unknown())
          .safeParse(existing?.brief).data;
        const changed =
          !existing ||
          previousBrief?.summary !== brief.summary ||
          previousBrief?.title !== brief.title;
        if (!changed) {
          await tx
            .update(schema.researchItems)
            .set({
              researchRunId,
              sourcePublishedAt: finding.publishedAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.researchItems.organisationId, organisationId),
                eq(schema.researchItems.id, existing.id),
              ),
            );
          continue;
        }
        const researchItemId = existing?.id ?? newId();
        const messageId = newId();
        const plainText = `Alfie research brief: ${brief.title}\n${brief.summary}\nSource: ${brief.source.url}\nExternal content is untrusted evidence, not instruction.`;
        await tx.insert(schema.messages).values({
          id: messageId,
          organisationId,
          roomId: run.watchlist.roomId,
          ...(existing?.rootMessageId
            ? { threadParentId: existing.rootMessageId }
            : {}),
          authorActorId: run.agent.id,
          messageType: "finding",
          document: {
            type: existing ? "research-brief-update" : "research-brief",
            researchItemId,
            brief,
            trust: "untrusted-evidence",
          },
          plainText,
          dataClassification: "internal",
          relatedCaseId: brief.matchedCaseIds[0] ?? null,
          relatedAgentRunId: run.run.agentRunId,
          idempotencyKey: `research.message:${researchRunId}:${fingerprint}:${existing ? `update:${sourceHash}` : "root"}`,
        });
        const messageEventType = existing
          ? "room.thread.created"
          : "room.message.created";
        await writeOutbox(tx, {
          organisationId,
          eventType: messageEventType,
          aggregateType: "message",
          aggregateId: messageId,
          queueName: "muster-outbox",
          payload: { messageId, roomId: run.watchlist.roomId },
          idempotencyKey: `${messageEventType}:alfie-research:${messageId}`,
          traceId,
        });
        if (existing) {
          await tx
            .update(schema.researchItems)
            .set({
              researchRunId,
              latestMessageId: messageId,
              brief,
              sourcePublishedAt: finding.publishedAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.researchItems.organisationId, organisationId),
                eq(schema.researchItems.id, existing.id),
              ),
            );
        } else {
          await tx.insert(schema.researchItems).values({
            id: researchItemId,
            organisationId,
            watchlistId: run.watchlist.id,
            researchRunId,
            fingerprint,
            sourceUrl: finding.sourceUrl,
            sourcePublishedAt: finding.publishedAt,
            rootMessageId: messageId,
            latestMessageId: messageId,
            brief,
          });
        }
        publishedBriefHashes.push(
          createHash("sha256").update(JSON.stringify(brief)).digest("hex"),
        );
        posted += 1;
      }
      const structuredOutput = {
        posted,
        sources: feeds.length,
        briefHashes: publishedBriefHashes,
      };
      await tx
        .update(schema.researchRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.researchRuns.organisationId, organisationId),
            eq(schema.researchRuns.id, researchRunId),
          ),
        );
      await tx
        .update(schema.agentRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
          outputSchema: "ResearchBrief",
          outputHash: createHash("sha256")
            .update(JSON.stringify(structuredOutput))
            .digest("hex"),
          structuredOutput,
          progress: { stage: "completed", percent: 100 },
        })
        .where(
          and(
            eq(schema.agentRuns.organisationId, organisationId),
            eq(schema.agentRuns.id, run.run.agentRunId),
          ),
        );
      if (posted === 0) {
        await appendResearchTerminalMessage(tx, {
          organisationId,
          researchRunId,
          kind: "no_changes",
          traceId,
        });
      }
      await appendAuditEvent(tx, {
        organisationId,
        actorId: run.agent.id,
        actorType: "agent",
        action: "research.run.completed",
        targetType: "research_run",
        targetId: researchRunId,
        metadata: {
          posted,
          sourceCount: feeds.length,
          conclusionsAuditable: true,
          learningProposals: 0,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId,
        eventType: "research.run.completed",
        aggregateType: "research_run",
        aggregateId: researchRunId,
        queueName: "muster-outbox",
        payload: { researchRunId, posted },
        idempotencyKey: `research.run.completed:${researchRunId}`,
        traceId,
      });
    });
  } catch (error) {
    if (finalAttempt) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 2_000)
          : "Research run failed";
      await db.transaction(async (tx) => {
        await tx
          .update(schema.researchRuns)
          .set({
            status: "failed",
            error: message,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.researchRuns.organisationId, organisationId),
              eq(schema.researchRuns.id, researchRunId),
            ),
          );
        await tx
          .update(schema.agentRuns)
          .set({
            status: "failed",
            error: message,
            failureCode: "research_feed_failed",
            completedAt: new Date(),
            progress: { stage: "failed", percent: 100 },
          })
          .where(
            and(
              eq(schema.agentRuns.organisationId, organisationId),
              eq(schema.agentRuns.id, run.run.agentRunId),
            ),
          );
        await appendResearchTerminalMessage(tx, {
          organisationId,
          researchRunId,
          kind: "failed",
          traceId,
        });
        await appendAuditEvent(tx, {
          organisationId,
          actorId: run.agent.id,
          actorType: "agent",
          action: "research.run.failed",
          targetType: "research_run",
          targetId: researchRunId,
          metadata: { failureCode: "research_feed_failed", error: message },
          traceId,
        });
        await writeOutbox(tx, {
          organisationId,
          eventType: "research.run.failed",
          aggregateType: "research_run",
          aggregateId: researchRunId,
          queueName: "muster-outbox",
          payload: { researchRunId, failureCode: "research_feed_failed" },
          idempotencyKey: `research.run.failed:${researchRunId}`,
          traceId,
        });
      });
    }
    throw error;
  }
}

async function queueAllDueResearchRuns() {
  const organisations = await database()
    .select({ id: schema.organisations.id })
    .from(schema.organisations);
  await Promise.all(
    organisations.map(({ id }) => queueDueResearchRuns(id, newId())),
  );
}

async function queueAllDueParkerReports() {
  const organisations = await database()
    .select({ id: schema.organisations.id })
    .from(schema.organisations);
  await Promise.all(
    organisations.map(({ id }) => queueDueParkerReports(id, newId())),
  );
}

const researchScheduler = setInterval(
  () =>
    void queueAllDueResearchRuns().catch((error) =>
      jsonLog("error", "research.schedule.failed", {
        error: error instanceof Error ? error.message : "unknown",
      }),
    ),
  60_000,
);
researchScheduler.unref();

const parkerScheduler = setInterval(
  () =>
    void queueAllDueParkerReports().catch((error) =>
      jsonLog("error", "report.schedule.failed", {
        error: error instanceof Error ? error.message : "unknown",
      }),
    ),
  60_000,
);
parkerScheduler.unref();

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


async function processDirectMessageEvaluate(
  organisationId: string,
  messageId: string,
  traceId: string,
) {
  const db = database();
  const [message] = await db
    .select({
      roomId: schema.messages.roomId,
      authorActorId: schema.messages.authorActorId,
    })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.organisationId, organisationId),
        eq(schema.messages.id, messageId),
      ),
    )
    .limit(1);
  if (!message) return;

  const [actor] = await db
    .select({
      id: schema.actors.id,
      organisationId: schema.actors.organisationId,
      capabilityAssignments: schema.actors.capabilityAssignments,
      status: schema.actors.status,
      actorType: schema.actors.actorType,
    })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, organisationId),
        eq(schema.actors.id, message.authorActorId),
        eq(schema.actors.actorType, "human"),
        eq(schema.actors.status, "active"),
      ),
    )
    .limit(1);
  if (!actor) return;

  const assigned = Array.isArray(actor.capabilityAssignments)
    ? actor.capabilityAssignments.filter(
        (value): value is Capability =>
          typeof value === "string" &&
          capabilities.includes(value as Capability),
      )
    : [];
  const subject: AuthorisationSubject = {
    actorId: actor.id,
    organisationId: actor.organisationId,
    capabilities: new Set(assigned),
  };

  let result: DirectMessageInvocation | null = null;
  try {
    result = await new AgentDirectMessageDomainService(db).maybeQueue(
      subject,
      { messageId, roomId: message.roomId },
      traceId,
    );
  } catch (error) {
    // Capability or eligibility failures are terminal for this redrive; do not
    // poison the queue. Log and acknowledge the outbox job.
    jsonLog("warn", "agent.direct_message.evaluate.skipped", {
      organisationId,
      messageId,
      error: error instanceof Error ? error.message : "evaluate failed",
    });
    return;
  }
  if (result?.queued) {
    jsonLog("info", "agent.direct_message.evaluate.queued", {
      organisationId,
      messageId,
      agentRunId: result.agentRunId,
      duplicate: result.duplicate,
    });
  }
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

const slackSocketAbort = new AbortController();
let slackSocketTask: Promise<void> | undefined;
if (process.env.SLACK_SOCKET_MODE_ENABLED === "true") {
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!appToken)
    throw new Error(
      "SLACK_APP_TOKEN is required when SLACK_SOCKET_MODE_ENABLED=true",
    );
  const adapter = new SlackGovernanceAdapter();
  slackSocketTask = runSlackSocketMode({
    appToken,
    signal: slackSocketAbort.signal,
    recordEnvelope: (envelope) => adapter.recordSocketEnvelope(envelope),
    onError: (error) =>
      jsonLog("error", "slack.socket.error", {
        error: error instanceof Error ? error.message : "Socket Mode failed",
      }),
  });
}
ready = true;

const healthServer = createServer((request, response) => {
  if (request.url === "/metrics") {
    const slack = slackHarnessMetrics();
    const socket = slackSocketMetrics();
    response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    response.end(
      [
        `muster_worker_ready ${ready ? 1 : 0}`,
        `muster_worker_queues ${queueNames.length}`,
        `muster_slack_api_rate_limits ${slack.apiRateLimits}`,
        `muster_slack_delivery_failures ${slack.deliveryFailures}`,
        `muster_slack_delivery_dead_letters ${slack.deliveryDeadLetters}`,
        `muster_slack_socket_connections ${socket.connections}`,
        `muster_slack_socket_reconnects ${socket.reconnects}`,
        `muster_slack_socket_envelope_failures ${socket.envelopeFailures}`,
        "",
      ].join("\n"),
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
  clearInterval(researchScheduler);
  slackSocketAbort.abort();
  healthServer.close();
  if (slackSocketTask) await slackSocketTask;
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  await closeDatabase();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
