import { and, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { settleAgentRun } from "@/lib/task-domain";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.assign");
    requireCapability(subject, "agents.cancel");
    const { id } = await params;
    const [task] = await database()
      .select({
        id: schema.tasks.id,
        agentRunId: schema.tasks.agentRunId,
        agentRunStatus: schema.tasks.agentRunStatus,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, id),
          eq(schema.tasks.organisationId, subject.organisationId),
        ),
      )
      .limit(1);
    if (!task) throw new ApiProblem(404, "Not found", "Task not found.");
    if (
      !task.agentRunId ||
      (task.agentRunStatus !== "running" && task.agentRunStatus !== "queued")
    ) {
      throw new ApiProblem(
        409,
        "No active run",
        "Task does not have an active agent run.",
      );
    }
    const gateway = await fetch(
      `${process.env.AGENT_GATEWAY_URL ?? "http://agent-gateway:3002"}/v1/runs/${encodeURIComponent(task.agentRunId)}/cancel`,
      {
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      },
    );
    const result = (await gateway.json()) as {
      status?: string;
      error?: string;
    };
    if (!gateway.ok)
      throw new Error(result.error ?? "Agent cancellation failed");
    await settleAgentRun(
      {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        traceId,
      },
      task.id,
      task.agentRunId,
      {
        status: "cancelled",
        error: "Cancelled by operator",
      },
    );
    return Response.json({ data: result, traceId }, { status: 202 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
