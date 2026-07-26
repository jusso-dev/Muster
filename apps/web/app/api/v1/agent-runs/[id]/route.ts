import { and, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
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
    const gateway = await fetch(
      `${process.env.AGENT_GATEWAY_URL ?? "http://agent-gateway:3002"}/v1/runs/${encodeURIComponent(id)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    const result = (await gateway.json()) as {
      status?: string;
      error?: string;
    };
    if (!gateway.ok) throw new Error(result.error ?? "Agent run not found");
    if (result.status && result.status !== "running") {
      await db
        .update(schema.tasks)
        .set({
          status: result.status === "completed" ? "review" : "ready",
          agentRunStatus: result.status,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.tasks.organisationId, subject.organisationId),
            eq(schema.tasks.agentRunId, id),
          ),
        );
    }
    return Response.json({ data: result, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
