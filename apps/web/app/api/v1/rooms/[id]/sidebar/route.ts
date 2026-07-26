import { RoomGovernanceService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    return Response.json({
      data: await new RoomGovernanceService().updateSidebar(
        subject,
        id,
        await request.json(),
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
