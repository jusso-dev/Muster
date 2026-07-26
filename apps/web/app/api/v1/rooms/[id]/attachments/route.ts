import { z } from "zod";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";
import { uploadRoomAttachment } from "@/lib/evidence-upload-domain";

const ClassificationSchema = z
  .enum(["public", "internal", "confidential", "restricted"])
  .default("internal");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:evidence:upload`,
      10,
      60,
    );
    const { id } = await params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("Attachment file is required");
    }
    const classification = ClassificationSchema.parse(
      form.get("classification") ?? "internal",
    );
    const result = await uploadRoomAttachment(
      subject,
      id,
      {
        fileName: file.name,
        mimeType: file.type,
        body: new Uint8Array(await file.arrayBuffer()),
        classification,
      },
      traceId,
    );
    return Response.json({ data: result, traceId }, { status: 201 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
