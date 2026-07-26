import { RoomGovernanceService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    return Response.json({
      data: await new RoomGovernanceService().administration(subject),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
