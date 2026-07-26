import { and, eq } from "drizzle-orm";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { ApiProblem } from "./api-context";

type TaskStatus = "backlog" | "ready" | "in_progress" | "review" | "done";
type TaskPriority = "urgent" | "high" | "normal" | "low";

export type TaskMutationContext = {
  organisationId: string;
  actorId: string;
  traceId: string;
};

export type TaskInput = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedActorId: string | null;
  roomId: string | null;
  investigationId: string | null;
  relatedCaseId: string | null;
  approvalRequired: boolean;
  dueAt: Date | null;
};

export type TaskChanges = Partial<TaskInput>;

type Database = ReturnType<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function assertOwnedReference(
  tx: Transaction,
  table:
    typeof schema.actors | typeof schema.rooms | typeof schema.investigations,
  id: string,
  organisationId: string,
  label: string,
) {
  const [record] = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, id), eq(table.organisationId, organisationId)))
    .limit(1);
  if (!record) {
    throw new ApiProblem(404, "Not found", `Task ${label} not found.`);
  }
}

async function assertReferences(
  tx: Transaction,
  organisationId: string,
  input: TaskChanges,
) {
  if (input.assignedActorId) {
    await assertOwnedReference(
      tx,
      schema.actors,
      input.assignedActorId,
      organisationId,
      "assignee",
    );
  }
  if (input.roomId) {
    await assertOwnedReference(
      tx,
      schema.rooms,
      input.roomId,
      organisationId,
      "room",
    );
  }
  if (input.investigationId) {
    await assertOwnedReference(
      tx,
      schema.investigations,
      input.investigationId,
      organisationId,
      "investigation",
    );
  }
}

async function recordMutation(
  tx: Transaction,
  context: TaskMutationContext,
  taskId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await appendAuditEvent(tx, {
    organisationId: context.organisationId,
    actorId: context.actorId,
    actorType: "human",
    action,
    targetType: "task",
    targetId: taskId,
    metadata,
    traceId: context.traceId,
  });
  await writeOutbox(tx, {
    organisationId: context.organisationId,
    eventType: action,
    aggregateType: "task",
    aggregateId: taskId,
    queueName: action.startsWith("task.agent_run")
      ? "muster-agents"
      : "muster-notifications",
    payload: { taskId },
    idempotencyKey: `${action}:${taskId}:${newId()}`,
    traceId: context.traceId,
  });
}

export async function createTask(
  context: TaskMutationContext,
  input: TaskInput,
) {
  const id = newId();
  await database().transaction(async (tx) => {
    await assertReferences(tx, context.organisationId, input);
    await tx.insert(schema.tasks).values({
      id,
      organisationId: context.organisationId,
      createdByActorId: context.actorId,
      ...input,
    });
    await recordMutation(tx, context, id, "task.created", {
      status: input.status,
      priority: input.priority,
      assignedActorId: input.assignedActorId,
      roomId: input.roomId,
      approvalRequired: input.approvalRequired,
    });
    if (input.assignedActorId) {
      await recordMutation(tx, context, id, "task.assigned", {
        previousAssignedActorId: null,
        assignedActorId: input.assignedActorId,
      });
    }
  });
  return { id };
}

