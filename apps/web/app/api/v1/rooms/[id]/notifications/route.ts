import { RoomNotificationSchema, RoomService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    const result = await new RoomService().getRoomNotifications(subject, id);
    return Response.json({ data: result, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    const input = RoomNotificationSchema.parse(await request.json());
    const result = await new RoomService().updateRoomNotifications(
      subject,
      id,
      input,
    );
    return Response.json({ data: result, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
