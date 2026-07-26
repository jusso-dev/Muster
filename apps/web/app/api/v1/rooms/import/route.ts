import { RoomGovernanceService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const result = await new RoomGovernanceService().import(
      subject,
      await request.json(),
      traceId,
    );
    return Response.json(
      { data: result.room, created: result.created, traceId },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
