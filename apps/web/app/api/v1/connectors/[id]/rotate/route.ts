import { ConnectorDomainService } from "@/lib/connector-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await params;
    return Response.json({
      data: await new ConnectorDomainService().rotate(
        await apiSubject(request),
        id,
        await request.json(),
        traceId,
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
