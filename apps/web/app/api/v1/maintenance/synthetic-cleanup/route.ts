import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { SyntheticCleanupDomainService } from "@/lib/synthetic-cleanup-domain";

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const body = await request.json();
    const data = await new SyntheticCleanupDomainService().execute(
      subject,
      body,
      traceId,
    );
    return Response.json({ data, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
