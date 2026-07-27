import Redis from "ioredis";
import { sql } from "drizzle-orm";
import { database } from "@muster/database";
import { checkObjectStorage } from "./object-storage.ts";

const defaultTimeoutMs = 1_000;

export type ReadinessDependency = {
  name: "postgresql" | "redis" | "object_storage" | "agent_gateway";
  check: (signal: AbortSignal) => Promise<void>;
};

export type ReadinessReport = {
  status: "ready" | "degraded";
  dependencies: Array<{
    name: ReadinessDependency["name"];
    status: "ready" | "unavailable";
  }>;
};

async function withTimeout(
  check: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("Readiness check timed out"));
      }, timeoutMs);
      void check(controller.signal).then(resolve, reject);
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runReadinessChecks(
  dependencies: readonly ReadinessDependency[],
  timeoutMs = defaultTimeoutMs,
): Promise<ReadinessReport> {
  const results = await Promise.all(
    dependencies.map(async ({ name, check }) => {
      try {
        await withTimeout(check, timeoutMs);
        return { name, status: "ready" as const };
      } catch {
        return { name, status: "unavailable" as const };
      }
    }),
  );
  return {
    status: results.every((dependency) => dependency.status === "ready")
      ? "ready"
      : "degraded",
    dependencies: results,
  };
}

async function checkRedis(signal: AbortSignal) {
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    connectTimeout: defaultTimeoutMs,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  client.on("error", () => undefined);
  signal.addEventListener("abort", () => client.disconnect(), { once: true });
  try {
    await client.connect();
    if ((await client.ping()) !== "PONG") throw new Error("Redis ping failed");
  } finally {
    client.disconnect();
  }
}

function configuredReadinessDependencies(): ReadinessDependency[] {
  const dependencies: ReadinessDependency[] = [
    {
      name: "postgresql",
      check: async () => {
        await database().execute(sql`select 1`);
      },
    },
    { name: "redis", check: checkRedis },
    { name: "object_storage", check: checkObjectStorage },
  ];
  const agentGatewayUrl = process.env.AGENT_GATEWAY_URL;
  if (agentGatewayUrl) {
    dependencies.push({
      name: "agent_gateway",
      check: async (signal) => {
        const response = await fetch(`${agentGatewayUrl}/ready`, { signal });
        if (!response.ok) {
          throw new Error(
            `Agent gateway readiness returned ${response.status}`,
          );
        }
      },
    });
  }
  return dependencies;
}

export function musterReadiness() {
  return runReadinessChecks(configuredReadinessDependencies());
}
