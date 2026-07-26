import { RoomGovernanceService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    return Response.json({
      data: await new RoomGovernanceService().lifecycle(
        subject,
        id,
        await request.json(),
        traceId,
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
