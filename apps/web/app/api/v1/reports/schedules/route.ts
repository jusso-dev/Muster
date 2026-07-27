import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { ParkerReportDomainService } from "@/lib/parker-report-domain";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "administration.manage");
    const data = await database()
      .select()
      .from(schema.reportSchedules)
      .where(
        and(
          eq(schema.reportSchedules.organisationId, subject.organisationId),
          isNull(schema.reportSchedules.archivedAt),
        ),
      )
      .orderBy(desc(schema.reportSchedules.nextRunAt));
    return Response.json({ data, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const result = await new ParkerReportDomainService().createSchedule(
      await apiSubject(request),
      await request.json(),
      traceId,
    );
    return Response.json(
      { data: result, traceId },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