export async function updateTask(
  context: TaskMutationContext,
  taskId: string,
  changes: TaskChanges,
) {
  return database().transaction(async (tx) => {
    await assertReferences(tx, context.organisationId, changes);
    const [existing] = await tx
      .select({
        id: schema.tasks.id,
        status: schema.tasks.status,
        assignedActorId: schema.tasks.assignedActorId,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.organisationId, context.organisationId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new ApiProblem(404, "Not found", "Task not found.");
    }
    await tx
      .update(schema.tasks)
      .set({
        ...changes,
        ...(changes.status === "done"
          ? { completedAt: new Date() }
          : changes.status
            ? { completedAt: null }
            : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.organisationId, context.organisationId),
        ),
      );
    await recordMutation(tx, context, taskId, "task.updated", {
      changedFields: Object.keys(changes).sort(),
      previousStatus: existing.status,
      status: changes.status ?? existing.status,
    });
    if (Object.hasOwn(changes, "assignedActorId")) {
      await recordMutation(tx, context, taskId, "task.assigned", {
        previousAssignedActorId: existing.assignedActorId,
        assignedActorId: changes.assignedActorId ?? null,
      });
    }
    return { id: taskId };
  });
}

export type AcceptedAgentRun = {
  runId: string;
  status: string;
  runtime: string;
  agentId: string;
  roomId: string | null;
  investigationId: string | null;
  promptVersion: string;
  model: string;
  inputHash: string;
};

export async function attachAgentRun(
  context: TaskMutationContext,
  taskId: string,
  run: AcceptedAgentRun,
) {
  await database().transaction(async (tx) => {
    const [task] = await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.organisationId, context.organisationId),
        ),
      )
      .limit(1);
    if (!task) throw new ApiProblem(404, "Not found", "Task not found.");
    await tx.insert(schema.agentRuns).values({
      id: run.runId,
      agentId: run.agentId,
      organisationId: context.organisationId,
      roomId: run.roomId,
      investigationId: run.investigationId,
      requestedByActorId: context.actorId,
      trigger: "task",
      status: run.status,
      startedAt: new Date(),
      inputHash: run.inputHash,
      promptVersion: run.promptVersion,
      runtime: run.runtime,
      model: run.model,
      idempotencyKey: `task:${taskId}:run:${run.runId}`,
    });
    await tx
      .update(schema.tasks)
      .set({
        status: "in_progress",
        agentRunId: run.runId,
        agentRunStatus: run.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.organisationId, context.organisationId),
        ),
      );
    await recordMutation(tx, context, taskId, "task.agent_run.started", {
      runId: run.runId,
      agentId: run.agentId,
      runtime: run.runtime,
    });
  });
}

export type AgentRunResult = {
  status: "completed" | "failed" | "cancelled";
  output?: unknown;
  outputHash?: string;
  usage?: unknown;
  estimatedCostCents?: number;
  error?: string;
};

export function taskStatusAfterAgentRun(
  status: AgentRunResult["status"],
): TaskStatus {
  return status === "completed" ? "review" : "ready";
}

export async function settleAgentRun(
  context: TaskMutationContext,
  taskId: string,
  runId: string,
  result: AgentRunResult,
) {
  await database().transaction(async (tx) => {
    const [run] = await tx
      .select({ status: schema.agentRuns.status })
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.id, runId),
          eq(schema.agentRuns.organisationId, context.organisationId),
        ),
      )
      .limit(1);
    if (!run) throw new ApiProblem(404, "Not found", "Agent run not found.");
    if (run.status !== "running" && run.status !== "queued") return;
    await tx
      .update(schema.agentRuns)
      .set({
        status: result.status,
        completedAt: new Date(),
        structuredOutput: result.output ?? null,
        outputHash: result.outputHash ?? null,
        tokenUsage:
          result.usage && typeof result.usage === "object" ? result.usage : {},
        estimatedCostCents: result.estimatedCostCents ?? 0,
        error:
          result.status === "failed"
            ? (result.error ?? "Agent run failed")
            : null,
        cancellationReason:
          result.status === "cancelled"
            ? (result.error ?? "Cancelled by operator")
            : null,
      })
      .where(
        and(
          eq(schema.agentRuns.id, runId),
          eq(schema.agentRuns.organisationId, context.organisationId),
        ),
      );
    await tx
      .update(schema.tasks)
      .set({
        status: taskStatusAfterAgentRun(result.status),
        agentRunStatus: result.status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.organisationId, context.organisationId),
          eq(schema.tasks.agentRunId, runId),
        ),
      );
    await recordMutation(tx, context, taskId, "task.agent_run.settled", {
      runId,
      status: result.status,
      hasOutput: result.output !== undefined,
    });
  });
}
