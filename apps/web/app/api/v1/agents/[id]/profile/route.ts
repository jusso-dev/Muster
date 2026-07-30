import { requireCapability } from "@muster/authz";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { agentProfile } from "@/lib/agent-profile-domain";

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
    return Response.json({
      data: await agentProfile(subject.organisationId, id),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
