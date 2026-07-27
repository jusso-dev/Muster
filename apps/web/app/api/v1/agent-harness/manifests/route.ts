import { GovernedAgentHarness } from "@muster/agent-harness";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    return Response.json({
      protocolVersion: "muster.agent-harness/v1",
      data: await new GovernedAgentHarness().manifest(subject),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
