import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";
import {
  deleteWebMission,
  getWebMission,
  updateWebMission,
} from "@/lib/mission-web-domain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    return Response.json({
      data: await getWebMission(subject, id),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    const body = await request.json();
    return Response.json({
      data: await updateWebMission(subject, id, body, traceId),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    const { id } = await params;
    return Response.json({
      data: await deleteWebMission(subject, id, traceId),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
