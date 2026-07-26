import { requireCapability } from "@muster/authz";
import { TenantRepository, database } from "@muster/database";
import { PostMessageSchema, RoomService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { publishRealtime } from "@/lib/realtime";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "rooms.read");
    const { id } = await params;
    return Response.json({ data: await new TenantRepository(database(), subject.organisationId).messages(id), traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    const input = PostMessageSchema.parse({
      ...(await request.json() as Record<string, unknown>),
      roomId: id,
    });
    const message = await new RoomService().postMessage(subject, input, traceId);
    await publishRealtime(subject.organisationId, {
      type: input.threadParentId
        ? "room.thread.created"
        : "room.message.created",
      data: {
        messageId: message?.id,
        roomId: id,
        threadParentId: input.threadParentId ?? null,
      },
      traceId,
    });
    return Response.json({ data: message, traceId }, { status: 201 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
