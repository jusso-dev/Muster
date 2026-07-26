import { and, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { redactForObservation } from "@muster/config";
import { database, schema } from "@muster/database";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { settleAgentRun, type AgentRunResult } from "@/lib/task-domain";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.read");
    const { id } = await params;
    const db = database();
    const [task] = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.organisationId, subject.organisationId),
          eq(schema.tasks.agentRunId, id),
        ),
      )
      .limit(1);
    if (!task) {
      throw new ApiProblem(404, "Not found", "Agent run not found.");
    }
    const gateway = await fetch(
      `${process.env.AGENT_GATEWAY_URL ?? "http://agent-gateway:3002"}/v1/runs/${encodeURIComponent(id)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    const result = (await gateway.json()) as {
      status?: string;
      output?: unknown;
      outputHash?: string;
      usage?: unknown;
      estimatedCostCents?: number;
      error?: string;
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
        id,
        unavailable,
      );
      return Response.json({ data: unavailable, traceId });
    }
    if (
      result.status === "completed" ||
      result.status === "failed" ||
      result.status === "cancelled"
    ) {
      await settleAgentRun(
        {
          organisationId: subject.organisationId,
          actorId: subject.actorId,
          traceId,
        },
        task.id,
        id,
        result as AgentRunResult,
      );
    }
    return Response.json({
      data: redactForObservation(result),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
