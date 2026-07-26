import { and, asc, eq, inArray } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { TaskPrioritySchema, TaskStatusSchema } from "@muster/contracts";
import { database, newId, schema } from "@muster/database";
import { z } from "zod";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";

const CreateTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4_000).default(""),
  status: TaskStatusSchema.default("backlog"),
  priority: TaskPrioritySchema.default("normal"),
  assignedActorId: z.string().uuid().nullable().default(null),
  roomId: z.string().uuid().nullable().default(null),
  investigationId: z.string().uuid().nullable().default(null),
  approvalRequired: z.boolean().default(false),
  dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

async function taskView(organisationId: string) {
  const db = database();
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.organisationId, organisationId))
    .orderBy(asc(schema.tasks.status), asc(schema.tasks.createdAt));
  const actorIds = rows
    .map((task) => task.assignedActorId)
    .filter((id): id is string => Boolean(id));
  const roomIds = rows
    .map((task) => task.roomId)
    .filter((id): id is string => Boolean(id));
  const [actors, rooms] = await Promise.all([
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
  ]);
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  return rows.map((task) => ({
    ...task,
    assignee: task.assignedActorId
      ? actorById.get(task.assignedActorId) ?? null
      : null,
    room: task.roomId ? roomById.get(task.roomId) ?? null : null,
  }));
}

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.read");
    return Response.json({
      data: await taskView(subject.organisationId),
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
    const db = database();
    const [assignedActor, room, investigation] = await Promise.all([
      input.assignedActorId
        ? db
            .select({ id: schema.actors.id })
            .from(schema.actors)
            .where(
              and(
                eq(schema.actors.id, input.assignedActorId),
                eq(schema.actors.organisationId, subject.organisationId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      input.roomId
        ? db
            .select({ id: schema.rooms.id })
            .from(schema.rooms)
            .where(
              and(
                eq(schema.rooms.id, input.roomId),
                eq(schema.rooms.organisationId, subject.organisationId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      input.investigationId
        ? db
            .select({ id: schema.investigations.id })
            .from(schema.investigations)
            .where(
              and(
                eq(schema.investigations.id, input.investigationId),
                eq(
                  schema.investigations.organisationId,
                  subject.organisationId,
                ),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
    ]);
    if (input.assignedActorId && !assignedActor[0]) {
      throw new ApiProblem(404, "Not found", "Task assignee not found.");
    }
    if (input.roomId && !room[0]) {
      throw new ApiProblem(404, "Not found", "Task room not found.");
    }
    if (input.investigationId && !investigation[0]) {
      throw new ApiProblem(404, "Not found", "Task investigation not found.");
    }
    const id = newId();
    await db.insert(schema.tasks).values({
      id,
      organisationId: subject.organisationId,
      createdByActorId: subject.actorId,
      ...input,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
    });
    return Response.json({ data: { id }, traceId }, { status: 201 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
