import Redis from "ioredis";

let publisher: Redis | undefined;

type Publisher = Pick<Redis, "publish"> & {
  status: string;
  connect: () => Promise<unknown>;
};

function redisPublisher() {
  if (!publisher) {
    publisher = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      connectTimeout: 1_000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    publisher.on("error", () => undefined);
  }
  return publisher;
}

export async function publishRealtime(
  organisationId: string,
  event: Record<string, unknown>,
  getPublisher: () => Publisher = redisPublisher,
) {
  try {
    const client = getPublisher();
    if (client.status === "wait") await client.connect();
    await client.publish(
      `muster:events:${organisationId}`,
      JSON.stringify(event),
    );
    return true;
  } catch {
    return false;
  }
}

export function createSubscriber() {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
}
