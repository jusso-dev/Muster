import { IntegrationActionDomainService } from "@/lib/integration-action-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    return Response.json({
      data: await new IntegrationActionDomainService().list(
        await apiSubject(request),
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    return Response.json(
      {
        data: await new IntegrationActionDomainService().request(
          await apiSubject(request),
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
