import { ConnectorDomainService } from "@/lib/connector-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await params;
    return Response.json(
      {
        data: await new ConnectorDomainService().queueQuery(
          await apiSubject(request),
          id,
          await request.json(),
          traceId,
        ),
        traceId,
      },
      { status: 202 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
