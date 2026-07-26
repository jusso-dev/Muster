import { MarkRoomReadSchema, RoomService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    const input = MarkRoomReadSchema.parse(await request.json());
    const result = await new RoomService().markRoomRead(subject, id, input);
    return Response.json({ data: result, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
