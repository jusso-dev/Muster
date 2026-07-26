import { and, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

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
    if (!task || !task.assignedActorId) {
      throw new Error("Task needs an agent assignee");
    }
    const [agent] = await db
      .select()
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.id, task.assignedActorId),
          eq(schema.actors.organisationId, subject.organisationId),
          eq(schema.actors.actorType, "agent"),
        ),
      )
      .limit(1);
    if (!agent) throw new Error("Task assignee is not an available agent");

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
      error?: string;
    };
    if (!gateway.ok || !result.runId) {
      throw new Error(result.error ?? "Agent gateway rejected the task");
    }
    await db
      .update(schema.tasks)
      .set({
        status: "in_progress",
        agentRunId: result.runId,
        agentRunStatus: result.status ?? "running",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.tasks.id, task.id),
          eq(schema.tasks.organisationId, subject.organisationId),
        ),
      );
    return Response.json({ data: result, traceId }, { status: 202 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
