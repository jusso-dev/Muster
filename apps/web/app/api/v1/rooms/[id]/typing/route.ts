import { requireCapability } from "@muster/authz";
import { RoomService } from "@muster/rooms";
import { z } from "zod";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { publishRealtime } from "@/lib/realtime";

const TypingSchema = z.object({
  active: z.boolean(),
  threadParentId: z.string().uuid().nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:rooms:typing`,
      120,
      60,
    );
    requireCapability(subject, "messages.create");
    const { id } = await params;
    const input = TypingSchema.parse(await request.json());
    await new RoomService().assertMember(subject, id);
    const realtimeDelivered = await publishRealtime(subject.organisationId, {
      type: "room.typing",
      data: {
        roomId: id,
        actorId: subject.actorId,
        active: input.active,
        threadParentId: input.threadParentId ?? null,
      },
      traceId,
    });
    return Response.json(
      {
        data: { accepted: true },
        realtimeDegraded: !realtimeDelivered,
        traceId,
      },
      { status: 202 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
