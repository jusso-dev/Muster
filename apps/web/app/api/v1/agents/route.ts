import { requireCapability } from "@muster/authz";
import {
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { agentReadinessDirectory } from "@/lib/agent-readiness-domain";
import { onboardAgent } from "@/lib/agent-onboard-domain";

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

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const body = await request.json();
    return Response.json(
      {
        data: await onboardAgent(subject, body, traceId),
        traceId,
      },
      { status: 201 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
