import { McpInstallationDomainService } from "@/lib/mcp-installation-domain";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    return Response.json({
      data: await new McpInstallationDomainService().list(
        await apiSubject(request),
      ),
      traceId,
    });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const body = await request.json();
    return Response.json(
      {
        data: await new McpInstallationDomainService().create(
          await apiSubject(request),
          body,
          traceId,
        ),
        traceId,
      },
      { status: 201 },
    );
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
