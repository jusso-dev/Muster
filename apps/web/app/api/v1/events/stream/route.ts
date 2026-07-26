import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { createSubscriber } from "@/lib/realtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const channel = `muster:events:${subject.organisationId}`;
    const encoder = new TextEncoder();
    let subscriber: ReturnType<typeof createSubscriber>;
    let heartbeat: ReturnType<typeof setInterval>;
    const stream = new ReadableStream({
      async start(controller) {
        subscriber = createSubscriber();
        subscriber.on("message", (_channel, message) => {
          controller.enqueue(encoder.encode(`event: update\ndata: ${message}\n\n`));
        });
        await subscriber.subscribe(channel);
        controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ traceId })}\n\n`));
        heartbeat = setInterval(() => controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`)), 15_000);
      },
      cancel() {
        clearInterval(heartbeat);
        void subscriber.unsubscribe(channel).finally(() => subscriber.disconnect());
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
