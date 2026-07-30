import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { updateDirectoryActor } from "@/lib/org-directory-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ actorId: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { actorId } = await params;
    const body = await request.json();
    return Response.json({
      data: await updateDirectoryActor(subject, actorId, body, traceId),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
