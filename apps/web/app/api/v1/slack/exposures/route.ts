import { SlackGovernanceAdapter } from "@muster/agent-harness";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { z } from "zod";

const ExposureSchema = z.object({
  installationId: z.string().uuid(),
  agentId: z.string().uuid(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  allowedChannelIds: z.array(z.string().trim().min(1).max(128)).max(500).optional(),
  allowDirectMessages: z.boolean().optional(),
  allowThreadContext: z.boolean().optional(),
});

export async function PUT(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const input = ExposureSchema.parse(await request.json());
    await new SlackGovernanceAdapter().configureExposure(subject, {
      installationId: input.installationId,
      agentId: input.agentId,
      enabled: input.enabled,
      isDefault: input.isDefault,
      ...(input.allowedChannelIds === undefined
        ? {}
        : { allowedChannelIds: input.allowedChannelIds }),
      ...(input.allowDirectMessages === undefined
        ? {}
        : { allowDirectMessages: input.allowDirectMessages }),
      ...(input.allowThreadContext === undefined
        ? {}
        : { allowThreadContext: input.allowThreadContext }),
    });
    return Response.json({ data: { status: "configured" }, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
