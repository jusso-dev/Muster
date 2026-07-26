import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { exportThreadMarkdown } from "@/lib/thread-export-domain";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:threads:export`,
      10,
      60,
    );
    const { id, messageId } = await params;
    return Response.json({
      data: await exportThreadMarkdown(subject, id, messageId, traceId),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
