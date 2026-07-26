import {
  CreateReactionPackRevisionSchema,
  ReactionPackDomain,
} from "@/lib/reaction-pack-domain";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { enforceApiRateLimit } from "@/lib/api-rate-limit";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const data = await new ReactionPackDomain().listAdministration(subject);
    return Response.json({ data, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    await enforceApiRateLimit(
      `${subject.organisationId}:${subject.actorId}:reaction-packs:create`,
      10,
      60,
    );
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiProblem(
        400,
        "Reaction asset required",
        "A reaction image file is required.",
      );
    }
    const raw = {
      packId: form.get("packId")?.toString() || undefined,
      packSlug: form.get("packSlug")?.toString(),
      packDisplayName: form.get("packDisplayName")?.toString(),
      revision: form.get("revision")?.toString(),
      assetName: form.get("assetName")?.toString(),
      altText: form.get("altText")?.toString(),
      mimeType: file.type,
      expectedSha256: form.get("expectedSha256")?.toString() || undefined,
    };
    const parsed = CreateReactionPackRevisionSchema.parse(raw);
    const data = await new ReactionPackDomain().createDraft(
      subject,
      {
        ...parsed,
        body: new Uint8Array(await file.arrayBuffer()),
      },
      traceId,
    );
    return Response.json({ data, traceId }, { status: 201 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
