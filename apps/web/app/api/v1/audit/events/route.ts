import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { listAuditEvents } from "@/lib/audit-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const url = new URL(request.url);
    const query: Record<string, string | undefined> = {};
    for (const key of [
      "limit",
      "action",
      "actorId",
      "targetType",
      "targetId",
      "since",
      "until",
      "q",
    ]) {
      query[key] = url.searchParams.get(key) ?? undefined;
    }
    const result = await listAuditEvents(subject, query);
    return Response.json({
      data: result.records,
      meta: {
        source: "api",
        limit: result.limit,
        truncated: result.truncated,
      },
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
