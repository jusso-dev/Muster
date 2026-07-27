import { requireCapability } from "@muster/authz";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import {
  agentLearningState,
  mutateAgentLearning,
} from "@/lib/agent-learning-domain";

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
    const includeInactive =
      new URL(request.url).searchParams.get("includeInactive") === "true";
    if (includeInactive) requireCapability(subject, "agents.manage");
    const data = await agentLearningState(subject.organisationId, id, {
      includeInactive,
    });
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
    const data = await mutateAgentLearning(
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
