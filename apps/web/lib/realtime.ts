import Redis from "ioredis";

let publisher: Redis | undefined;

function redisPublisher() {
  publisher ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  return publisher;
}

export async function publishRealtime(
  organisationId: string,
  event: Record<string, unknown>,
) {
  const client = redisPublisher();
  if (client.status === "wait") await client.connect();
  await client.publish(`muster:events:${organisationId}`, JSON.stringify(event));
}

export function createSubscriber() {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
}
