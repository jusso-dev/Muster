import { RoomService, ToggleReactionSchema } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { publishRealtime } from "@/lib/realtime";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    const input = ToggleReactionSchema.parse(await request.json());
    const reaction = await new RoomService().toggleReaction(
      subject,
      id,
      input,
      traceId,
    );
    await publishRealtime(subject.organisationId, {
      type: reaction.active
        ? "room.reaction.created"
        : "room.reaction.removed",
      data: reaction,
      traceId,
    });
    return Response.json({ data: reaction, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
