import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import {
  createWebMission,
  listWebMissions,
} from "@/lib/mission-web-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    return Response.json({
      data: await listWebMissions(subject, limit, includeArchived),
      meta: { source: "api" },
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const body = await request.json();
    return Response.json(
      {
        data: await createWebMission(subject, body, traceId),
        traceId,
      },
      { status: 201 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
