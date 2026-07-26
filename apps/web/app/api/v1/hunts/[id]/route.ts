import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { JessieHuntDomainService } from "@/lib/jessie-hunt-domain";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await params;
    return Response.json({
      data: await new JessieHuntDomainService().get(
        await apiSubject(request),
        id,
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
