import { and, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { agentGatewayHeaders } from "@/lib/agent-gateway";
import { settleAgentRun, type AgentRunResult } from "@/lib/task-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.read");
    const { id } = await params;
    const [task] = await database()
      .select({
        id: schema.tasks.id,
        agentRunId: schema.tasks.agentRunId,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, id),
          eq(schema.tasks.organisationId, subject.organisationId),
        ),
      )
      .limit(1);
    if (!task?.agentRunId) {
      throw new ApiProblem(404, "Not found", "Task agent run not found.");
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          while (!request.signal.aborted) {
            const gateway = await fetch(
              `${process.env.AGENT_GATEWAY_URL ?? "http://agent-gateway:3002"}/v1/runs/${encodeURIComponent(task.agentRunId!)}`,
              {
                headers: agentGatewayHeaders(subject.organisationId),
                signal: AbortSignal.timeout(5_000),
              },
            );
            const result = (await gateway.json()) as AgentRunResult & {
              status: "running" | "completed" | "failed" | "cancelled";
            };
            if (!gateway.ok) {
              const unavailable: AgentRunResult = {
                status: "failed",
                error: "Agent runtime record unavailable; retry the task.",
              };
              await settleAgentRun(
                {
                  organisationId: subject.organisationId,
                  actorId: subject.actorId,
                  traceId,
                },
                task.id,
                task.agentRunId!,
                unavailable,
              );
              controller.enqueue(
                encoder.encode(
                  `event: settled\ndata: ${JSON.stringify(unavailable)}\n\n`,
                ),
              );
              controller.close();
              return;
            }
            controller.enqueue(
              encoder.encode(
                `event: progress\ndata: ${JSON.stringify(result)}\n\n`,
              ),
            );
            if (terminalStatuses.has(result.status)) {
              await settleAgentRun(
                {
                  organisationId: subject.organisationId,
                  actorId: subject.actorId,
                  traceId,
                },
                task.id,
                task.agentRunId!,
                result,
              );
              controller.enqueue(
                encoder.encode(
                  `event: settled\ndata: ${JSON.stringify({ status: result.status })}\n\n`,
                ),
              );
              controller.close();
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 750));
          }
        } catch (error) {
          if (!request.signal.aborted) controller.error(error);
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
