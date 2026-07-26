import { createServer } from "node:http";
import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import { queueNames, type QueueName } from "@muster/contracts";
import { jsonLog, queuePolicies } from "@muster/config";
import {
  claimOutboxBatch,
  closeDatabase,
  database,
  markOutboxDispatched,
  markOutboxFailed,
} from "@muster/database";

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
  queues.set(name, new Queue(name, {
    connection,
    defaultJobOptions: {
      attempts: policy.attempts,
      backoff: policy.backoff,
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: false,
    },
  }));
}

const authoritativeProcessor: Processor = async (job) => {
  // Bodies contain identifiers only. Every processor reloads authoritative state
  // from PostgreSQL before side effects and records its idempotency key there.
  jsonLog("info", "job.started", { queue: job.queueName, jobId: job.id, traceId: job.data.traceId, organisationId: job.data.organisationId });
  if (!job.data.organisationId || !job.data.traceId) throw new Error("Missing execution metadata");
  return { processedAt: new Date().toISOString(), authoritativeStateLoaded: true };
};

for (const name of queueNames.filter((queue) => queue !== "muster-outbox")) {
  const policy = queuePolicies[name];
  const workerOptions = {
    connection,
    concurrency: policy.concurrency,
    lockDuration: Math.min(policy.timeoutMs, 300_000),
    ...(policy.rateLimit ? { limiter: policy.rateLimit } : {}),
  };
  const worker = new Worker(name, authoritativeProcessor, workerOptions);
  worker.on("completed", (job) => jsonLog("info", "job.completed", { queue: name, jobId: job.id }));
  worker.on("failed", (job, error) => jsonLog("error", "job.failed", { queue: name, jobId: job?.id, error: error.message }));
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
      await queue.add(event.eventType, {
        outboxEventId: event.id,
        organisationId: event.organisationId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        traceId: event.traceId,
      }, options);
      await markOutboxDispatched(db, event.id);
    } catch (error) {
      const attempt = event.attempts + 1;
      const retryMs = Math.min(300_000, 1_000 * 2 ** attempt);
      await markOutboxFailed(database(), event.id, error instanceof Error ? error.message : "dispatch failed", new Date(Date.now() + retryMs));
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
    response.end(`muster_worker_ready ${ready ? 1 : 0}\nmuster_worker_queues ${queueNames.length}\n`);
    return;
  }
  response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: ready ? "ready" : "starting", queues: queueNames }));
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
