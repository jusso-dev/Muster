import { ReactionPackDomain } from "@/lib/reaction-pack-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:reaction-packs:remove`,
      10,
      60,
    );
    const { id } = await params;
    const data = await new ReactionPackDomain().removePack(
      subject,
      id,
      traceId,
    );
    return Response.json({ data, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
