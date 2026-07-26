import { requireCapability } from "@muster/authz";
import { TenantRepository, database } from "@muster/database";
import { RoomService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "rooms.read");
    return Response.json({ data: await new TenantRepository(database(), subject.organisationId).rooms(), traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const room = await new RoomService().create(subject, await request.json(), traceId);
    return Response.json({ data: room, traceId }, { status: 201 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
