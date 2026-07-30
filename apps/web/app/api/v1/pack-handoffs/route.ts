import { z } from "zod";
import {
  listPackHandoffs,
  requestPackHandoff,
  PACK_HANDOFF_REASONS,
  PACK_HANDOFF_SUMMARY_MAX,
  type PackHandoffStatus,
} from "@muster/agents";
import { requireCapability } from "@muster/authz";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";

const RequestSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  fromAgentActorId: z.string().uuid(),
  toAgentActorId: z.string().uuid(),
  reason: z.enum(PACK_HANDOFF_REASONS),
  summary: z.string().trim().min(1).max(PACK_HANDOFF_SUMMARY_MAX),
  requestedCapabilities: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .optional(),
  evidenceReferences: z
    .array(z.string().trim().min(1).max(500))
    .max(50)
    .optional(),
  sourceRunId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  missionId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
});

const statuses: PackHandoffStatus[] = [
  "pending",
  "awaiting_approval",
  "accepted",
  "rejected",
  "blocked",
  "dispatched",
  "cancelled",
];

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "agents.read");
    const params = new URL(request.url).searchParams;
    const status = params
      .getAll("status")
      .filter((value): value is PackHandoffStatus =>
        (statuses as string[]).includes(value),
      );
    return Response.json({
      data: await listPackHandoffs(subject.organisationId, {
        ...(params.get("taskId") ? { taskId: params.get("taskId")! } : {}),
        ...(params.get("missionId")
          ? { missionId: params.get("missionId")! }
          : {}),
        ...(params.get("roomId") ? { roomId: params.get("roomId")! } : {}),
        ...(status.length ? { statuses: status } : {}),
        limit: Number(params.get("limit") ?? 50),
      }),
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
    requireCapability(subject, "agents.handoff");
    requireCapability(subject, "agents.invoke");
    const parsed = RequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiProblem(
        400,
        "Invalid request",
        parsed.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    const result = await requestPackHandoff(subject, parsed.data, traceId);
    return Response.json(
      { data: result, traceId },
      { status: result.duplicate ? 200 : 202 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
