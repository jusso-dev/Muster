import { TenantRepository, database } from "@muster/database";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const query = new URL(request.url).searchParams.get("q")?.trim();
    if (!query) return Response.json({ data: [], traceId });
    return Response.json({ data: await new TenantRepository(database(), subject.organisationId).search(query), traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
