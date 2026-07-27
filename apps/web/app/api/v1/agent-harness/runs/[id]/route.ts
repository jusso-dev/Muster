import { requireCapability } from "@muster/authz";
import { GovernedAgentHarness } from "@muster/agent-harness";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { agentGatewayHeaders } from "@/lib/agent-gateway";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    return Response.json({
      data: await new GovernedAgentHarness().read(subject, id),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "agents.cancel");
    const { id } = await params;
    await new GovernedAgentHarness().read(subject, id);
    const gateway = await fetch(
      `${process.env.AGENT_GATEWAY_URL ?? "http://agent-gateway:3002"}/v1/runs/${encodeURIComponent(id)}/cancel`,
      {
        headers: agentGatewayHeaders(subject.organisationId),
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!gateway.ok) throw new Error("Agent runtime did not accept cancellation");
    return Response.json({ data: await gateway.json(), traceId }, { status: 202 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
