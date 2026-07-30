import { requireCapability } from "@muster/authz";
import { TaskPrioritySchema, TaskStatusSchema } from "@muster/contracts";
import { z } from "zod";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { archiveTask, updateTask, type TaskChanges } from "@/lib/task-domain";

const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    description: z.string().trim().max(4_000).optional(),
    status: TaskStatusSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    assignedActorId: z.string().uuid().nullable().optional(),
    roomId: z.string().uuid().nullable().optional(),
    investigationId: z.string().uuid().nullable().optional(),
    relatedCaseId: z.string().trim().max(160).nullable().optional(),
    approvalRequired: z.boolean().optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    /** Soft delete. Rows stay for audit correspondence. */
    archived: z.boolean().optional(),
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
    if (input.assignedActorId !== undefined)
      requireCapability(subject, "tasks.assign");
    const { dueAt, archived, ...unfilteredChanges } = input;
    if (archived !== undefined) {
      const result = await archiveTask(
        {
          organisationId: subject.organisationId,
          actorId: subject.actorId,
          traceId,
        },
        id,
        archived,
      );
      // Archive is its own operation; it does not combine with field edits.
      if (Object.keys(unfilteredChanges).length === 0 && dueAt === undefined) {
        return Response.json({ data: result, traceId });
      }
    }
    const changes = Object.fromEntries(
      Object.entries(unfilteredChanges).filter(
        ([, value]) => value !== undefined,
      ),
    ) as TaskChanges;
    const updated = await updateTask(
      {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        traceId,
      },
      id,
      {
        ...changes,
        ...(dueAt !== undefined
          ? { dueAt: dueAt ? new Date(dueAt) : null }
          : {}),
      },
    );
    return Response.json({ data: updated, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
