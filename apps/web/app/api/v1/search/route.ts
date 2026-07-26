import { requireCapability } from "@muster/authz";
import {
  SearchFilterResolutionError,
  TenantRepository,
  database,
} from "@muster/database";
import {
  ApiProblem,
  apiSubject,
  problemResponse,
  requestTraceId,
} from "@/lib/api-context";
import { parseSearchQuery, searchDateBoundary } from "@/lib/search-query";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "rooms.read");
    const rawQuery = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (rawQuery.length > 500) {
      throw new ApiProblem(
        400,
        "Invalid search",
        "Search queries must be 500 characters or fewer.",
      );
    }
    const parsed = parseSearchQuery(rawQuery);
    if (!parsed.text && parsed.tokens.length === 0) {
      return Response.json({ data: [], filters: [], traceId });
    }
    const repository = new TenantRepository(database(), subject.organisationId);
    let resolved;
    try {
      resolved = await repository.resolveSearchFilters(subject.actorId, {
        ...(parsed.filters.from ? { from: parsed.filters.from } : {}),
        ...(parsed.filters.in ? { in: parsed.filters.in } : {}),
        ...(parsed.filters.after
          ? { after: searchDateBoundary(parsed.filters.after) }
          : {}),
        ...(parsed.filters.before
          ? { before: searchDateBoundary(parsed.filters.before) }
          : {}),
      });
    } catch (error) {
      if (error instanceof SearchFilterResolutionError) {
        throw new ApiProblem(400, "Invalid search filter", error.message);
      }
      throw error;
    }
    return Response.json({
      data: await repository.search(
        parsed.text,
        subject.actorId,
        resolved.filters,
      ),
      filters: parsed.tokens.map((token) => ({
        name: token.name,
        value: token.value,
        label:
          token.name === "from" || token.name === "in"
            ? resolved.labels[token.name]
            : token.value,
      })),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
