import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { ParkerReportDomainService } from "@/lib/parker-report-domain";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await params;
    return Response.json({ data: await new ParkerReportDomainService().requestEmail(await apiSubject(request), id, await request.json(), traceId), traceId }, { status: 202 });
  } catch (error) { return problemResponse(error, traceId); }
}
