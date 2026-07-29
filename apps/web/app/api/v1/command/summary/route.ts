import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { getCommandSummary } from "@/lib/command-summary-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    return Response.json({
      data: await getCommandSummary(await apiSubject(request)),
      meta: { source: "api" },
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
