import { SlackGovernanceAdapter } from "@muster/agent-harness";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { z } from "zod";

const MappingSchema = z.object({
  installationId: z.string().uuid(),
  slackUserId: z.string().trim().min(1).max(128),
  actorId: z.string().uuid(),
});

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await new SlackGovernanceAdapter().mapIdentity(
      subject,
      MappingSchema.parse(await request.json()),
    );
    return Response.json({ data: { status: "active" }, traceId }, { status: 201 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
