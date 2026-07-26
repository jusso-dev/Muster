import { ReactionPackDomain } from "@/lib/reaction-pack-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const data = await new ReactionPackDomain().listCatalog(subject);
    return Response.json({ data, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
