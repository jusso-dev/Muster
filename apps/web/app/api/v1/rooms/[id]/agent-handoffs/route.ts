import { requireCapability } from "@muster/authz";
import { RoomService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { listAgentHandoffs } from "@/lib/agent-handoff-domain";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.read");
    requireCapability(subject, "evidence.read");
    const { id } = await params;
    await new RoomService().assertMember(subject, id);
    return Response.json({
      data: await listAgentHandoffs(subject.organisationId, {
        roomId: id,
        includeEvidence: true,
        limit: 10,
      }),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
