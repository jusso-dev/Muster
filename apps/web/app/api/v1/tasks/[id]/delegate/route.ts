import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { attachAgentRun } from "@/lib/task-domain";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.assign");
    requireCapability(subject, "agents.invoke");
    const { id } = await params;
    const db = database();
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, id),
          eq(schema.tasks.organisationId, subject.organisationId),
        ),
      )
      .limit(1);
    if (!task) throw new ApiProblem(404, "Not found", "Task not found.");
    if (!task.assignedActorId)
      throw new ApiProblem(
        409,
        "Agent required",
        "Task needs an agent assignee.",
      );
    if (task.agentRunStatus === "running") {
      throw new ApiProblem(
        409,
        "Run in progress",
        "Task already has an active agent run.",
      );
    }
    const [agent] = await db
      .select({
        id: schema.actors.id,
        promptVersion: schema.agentDefinitions.systemPromptVersion,
        runtime: schema.agentDefinitions.runtime,
        model: schema.agentDefinitions.model,
      })
      .from(schema.actors)
      .innerJoin(
        schema.agentDefinitions,
        and(
          eq(schema.agentDefinitions.id, schema.actors.id),
          eq(
            schema.agentDefinitions.organisationId,
            schema.actors.organisationId,
          ),
        ),
      )
      .where(
        and(
          eq(schema.actors.id, task.assignedActorId),
          eq(schema.actors.organisationId, subject.organisationId),
          eq(schema.actors.actorType, "agent"),
          eq(schema.agentDefinitions.status, "active"),
          eq(schema.agentDefinitions.killSwitch, false),
        ),
      )
      .limit(1);
    if (!agent) {
      throw new ApiProblem(
        409,
        "Agent unavailable",
        "Task assignee is not an active agent.",
      );
    }

    const gateway = await fetch(
      `${process.env.AGENT_GATEWAY_URL ?? "http://agent-gateway:3002"}/v1/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organisationId: subject.organisationId,
          investigationId: task.investigationId,
          agentId: agent.id,
          requestedByActorId: subject.actorId,
          traceId,
          humanRequest: `${task.title}\n\n${task.description}`,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const result = (await gateway.json()) as {
      runId?: string;
      status?: string;
      runtime?: string;
      error?: string;
    };
    if (!gateway.ok || !result.runId) {
      throw new Error(result.error ?? "Agent gateway rejected the task");
    }
    await attachAgentRun(
      {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        traceId,
      },
      task.id,
      {
        runId: result.runId,
        status: result.status ?? "running",
        runtime: result.runtime ?? agent.runtime,
        agentId: agent.id,
        roomId: task.roomId,
        investigationId: task.investigationId,
        promptVersion: agent.promptVersion,
        model: agent.model,
        inputHash: createHash("sha256")
          .update(`${task.title}\n\n${task.description}`)
          .digest("hex"),
      },
    );
    return Response.json({ data: result, traceId }, { status: 202 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
