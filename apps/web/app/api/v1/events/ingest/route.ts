import { createHash } from "node:crypto";
import { verifyMsep, ReplayWindow } from "@muster/event-protocol";
import { database, newId, schema } from "@muster/database";
import { problemResponse, requestTraceId } from "@/lib/api-context";

const replayWindow = new ReplayWindow();

export async function POST(request: Request) {
  const traceId = requestTraceId(request);
  try {
    const key = process.env.MSEP_INGESTION_KEY;
    if (!key) throw new Error("MSEP ingestion is not configured");
    const raw = await request.text();
    if (raw.length > 1_000_000) throw new Error("MSEP event exceeds 1 MB");
    const event = verifyMsep(JSON.parse(raw), key);
    replayWindow.assertFresh(event);
    await database().insert(schema.outboxEvents).values({
      id: newId(),
      organisationId: event.source.organisationId,
      eventType: event.type,
      aggregateType: event.subject.type,
      aggregateId: event.subject.id,
      queueName: "muster-ingestion",
      payload: { eventId: event.id, payloadHash: createHash("sha256").update(raw).digest("hex") },
      idempotencyKey: `msep:${event.source.instanceId}:${event.id}`,
      traceId: event.correlation.traceId ?? traceId,
    }).onConflictDoNothing();
    return Response.json({ accepted: true, eventId: event.id, traceId }, { status: 202 });
  } catch (error) {
    return problemResponse(error, traceId);
  }
}
