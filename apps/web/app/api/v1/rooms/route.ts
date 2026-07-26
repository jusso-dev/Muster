import { RoomGovernanceService, RoomService } from "@muster/rooms";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const url = new URL(request.url);
    return Response.json({
      data: await new RoomGovernanceService().list(subject, {
        query: url.searchParams.get("q") ?? "",
        visibility: url.searchParams.get("visibility") ?? "all",
        roomType: url.searchParams.get("roomType") ?? undefined,
        membership: url.searchParams.get("membership") ?? "all",
        includeArchived: url.searchParams.get("includeArchived") ?? false,
      }),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const room = await new RoomService().create(
      subject,
      await request.json(),
      traceId,
    );
    return Response.json({ data: room, traceId }, { status: 201 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
