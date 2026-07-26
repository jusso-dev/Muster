import { requireCapability } from "@muster/authz";
import { PostMessageSchema, RoomService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { publishRealtime } from "@/lib/realtime";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "rooms.read");
    const { id } = await params;
    const url = new URL(request.url);
    const result = await new RoomService().listMessages(subject, id, {
      limit: url.searchParams.get("limit") ?? undefined,
      before: url.searchParams.get("before") ?? undefined,
    });
    return Response.json({
      data: result.messages,
      page: result.page,
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:messages:create`,
      30,
      60,
    );
    const { id } = await params;
    const input = PostMessageSchema.parse({
      ...((await request.json()) as Record<string, unknown>),
      roomId: id,
    });
    const result = await new RoomService().postMessage(subject, input, traceId);
    const realtimeDelivered = await publishRealtime(subject.organisationId, {
      type: input.threadParentId
        ? "room.thread.created"
        : "room.message.created",
      data: {
        messageId: result.message.id,
        roomId: id,
        threadParentId: input.threadParentId ?? null,
      },
      traceId,
    });
    return Response.json(
      {
        data: result.message,
        duplicate: !result.created,
        realtimeDegraded: !realtimeDelivered,
        traceId,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
