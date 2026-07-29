import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { listWebMissions } from "@/lib/mission-web-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const limit = new URL(request.url).searchParams.get("limit");
    return Response.json({
      data: await listWebMissions(subject, limit),
      meta: { source: "api" },
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
