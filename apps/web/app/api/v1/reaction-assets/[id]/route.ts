import { ReactionPackDomain } from "@/lib/reaction-pack-domain";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    const url = new URL(request.url);
    const revisionId = url.searchParams.get("revision");
    const digest = url.searchParams.get("digest");
    if (!revisionId || !digest) {
      throw new ApiProblem(
        400,
        "Exact reaction revision required",
        "Both revision and digest are required.",
      );
    }
    const asset = await new ReactionPackDomain().readApprovedAsset(
      subject,
      id,
      revisionId,
      digest,
      traceId,
    );
    return new Response(Buffer.from(asset.body), {
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-type": asset.mimeType,
        "content-length": String(asset.body.byteLength),
        "x-content-type-options": "nosniff",
        etag: `"sha256-${asset.sha256}"`,
      },
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
