import { and, eq, or } from "drizzle-orm";
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
  idempotencyKey: string;
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

export type TaskChanges = Partial<Omit<TaskInput, "idempotencyKey">>;

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
  return database().transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.organisationId, context.organisationId),
          eq(schema.tasks.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) return { id: existing.id, created: false };

    const id = newId();
    await assertReferences(tx, context.organisationId, input);
    const [created] = await tx
      .insert(schema.tasks)
      .values({
        id,
        organisationId: context.organisationId,
        createdByActorId: context.actorId,
        ...input,
      })
      .onConflictDoNothing({
        target: [schema.tasks.organisationId, schema.tasks.idempotencyKey],
      })
      .returning({ id: schema.tasks.id });
    if (!created) {
      const [concurrent] = await tx
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.organisationId, context.organisationId),
            eq(schema.tasks.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!concurrent) {
        throw new Error("Task idempotency conflict could not be resolved.");
      }
      return { id: concurrent.id, created: false };
    }
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
    return { id, created: true };
  });
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
  request: Record<string, unknown>;
  idempotencyKey: string;
  maximumRuntimeSeconds: number;
  maximumTokenBudget: number;
  maximumCostCents: number;
};

export async function queueAgentRun(
  context: TaskMutationContext,
  taskId: string,
  run: AcceptedAgentRun,
) {
  return database().transaction(async (tx) => {
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
    const [inserted] = await tx
      .insert(schema.agentRuns)
      .values({
        id: run.runId,
        agentId: run.agentId,
        organisationId: context.organisationId,
        roomId: run.roomId,
        investigationId: run.investigationId,
        requestedByActorId: context.actorId,
        trigger: "task",
        status: "queued",
        request: run.request,
        progress: { stage: "queued", percent: 0 },
        deadlineAt: new Date(Date.now() + run.maximumRuntimeSeconds * 1_000),
        inputHash: run.inputHash,
        promptVersion: run.promptVersion,
        runtime: run.runtime,
        model: run.model,
        maximumRuntimeSeconds: run.maximumRuntimeSeconds,
        maximumTokenBudget: run.maximumTokenBudget,
        maximumCostCents: run.maximumCostCents,
        idempotencyKey: run.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning({ id: schema.agentRuns.id });
    const runId =
      inserted?.id ??
      (
        await tx
          .select({ id: schema.agentRuns.id })
          .from(schema.agentRuns)
          .where(
            and(
              eq(schema.agentRuns.organisationId, context.organisationId),
              eq(schema.agentRuns.idempotencyKey, run.idempotencyKey),
            ),
          )
          .limit(1)
      )[0]?.id;
    if (!runId) throw new Error("Could not queue agent run");
    await tx
      .update(schema.tasks)
      .set({
        status: "in_progress",
        agentRunId: runId,
        agentRunStatus: "queued",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.organisationId, context.organisationId),
        ),
      );
    if (inserted) {
      await tx.insert(schema.agentRunEvents).values({
        id: newId(),
        organisationId: context.organisationId,
        runId,
        eventType: "queued",
        message: "Task delegation queued durable agent execution",
        payload: { taskId, agentId: run.agentId },
      });
      await recordMutation(tx, context, taskId, "task.agent_run.queued", {
        runId,
        agentId: run.agentId,
        runtime: run.runtime,
      });
    }
    return { runId, status: "queued" as const, duplicate: !inserted };
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
    if (run.status === "running" || run.status === "queued") {
      await tx
        .update(schema.agentRuns)
        .set({
          status: result.status,
          completedAt: new Date(),
          structuredOutput: result.output ?? null,
          outputHash: result.outputHash ?? null,
          tokenUsage:
            result.usage && typeof result.usage === "object"
              ? result.usage
              : {},
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
    }
    const [updatedTask] = await tx
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
          or(
            eq(schema.tasks.agentRunStatus, "queued"),
            eq(schema.tasks.agentRunStatus, "running"),
          ),
        ),
      )
      .returning({ id: schema.tasks.id });
    if (!updatedTask) return;
    await recordMutation(tx, context, taskId, "task.agent_run.settled", {
      runId,
      status: result.status,
      hasOutput: result.output !== undefined,
    });
  });
}
