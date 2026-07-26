import { ConnectorDomainService } from "@/lib/connector-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    return Response.json({
      data: await new ConnectorDomainService().list(await apiSubject(request)),
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
        data: await new ConnectorDomainService().configure(
          await apiSubject(request),
          await request.json(),
          traceId,
        ),
        traceId,
      },
      { status: 201 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
