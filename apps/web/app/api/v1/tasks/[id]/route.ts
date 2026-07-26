import { and, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { TaskPrioritySchema, TaskStatusSchema } from "@muster/contracts";
import { database, schema } from "@muster/database";
import { z } from "zod";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";

const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().max(4_000).optional(),
    status: TaskStatusSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    assignedActorId: z.string().uuid().nullable().optional(),
    approvalRequired: z.boolean().optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "No task changes supplied");

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.update");
    const { id } = await params;
    const input = UpdateTaskSchema.parse(await request.json());
    const db = database();
    if (input.assignedActorId) {
      const [actor] = await db
        .select({ id: schema.actors.id })
        .from(schema.actors)
        .where(
          and(
            eq(schema.actors.id, input.assignedActorId),
            eq(schema.actors.organisationId, subject.organisationId),
          ),
        )
        .limit(1);
      if (!actor) {
        throw new ApiProblem(404, "Not found", "Task assignee not found.");
      }
    }
    const { dueAt, ...changes } = input;
    const [updated] = await db
      .update(schema.tasks)
      .set({
        ...changes,
        ...(dueAt !== undefined
          ? { dueAt: dueAt ? new Date(dueAt) : null }
          : {}),
        ...(input.status === "done"
          ? { completedAt: new Date() }
          : input.status
            ? { completedAt: null }
            : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.tasks.id, id),
          eq(schema.tasks.organisationId, subject.organisationId),
        ),
      )
      .returning({ id: schema.tasks.id });
    if (!updated) throw new ApiProblem(404, "Not found", "Task not found.");
    return Response.json({ data: updated, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
