import { createServer } from "node:http";
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
  schema,
} from "@muster/database";
import {
  ConnectorConfigurationSchema,
  GovernedConnectorError,
  QueryTemplateSchema,
  decryptConnectorAuth,
  decryptConnectorPayload,
  executeGovernedQuery,
  redactUntrusted,
} from "@muster/integrations";
import { and, eq } from "drizzle-orm";

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
    });
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
    if (
      failure.code === "rate_limited" ||
      failure.code === "source_unavailable"
    )
      throw failure;
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
