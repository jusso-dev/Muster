import { z } from "zod";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { ParkerReportDomainService } from "@/lib/parker-report-domain";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await params;
    const body = z.object({ note: z.string().max(2_000).optional() }).parse(await request.json());
    return Response.json({ data: await new ParkerReportDomainService().review(await apiSubject(request), id, body.note, traceId), traceId });
  } catch (error) { return problemResponse(error, traceId); }
}
