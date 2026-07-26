import { desc, eq } from "drizzle-orm";
import { requireCapability } from "@muster/authz";
import { database, schema } from "@muster/database";
import { apiSubject, problemResponse, requestTraceId } from "@/lib/api-context";

export async function GET(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const subject = await apiSubject(request);
    requireCapability(subject, "alerts.read");
    const data = await database().select().from(schema.alerts).where(eq(schema.alerts.organisationId, subject.organisationId)).orderBy(desc(schema.alerts.receivedAt)).limit(200);
    return Response.json({ data, traceId });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
