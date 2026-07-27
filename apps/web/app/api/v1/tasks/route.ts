import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { redactForObservation } from "@muster/config";
import { TaskPrioritySchema, TaskStatusSchema } from "@muster/contracts";
import { database, schema } from "@muster/database";
import { z } from "zod";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { listAgentHandoffs } from "@/lib/agent-handoff-domain";
import { agentReadinessDirectory } from "@/lib/agent-readiness-domain";
import { createTask } from "@/lib/task-domain";

const CreateTaskSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4_000).default(""),
  status: TaskStatusSchema.default("backlog"),
  priority: TaskPrioritySchema.default("normal"),
  assignedActorId: z.string().uuid().nullable().default(null),
  roomId: z.string().uuid().nullable().default(null),
  investigationId: z.string().uuid().nullable().default(null),
  relatedCaseId: z.string().trim().max(160).nullable().default(null),
  approvalRequired: z.boolean().default(false),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

async function taskView(organisationId: string, includeEvidence: boolean) {
  const db = database();
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.organisationId, organisationId),
        isNull(schema.tasks.archivedAt),
      ),
    )
    .orderBy(asc(schema.tasks.status), asc(schema.tasks.createdAt));
  const actorIds = rows
    .map((task) => task.assignedActorId)
    .filter((id): id is string => Boolean(id));
  const roomIds = rows
    .map((task) => task.roomId)
    .filter((id): id is string => Boolean(id));
  const runIds = rows
    .map((task) => task.agentRunId)
    .filter((id): id is string => Boolean(id));
  const [
    actors,
    rooms,
    runs,
    availableAssignees,
    availableRooms,
    readinessDirectory,
  ] = await Promise.all([
    actorIds.length
      ? db
          .select({
            id: schema.actors.id,
            displayName: schema.actors.displayName,
            actorType: schema.actors.actorType,
          })
          .from(schema.actors)
          .where(
            and(
              eq(schema.actors.organisationId, organisationId),
              inArray(schema.actors.id, actorIds),
            ),
          )
      : [],
    roomIds.length
      ? db
          .select({
            id: schema.rooms.id,
            slug: schema.rooms.slug,
          })
          .from(schema.rooms)
          .where(
            and(
              eq(schema.rooms.organisationId, organisationId),
              inArray(schema.rooms.id, roomIds),
            ),
          )
      : [],
    runIds.length
      ? db
          .select({
            id: schema.agentRuns.id,
            status: schema.agentRuns.status,
            runtime: schema.agentRuns.runtime,
            model: schema.agentRuns.model,
            request: schema.agentRuns.request,
            progress: schema.agentRuns.progress,
            tokenUsage: schema.agentRuns.tokenUsage,
            estimatedCostCents: schema.agentRuns.estimatedCostCents,
            structuredOutput: schema.agentRuns.structuredOutput,
            outputHash: schema.agentRuns.outputHash,
            error: schema.agentRuns.error,
            cancellationReason: schema.agentRuns.cancellationReason,
            startedAt: schema.agentRuns.startedAt,
            completedAt: schema.agentRuns.completedAt,
          })
          .from(schema.agentRuns)
          .where(
            and(
              eq(schema.agentRuns.organisationId, organisationId),
              inArray(schema.agentRuns.id, runIds),
            ),
          )
      : [],
    db
      .select({
        id: schema.actors.id,
        displayName: schema.actors.displayName,
        actorType: schema.actors.actorType,
      })
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.organisationId, organisationId),
          inArray(schema.actors.actorType, ["human", "agent"]),
          eq(schema.actors.status, "active"),
        ),
      )
      .orderBy(asc(schema.actors.displayName)),
    db
      .select({
        id: schema.rooms.id,
        slug: schema.rooms.slug,
        displayName: schema.rooms.displayName,
      })
      .from(schema.rooms)
      .where(eq(schema.rooms.organisationId, organisationId))
      .orderBy(asc(schema.rooms.displayName)),
    agentReadinessDirectory(organisationId),
  ]);
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const runById = new Map(runs.map((run) => [run.id, run]));
  const readinessByAgentId = new Map(
    readinessDirectory.map((agent) => [agent.id, agent]),
  );
  const handoffs = await listAgentHandoffs(organisationId, {
    taskIds: rows.map((task) => task.id),
    includeEvidence,
  });
  const handoffByTaskId = new Map(
    handoffs.map((handoff) => [handoff.taskId, handoff]),
  );
  return {
    tasks: rows.map((task) => ({
      ...task,
      assignee: task.assignedActorId
        ? (() => {
            const actor = actorById.get(task.assignedActorId);
            if (!actor) return null;
            const agent =
              actor.actorType === "agent"
                ? readinessByAgentId.get(actor.id)
                : undefined;
            return {
              ...actor,
              description: agent?.description ?? null,
              readiness: agent?.readiness ?? null,
            };
          })()
        : null,
      room: task.roomId ? (roomById.get(task.roomId) ?? null) : null,
      run: task.agentRunId
        ? (() => {
            const run = runById.get(task.agentRunId);
            return run
              ? redactForObservation({
                  ...run,
                  handoff: handoffByTaskId.get(task.id) ?? null,
                })
              : null;
          })()
        : null,
    })),
    availableAssignees: availableAssignees.map((assignee) => {
      const agent =
        assignee.actorType === "agent"
          ? readinessByAgentId.get(assignee.id)
          : undefined;
      return {
        ...assignee,
        description: agent?.description ?? null,
        readiness: agent?.readiness ?? null,
      };
    }),
    availableRooms,
  };
}

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.read");
    const view = await taskView(
      subject.organisationId,
      subject.capabilities.has("evidence.read"),
    );
    return Response.json({
      data: view.tasks,
      meta: {
        assignees: view.availableAssignees,
        rooms: view.availableRooms,
      },
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.create");
    const input = CreateTaskSchema.parse(await request.json());
    if (input.assignedActorId) requireCapability(subject, "tasks.assign");
    const idempotencyKey =
      input.idempotencyKey ??
      request.headers.get("idempotency-key")?.trim() ??
      `task-create:${traceId}`;
    const result = await createTask(
      {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        traceId,
      },
      {
        ...input,
        idempotencyKey,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
      },
    );
    return Response.json(
      { data: { id: result.id }, duplicate: !result.created, traceId },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
