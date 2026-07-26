import { RoomGovernanceService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

type Context = { params: Promise<{ id: string; actorId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id, actorId } = await params;
    return Response.json({
      data: await new RoomGovernanceService().updateMember(
        subject,
        id,
        actorId,
        await request.json(),
        traceId,
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id, actorId } = await params;
    const body = (await request.json()) as { idempotencyKey?: unknown };
    return Response.json({
      data: await new RoomGovernanceService().removeMember(
        subject,
        id,
        actorId,
        typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
        traceId,
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
