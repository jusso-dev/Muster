import {
  DeleteMessageSchema,
  EditMessageSchema,
  RoomService,
} from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { publishRealtime } from "@/lib/realtime";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:messages:edit`,
      60,
      60,
    );
    const { id } = await params;
    const input = EditMessageSchema.parse(await request.json());
    const message = await new RoomService().editMessage(
      subject,
      id,
      input,
      traceId,
    );
    const realtimeDelivered = await publishRealtime(subject.organisationId, {
      type: "room.message.edited",
      data: { messageId: id, roomId: message?.roomId },
      traceId,
    });
    return Response.json({
      data: message,
      realtimeDegraded: !realtimeDelivered,
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:messages:delete`,
      30,
      60,
    );
    const { id } = await params;
    const input = DeleteMessageSchema.parse(await request.json());
    const message = await new RoomService().deleteMessage(
      subject,
      id,
      input,
      traceId,
    );
    const realtimeDelivered = await publishRealtime(subject.organisationId, {
      type: "room.message.deleted",
      data: { messageId: id, roomId: message?.roomId },
      traceId,
    });
    return Response.json({
      data: message,
      realtimeDegraded: !realtimeDelivered,
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
