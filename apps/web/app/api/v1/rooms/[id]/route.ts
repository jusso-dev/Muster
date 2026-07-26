import { RoomGovernanceService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    return Response.json({
      data: await new RoomGovernanceService().get(subject, id),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    return Response.json({
      data: await new RoomGovernanceService().update(
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
