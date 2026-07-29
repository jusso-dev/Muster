import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { getWebMission } from "@/lib/mission-web-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await params;
    return Response.json({
      data: await getWebMission(await apiSubject(request), id),
      meta: { source: "api" },
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
