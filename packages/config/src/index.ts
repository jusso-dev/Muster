import { z } from "zod";
import { queueNames, type QueueName } from "@muster/contracts";

export const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgresql://muster:muster@localhost:5432/muster"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type QueuePolicy = {
  attempts: number;
  backoff: { type: "exponential" | "fixed"; delay: number; jitter?: number };
  concurrency: number;
  timeoutMs: number;
  rateLimit?: { max: number; duration: number };
  deadLetterAfter: number;
};

export const queuePolicies: Record<QueueName, QueuePolicy> = {
  "muster-ingestion": { attempts: 8, backoff: { type: "exponential", delay: 1_000, jitter: 0.3 }, concurrency: 20, timeoutMs: 30_000, rateLimit: { max: 500, duration: 1_000 }, deadLetterAfter: 8 },
  "muster-integrations": { attempts: 7, backoff: { type: "exponential", delay: 2_000, jitter: 0.4 }, concurrency: 8, timeoutMs: 120_000, rateLimit: { max: 50, duration: 1_000 }, deadLetterAfter: 7 },
  "muster-agents": { attempts: 3, backoff: { type: "exponential", delay: 5_000, jitter: 0.2 }, concurrency: 4, timeoutMs: 600_000, rateLimit: { max: 20, duration: 60_000 }, deadLetterAfter: 3 },
  "muster-workflows": { attempts: 5, backoff: { type: "exponential", delay: 2_000, jitter: 0.3 }, concurrency: 10, timeoutMs: 300_000, deadLetterAfter: 5 },
  "muster-notifications": { attempts: 6, backoff: { type: "exponential", delay: 2_000, jitter: 0.5 }, concurrency: 20, timeoutMs: 30_000, rateLimit: { max: 100, duration: 1_000 }, deadLetterAfter: 6 },
  "muster-evidence": { attempts: 4, backoff: { type: "exponential", delay: 5_000, jitter: 0.2 }, concurrency: 3, timeoutMs: 900_000, deadLetterAfter: 4 },
  "muster-search": { attempts: 5, backoff: { type: "exponential", delay: 1_000, jitter: 0.3 }, concurrency: 8, timeoutMs: 120_000, deadLetterAfter: 5 },
  "muster-maintenance": { attempts: 3, backoff: { type: "fixed", delay: 30_000 }, concurrency: 2, timeoutMs: 1_800_000, deadLetterAfter: 3 },
  "muster-outbox": { attempts: 12, backoff: { type: "exponential", delay: 1_000, jitter: 0.5 }, concurrency: 1, timeoutMs: 30_000, deadLetterAfter: 12 },
};

export function queuePolicy(name: QueueName): QueuePolicy {
  if (!queueNames.includes(name)) throw new Error(`Unknown queue ${name}`);
  return queuePolicies[name];
}

export function jsonLog(level: "debug" | "info" | "warn" | "error", message: string, fields: Record<string, unknown> = {}) {
  const redacted = Object.fromEntries(
    Object.entries(fields).filter(([key]) => !/password|secret|token|cookie|evidence/i.test(key)),
  );
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...redacted })}\n`);
}
