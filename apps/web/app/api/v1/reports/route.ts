import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import { desc, eq } from "drizzle-orm";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { ParkerReportDomainService } from "@/lib/parker-report-domain";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "agents.read");
    const data = await database().select().from(schema.reportManifests)
      .where(eq(schema.reportManifests.organisationId, subject.organisationId))
      .orderBy(desc(schema.reportManifests.createdAt)).limit(100);
    return Response.json({ data, traceId });
  } catch (error) { return problemResponse(error, traceId); }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const result = await new ParkerReportDomainService().create(await apiSubject(request), await request.json(), traceId);
    return Response.json({ data: result, traceId }, { status: result.duplicate ? 200 : 202 });
  } catch (error) { return problemResponse(error, traceId); }
}
