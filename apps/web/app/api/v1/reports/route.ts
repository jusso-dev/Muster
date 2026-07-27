import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { ParkerReportDomainService } from "@/lib/parker-report-domain";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "agents.read");
    const data = await database()
      .select({ report: schema.reportManifests })
      .from(schema.reportManifests)
      .innerJoin(
        schema.roomMemberships,
        and(
          eq(
            schema.roomMemberships.organisationId,
            schema.reportManifests.organisationId,
          ),
          eq(schema.roomMemberships.roomId, schema.reportManifests.roomId),
          eq(schema.roomMemberships.actorId, subject.actorId),
        ),
      )
      .where(
        and(
          eq(schema.reportManifests.organisationId, subject.organisationId),
          isNull(schema.reportManifests.archivedAt),
        ),
      )
      .orderBy(desc(schema.reportManifests.createdAt))
      .limit(100);
    return Response.json({ data: data.map((row) => row.report), traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const result = await new ParkerReportDomainService().create(
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
