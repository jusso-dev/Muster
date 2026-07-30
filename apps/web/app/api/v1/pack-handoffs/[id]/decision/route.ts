import { z } from "zod";
import { requireCapability } from "@muster/authz";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { decidePackHandoff } from "@muster/agents";

const DecisionSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    // The approval decisions themselves are recorded through /approvals; this
    // route only releases a handoff whose approval is already satisfied.
    requireCapability(subject, "workflows.approve");
    const { id } = await params;
    const parsed = DecisionSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiProblem(
        400,
        "Invalid request",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    return Response.json({
      data: await decidePackHandoff(subject, id, parsed.data, traceId),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
