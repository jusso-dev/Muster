import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { AlfieResearchDomainService } from "@/lib/alfie-research-domain";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    return Response.json({ data: await new AlfieResearchDomainService().list(await apiSubject(request)), traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const result = await new AlfieResearchDomainService().create(
      await apiSubject(request),
      await request.json(),
      traceId,
    );
    return Response.json({ data: result, traceId }, { status: 201 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
