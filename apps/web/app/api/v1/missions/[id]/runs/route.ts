import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { listWebMissionRuns } from "@/lib/mission-web-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await params;
    const limit = new URL(request.url).searchParams.get("limit");
    return Response.json({
      data: await listWebMissionRuns(await apiSubject(request), id, limit),
      meta: { source: "api" },
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
