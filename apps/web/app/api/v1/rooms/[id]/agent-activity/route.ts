import { requireCapability } from "@muster/authz";
import { RoomService } from "@muster/rooms";
import {
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { listRoomAgentActivity } from "@/lib/agent-activity-domain";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "agents.read");
    requireCapability(subject, "tasks.read");
    const { id } = await params;
    await new RoomService().assertMember(subject, id);
    return Response.json({
      data: await listRoomAgentActivity(subject.organisationId, id),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
