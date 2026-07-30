import { requireCapability } from "@muster/authz";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { archiveTask } from "@/lib/task-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "tasks.update");
    const { id } = await params;
    return Response.json({
      data: await archiveTask(
        {
          organisationId: subject.organisationId,
          actorId: subject.actorId,
          traceId,
        },
        id,
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
