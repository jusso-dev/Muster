import { GovernedAgentHarness } from "@muster/agent-harness";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey)
      throw new Error("Idempotency-Key header is required for harness invocations");
    const data = await new GovernedAgentHarness().invoke(
      subject,
      await request.json(),
      idempotencyKey,
    );
    return Response.json({ data, traceId }, { status: data.duplicate ? 200 : 202 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
