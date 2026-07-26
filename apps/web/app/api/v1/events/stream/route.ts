import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { createSubscriber } from "@/lib/realtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const channel = `muster:events:${subject.organisationId}`;
    const encoder = new TextEncoder();
    let subscriber: ReturnType<typeof createSubscriber> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;

    async function cleanup() {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
      const current = subscriber;
      subscriber = undefined;
      if (!current) return;
      current.removeAllListeners("message");
      try {
        await current.unsubscribe(channel);
      } catch {
        // The connection may already be gone after a browser disconnect.
      } finally {
        current.disconnect();
      }
    }

    const stream = new ReadableStream({
      async start(controller) {
        function enqueue(message: string) {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(message));
          } catch {
            closed = true;
            void cleanup();
          }
        }

        try {
          subscriber = createSubscriber();
          subscriber.on("message", (_channel, message) => {
            enqueue(`event: update\ndata: ${message}\n\n`);
          });
          request.signal.addEventListener(
            "abort",
            () => {
              closed = true;
              void cleanup();
            },
            { once: true },
          );
          await subscriber.subscribe(channel);
          if (closed) return;
          enqueue(`event: connected\ndata: ${JSON.stringify({ traceId })}\n\n`);
          heartbeat = setInterval(
            () => enqueue(`: heartbeat ${Date.now()}\n\n`),
            15_000,
          );
        } catch (error) {
          closed = true;
          await cleanup();
          controller.error(error);
        }
      },
      cancel() {
        closed = true;
        void cleanup();
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
