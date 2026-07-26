import { MessageActionSchema, RoomService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { publishRealtime } from "@/lib/realtime";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:messages:action`,
      120,
      60,
    );
    const { id } = await params;
    const input = MessageActionSchema.parse(await request.json());
    const result = await new RoomService().setMessageAction(
      subject,
      id,
      input,
      traceId,
    );
    const realtimeDelivered = await publishRealtime(subject.organisationId, {
      type: `room.message.${input.action}`,
      data: result,
      traceId,
    });
    return Response.json({
      data: result,
      realtimeDegraded: !realtimeDelivered,
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
