import {
  ExternalReactionPackImportSchema,
  ReactionPackDomain,
} from "@/lib/reaction-pack-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:reaction-packs:external-import`,
      5,
      60,
    );
    const input = ExternalReactionPackImportSchema.parse(await request.json());
    const data = await new ReactionPackDomain().recordExternalImportAttempt(
      subject,
      input,
      traceId,
    );
    return Response.json({ data, traceId }, { status: 202 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
