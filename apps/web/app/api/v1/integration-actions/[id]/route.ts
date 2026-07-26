import { IntegrationActionDomainService } from "@/lib/integration-action-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await params;
    return Response.json({
      data: await new IntegrationActionDomainService().get(
        await apiSubject(request),
        id,
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
