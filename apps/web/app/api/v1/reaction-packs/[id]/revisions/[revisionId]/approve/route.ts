import {
  ApproveReactionPackRevisionSchema,
  ReactionPackDomain,
} from "@/lib/reaction-pack-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; revisionId: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:reaction-packs:approve`,
      10,
      60,
    );
    const { id, revisionId } = await params;
    const input = ApproveReactionPackRevisionSchema.parse(await request.json());
    const data = await new ReactionPackDomain().approveRevision(
      subject,
      id,
      revisionId,
      input,
      traceId,
    );
    return Response.json({ data, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
