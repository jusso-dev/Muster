import { requireCapability } from "@muster/authz";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { agentReadinessEntry } from "@/lib/agent-readiness-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "agents.read");
    const { id } = await params;
    const agent = await agentReadinessEntry(subject.organisationId, id);
    if (!agent) throw new ApiProblem(404, "Not found", "Agent not found.");
    return Response.json({ data: agent, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
