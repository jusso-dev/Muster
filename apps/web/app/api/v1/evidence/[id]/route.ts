import { and, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import { RoomService } from "@muster/rooms";
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
    requireCapability(subject, "evidence.read");
    const { id } = await params;
    const [evidence] = await database()
      .select({
        id: schema.evidence.id,
        fileName: schema.evidence.fileName,
        mimeType: schema.evidence.mimeType,
        size: schema.evidence.size,
        sha256: schema.evidence.sha256,
        classification: schema.evidence.classification,
        relatedRoomId: schema.evidence.relatedRoomId,
        source: schema.evidence.source,
        scanState: schema.evidence.scanState,
        retentionState: schema.evidence.retentionState,
        uploadedAt: schema.evidence.uploadedAt,
      })
      .from(schema.evidence)
      .where(
        and(
          eq(schema.evidence.organisationId, subject.organisationId),
          eq(schema.evidence.id, id),
        ),
      )
      .limit(1);
    if (!evidence) {
      throw new ApiProblem(404, "Not found", "Evidence not found.");
    }
    if (evidence.relatedRoomId) {
      await new RoomService().assertMember(subject, evidence.relatedRoomId);
    }
    return Response.json({ data: evidence, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
