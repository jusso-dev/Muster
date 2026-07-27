import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { redactSecrets } from "@muster/agents";
import { requireCapability } from "@muster/authz";
import { database, newId, schema } from "@muster/database";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { agentReadinessEntry } from "@/lib/agent-readiness-domain";
import { queueAgentRun } from "@/lib/task-domain";
import { JessieHuntDomainService } from "@/lib/jessie-hunt-domain";
import { ParkerReportDomainService } from "@/lib/parker-report-domain";

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
    if (task.agentRunStatus === "running" || task.agentRunStatus === "queued") {
      throw new ApiProblem(
        409,
        "Run in progress",
        "Task already has an active agent run.",
      );
    }
    const [agent] = await db
      .select({
        id: schema.actors.id,
        name: schema.agentDefinitions.name,
        promptVersion: schema.agentDefinitions.systemPromptVersion,
        runtime: schema.agentDefinitions.runtime,
        model: schema.agentDefinitions.model,
        maximumRuntimeSeconds: schema.agentDefinitions.maximumRuntimeSeconds,
        maximumTokenBudget: schema.agentDefinitions.maximumTokenBudget,
        maximumCostCents: schema.agentDefinitions.maximumCostCents,
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
    const readiness = await agentReadinessEntry(
      subject.organisationId,
      agent.id,
    );
    if (!readiness || readiness.readiness.state !== "ready") {
      throw new ApiProblem(
        409,
        "Agent not ready",
        readiness?.readiness.reason ??
          "Agent readiness evidence is unavailable.",
      );
    }

    const humanRequest = redactSecrets(`${task.title}\n\n${task.description}`);
    const idempotencyKey =
      request.headers.get("idempotency-key")?.trim() ||
      `task:${task.id}:after:${task.agentRunId ?? "initial"}`;
    if (idempotencyKey.length > 200) {
      throw new ApiProblem(
        400,
        "Invalid idempotency key",
        "Idempotency key exceeds 200 characters.",
      );
    }
    const result =
      agent.name === "Jessie" && task.roomId
        ? await new JessieHuntDomainService().create(
            subject,
            {
              question: humanRequest,
              roomId: task.roomId,
              taskId: task.id,
              investigationId: task.investigationId ?? undefined,
              linkedCaseId: task.relatedCaseId ?? undefined,
              trainingMode: /\b(?:teach|training|explain|coach)\b/i.test(
                humanRequest,
              ),
              idempotencyKey,
            },
            traceId,
          )
        : agent.name === "Parker" && task.roomId
          ? await new ParkerReportDomainService().create(
              subject,
              {
                roomId: task.roomId,
                taskId: task.id,
                audience: /\b(?:executive|board)\b/i.test(humanRequest)
                  ? "executive"
                  : /\b(?:leadership|manager)\b/i.test(humanRequest)
                    ? "leadership"
                    : "analyst",
                period: {
                  from: new Date(Date.now() - 7 * 24 * 60 * 60_000),
                  to: new Date(),
                },
                idempotencyKey,
              },
              traceId,
            )
          : await queueAgentRun(
            {
              organisationId: subject.organisationId,
              actorId: subject.actorId,
              traceId,
            },
            task.id,
            {
              runId: newId(),
              status: "queued",
              runtime: agent.runtime,
              agentId: agent.id,
              roomId: task.roomId,
              investigationId: task.investigationId,
              promptVersion: agent.promptVersion,
              model: agent.model,
              inputHash: createHash("sha256")
                .update(humanRequest)
                .digest("hex"),
              request: { humanRequest, traceId },
              idempotencyKey,
              maximumRuntimeSeconds: agent.maximumRuntimeSeconds,
              maximumTokenBudget: agent.maximumTokenBudget,
              maximumCostCents: agent.maximumCostCents,
            },
          );
    return Response.json({ data: result, traceId }, { status: 202 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
