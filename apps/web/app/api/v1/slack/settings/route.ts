import { SlackGovernanceAdapter } from "@muster/agent-harness";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    return Response.json({
      data: await new SlackGovernanceAdapter().settings(subject),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
