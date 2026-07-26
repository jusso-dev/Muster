import { requireCapability } from "@muster/authz";
import {
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { agentReadinessDirectory } from "@/lib/agent-readiness-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "agents.read");
    return Response.json({
      data: await agentReadinessDirectory(subject.organisationId),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
