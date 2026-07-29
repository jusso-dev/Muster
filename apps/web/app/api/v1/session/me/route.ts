import { problemResponse, requestTraceId } from "@/lib/api-context";
import { getSessionContext } from "@/lib/session-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    return Response.json({
      data: await getSessionContext(request),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
