import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiSubject, ApiProblem, problemResponse, requestTraceId } from "@/lib/api-context";
import { createTask } from "@/lib/task-domain";

const Input = z.object({
  title: z.string().trim().min(3).max(300).optional(),
  priority: z.enum(["urgent", "high", "normal", "low"]).default("normal"),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.create");
    const { id } = await params;
    const input = Input.parse(await request.json());
    const [item] = await database()
      .select({ id: schema.researchItems.id, roomId: schema.researchWatchlists.roomId })
      .from(schema.researchItems)
      .innerJoin(
        schema.researchWatchlists,
        and(
          eq(schema.researchWatchlists.id, schema.researchItems.watchlistId),
          eq(schema.researchWatchlists.organisationId, subject.organisationId),
        ),
      )
      .where(
        and(
          eq(schema.researchItems.organisationId, subject.organisationId),
          eq(schema.researchItems.id, id),
        ),
      )
      .limit(1);
    if (!item) throw new ApiProblem(404, "Brief not found", "Research brief does not exist.");
    const task = await createTask(
      { organisationId: subject.organisationId, actorId: subject.actorId, traceId },
      {
        idempotencyKey: input.idempotencyKey,
        title: input.title ?? `Review Alfie research brief ${id}`,
        description: `Analyst-created follow-up for evidence-backed research brief ${id}.`,
        status: "ready",
        priority: input.priority,
        assignedActorId: null,
        roomId: item.roomId,
        investigationId: null,
        relatedCaseId: null,
        approvalRequired: false,
        dueAt: null,
      },
    );
    return Response.json({ data: task, traceId }, { status: task.created ? 201 : 200 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
