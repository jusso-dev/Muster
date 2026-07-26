import { RoomGovernanceService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    const details = await new RoomGovernanceService().details(subject, id);
    return Response.json({
      data: {
        members: details.members,
        invitations: details.invitations,
      },
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
    const { id } = await params;
    const invitations = await new RoomGovernanceService().invite(
      subject,
      id,
      await request.json(),
      traceId,
    );
    return Response.json({ data: invitations, traceId }, { status: 201 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
