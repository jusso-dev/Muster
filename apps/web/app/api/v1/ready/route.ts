import {
  musterReadiness,
  type ReadinessReport,
} from "../../../../lib/readiness.ts";

export const dynamic = "force-dynamic";

export function readinessResponse(report: ReadinessReport) {
  return Response.json(report, {
    status: report.status === "ready" ? 200 : 503,
  });
}

export async function GET() {
  return readinessResponse(await musterReadiness());
}
