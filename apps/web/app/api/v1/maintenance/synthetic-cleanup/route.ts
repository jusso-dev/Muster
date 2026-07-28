import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { SyntheticCleanupDomainService } from "@/lib/synthetic-cleanup-domain";

/** Maintenance manifests can be large; cap body size before buffering JSON. */
const MAX_SYNTHETIC_CLEANUP_BODY_BYTES = 1_048_576;

function assertSyntheticCleanupBodySize(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_SYNTHETIC_CLEANUP_BODY_BYTES
    ) {
      throw new ApiProblem(
        413,
        "Payload too large",
        `Synthetic cleanup request body must be at most ${MAX_SYNTHETIC_CLEANUP_BODY_BYTES} bytes.`,
      );
    }
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    assertSyntheticCleanupBodySize(request);
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_SYNTHETIC_CLEANUP_BODY_BYTES) {
      throw new ApiProblem(
        413,
        "Payload too large",
        `Synthetic cleanup request body must be at most ${MAX_SYNTHETIC_CLEANUP_BODY_BYTES} bytes.`,
      );
    }
    let body: unknown;
    try {
      body = raw.length === 0 ? {} : JSON.parse(raw);
    } catch {
      throw new ApiProblem(
        400,
        "Request failed",
        "Request body must be valid JSON.",
      );
    }
    const data = await new SyntheticCleanupDomainService().execute(
      subject,
      body,
      traceId,
    );
    return Response.json({ data, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
