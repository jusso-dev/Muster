import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { getControlPlaneStatus } from "@/lib/control-plane-status";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    return Response.json({
      data: await getControlPlaneStatus(subject),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
