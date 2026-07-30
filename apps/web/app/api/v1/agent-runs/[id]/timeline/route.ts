import { and, asc, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { redactForObservation } from "@muster/config";
import { database, schema } from "@muster/database";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.read");
    const { id } = await params;
    const db = database();
    const [task] = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.organisationId, subject.organisationId),
          eq(schema.tasks.agentRunId, id),
        ),
      )
      .limit(1);
    if (!task) {
      throw new ApiProblem(404, "Not found", "Agent run not found.");
    }
    const [run] = await db
      .select({
        runId: schema.agentRuns.id,
        status: schema.agentRuns.status,
        startedAt: schema.agentRuns.startedAt,
        completedAt: schema.agentRuns.completedAt,
        // Without these a failed run reads as a bare status with no cause.
        failureCode: schema.agentRuns.failureCode,
        error: schema.agentRuns.error,
        cancellationReason: schema.agentRuns.cancellationReason,
        structuredOutput: schema.agentRuns.structuredOutput,
        outputHash: schema.agentRuns.outputHash,
      })
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.organisationId, subject.organisationId),
          eq(schema.agentRuns.id, id),
        ),
      )
      .limit(1);
    if (!run) {
      throw new ApiProblem(404, "Not found", "Agent run not found.");
    }
    const events = await db
      .select({
        id: schema.agentRunEvents.id,
        eventType: schema.agentRunEvents.eventType,
        message: schema.agentRunEvents.message,
        createdAt: schema.agentRunEvents.createdAt,
      })
      .from(schema.agentRunEvents)
      .where(
        and(
          eq(schema.agentRunEvents.organisationId, subject.organisationId),
          eq(schema.agentRunEvents.runId, id),
        ),
      )
      .orderBy(asc(schema.agentRunEvents.createdAt))
      .limit(500);
    return Response.json({
      data: redactForObservation({ ...run, events }),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
