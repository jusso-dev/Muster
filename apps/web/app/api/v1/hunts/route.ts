import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import { desc, eq } from "drizzle-orm";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { JessieHuntDomainService } from "@/lib/jessie-hunt-domain";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "agents.read");
    const rows = await database()
      .select()
      .from(schema.huntRuns)
      .where(eq(schema.huntRuns.organisationId, subject.organisationId))
      .orderBy(desc(schema.huntRuns.createdAt))
      .limit(100);
    return Response.json({ data: rows, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const result = await new JessieHuntDomainService().create(
      await apiSubject(request),
      await request.json(),
      traceId,
    );
    return Response.json(
      { data: result, traceId },
      { status: result.duplicate ? 200 : 202 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
