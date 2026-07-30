import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { inviteHumanMember } from "@/lib/org-directory-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const body = await request.json();
    return Response.json(
      {
        data: await inviteHumanMember(subject, body, traceId),
        traceId,
      },
      { status: 201 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
