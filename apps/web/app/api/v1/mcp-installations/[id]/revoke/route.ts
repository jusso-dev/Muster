import { McpInstallationDomainService } from "@/lib/mcp-installation-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const traceId = requestTraceId(request);
  try {
    const { id } = await context.params;
    return Response.json({
      data: await new McpInstallationDomainService().revoke(
        await apiSubject(request),
        id,
        traceId,
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
