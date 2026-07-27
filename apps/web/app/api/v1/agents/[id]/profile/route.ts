import { requireCapability } from "@muster/authz";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import {
  agentProfileState,
  mutateAgentProfile,
} from "@/lib/agent-profile-domain";

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
    const data = await agentProfileState(subject, id);
    return Response.json({ data, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "agents.manage");
    const { id } = await params;
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      throw new ApiProblem(400, "Invalid JSON", "Request body must be JSON.");
    }
    const data = await mutateAgentProfile(
      {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        agentId: id,
        traceId,
      },
      input,
    );
    return Response.json({ data, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
