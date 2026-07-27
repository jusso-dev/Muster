import { z } from "zod";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { AlfieResearchDomainService } from "@/lib/alfie-research-domain";

const Input = z.object({ feedback: z.enum(["useful", "irrelevant", "duplicate"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await params;
    const result = await new AlfieResearchDomainService().feedback(
      await apiSubject(request), id, Input.parse(await request.json()).feedback, traceId,
    );
    return Response.json({ data: result, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
