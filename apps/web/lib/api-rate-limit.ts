import Redis from "ioredis";
import { ApiProblem } from "./api-context.ts";

type RateLimitClient = Pick<Redis, "eval"> & {
  status?: string;
  connect?: () => Promise<unknown>;
};

let client: Redis | undefined;

function rateLimitClient() {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      connectTimeout: 1_000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    client.on("error", () => undefined);
  }
  return client;
}

const fixedWindowScript = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("TTL", KEYS[1])
return { current, ttl }
`;

export async function enforceApiRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  redis: RateLimitClient = rateLimitClient(),
) {
  try {
    if (redis.status === "wait" && redis.connect) await redis.connect();
    const result = await redis.eval(
      fixedWindowScript,
      1,
      `muster:rate-limit:${key}`,
      windowSeconds,
    );
    if (
      !Array.isArray(result) ||
      typeof result[0] !== "number" ||
      typeof result[1] !== "number"
    ) {
      return;
    }
    const [count, ttl] = result;
    if (count > limit) {
      throw new ApiProblem(
        429,
        "Too Many Requests",
        `Rate limit exceeded. Retry in ${Math.max(ttl, 1)} seconds.`,
      );
    }
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    // Redis is execution infrastructure. Durable PostgreSQL writes fail open.
  }
}
