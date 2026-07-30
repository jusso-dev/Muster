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
      !["awaiting_approval", "waiting_sources", "queued", "running"].includes(
        task.agentRunStatus ?? "",
      )
    ) {
      throw new ApiProblem(
        409,
        "No active run",
        "Task does not have an active agent run.",
      );
    }
    // A run whose lease and deadline have both passed cannot still be
    // executing, so the gateway's opinion is not required to release it.
    // Without this a wedged run — worker died, lease expired, gateway lost
    // the record — leaves the task permanently undeletable and undispatchable.
    const [run] = await database()
      .select({
        leaseExpiresAt: schema.agentRuns.leaseExpiresAt,
        deadlineAt: schema.agentRuns.deadlineAt,
      })
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.id, task.agentRunId),
          eq(schema.agentRuns.organisationId, subject.organisationId),
        ),
      )
      .limit(1);
    const now = Date.now();
    const stale =
      !run ||
      ((run.leaseExpiresAt === null || run.leaseExpiresAt.getTime() < now) &&
        (run.deadlineAt === null || run.deadlineAt.getTime() < now));

    let result: { status?: string; error?: string } = {};
    let gatewayConfirmed = false;
    let gatewayError: string | null = null;
    try {
      const gateway = await fetch(
        `${process.env.AGENT_GATEWAY_URL ?? "http://agent-gateway:3002"}/v1/runs/${encodeURIComponent(task.agentRunId)}/cancel`,
        {
          headers: agentGatewayHeaders(subject.organisationId),
          method: "POST",
          signal: AbortSignal.timeout(5_000),
        },
      );
      result = (await gateway.json().catch(() => ({}))) as typeof result;
      gatewayConfirmed = gateway.ok;
      if (!gateway.ok)
        gatewayError = result.error ?? `Agent gateway returned ${gateway.status}`;
    } catch (cause) {
      gatewayError =
        cause instanceof Error ? cause.message : "Agent gateway is unreachable";
    }

    // Only force the release when the run provably cannot still be alive.
    // Otherwise refuse, so Muster never reports a run cancelled while the
    // gateway is still executing it.
    if (!gatewayConfirmed && !stale) {
      throw new ApiProblem(
        502,
        "Cancellation not confirmed",
        `The agent gateway did not confirm cancellation and this run may still be executing. ${gatewayError ?? ""}`.trim(),
      );
    }

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
        error: gatewayConfirmed
          ? "Cancelled by operator"
          : `Force-released by operator; agent gateway did not confirm (${gatewayError ?? "no response"}). Lease and deadline had already passed.`,
      },
    );
    return Response.json(
      { data: { ...result, gatewayConfirmed, forced: !gatewayConfirmed }, traceId },
      { status: 202 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
