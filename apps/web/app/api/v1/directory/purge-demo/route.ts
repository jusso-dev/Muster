import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { purgeDemoDirectoryMembers } from "@/lib/org-directory-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    return Response.json({
      data: await purgeDemoDirectoryMembers(subject, traceId),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
