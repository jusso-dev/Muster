import { requireCapability } from "@muster/authz";
import { RoomService } from "@muster/rooms";
import { z } from "zod";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { publishRealtime } from "@/lib/realtime";

const PresenceSchema = z.object({
  active: z.boolean(),
  sessionId: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:rooms:presence`,
      180,
      60,
    );
    requireCapability(subject, "rooms.read");
    const { id } = await params;
    const input = PresenceSchema.parse(await request.json());
    await new RoomService().assertMember(subject, id);
    const realtimeDelivered = await publishRealtime(subject.organisationId, {
      type: "room.presence",
      data: {
        roomId: id,
        actorId: subject.actorId,
        sessionId: input.sessionId,
        active: input.active,
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
