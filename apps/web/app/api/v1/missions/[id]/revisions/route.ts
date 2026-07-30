import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { listWebMissionRevisions } from "@/lib/mission-web-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    return Response.json({
      data: await listWebMissionRevisions(subject, id),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
