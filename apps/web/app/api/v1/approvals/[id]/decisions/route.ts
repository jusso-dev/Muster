import { ApprovalDomainService } from "@/lib/integration-action-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await params;
    return Response.json({
      data: await new ApprovalDomainService().decide(
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
