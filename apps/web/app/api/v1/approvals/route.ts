import { ApprovalDomainService } from "@/lib/integration-action-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    return Response.json({
      data: await new ApprovalDomainService().list(await apiSubject(request)),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
