import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import { appendAuditEvent, database, schema, writeOutbox } from "@muster/database";

export class AlertService {
  constructor(private readonly db = database()) {}

  acknowledge(subject: AuthorisationSubject, alertId: string, traceId: string) {
    requireCapability(subject, "alerts.acknowledge");
    return this.transition(subject, alertId, "acknowledged", traceId);
  }

  dismiss(subject: AuthorisationSubject, alertId: string, reason: string, traceId: string) {
    requireCapability(subject, "alerts.dismiss");
    const validReason = z.string().min(5).max(2_000).parse(reason);
    return this.transition(subject, alertId, "dismissed", traceId, { reason: validReason });
  }

  private async transition(
    subject: AuthorisationSubject,
    alertId: string,
    status: "acknowledged" | "dismissed",
    traceId: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.db.transaction(async (tx) => {
      const [alert] = await tx.update(schema.alerts).set({
        status,
        version: sql`${schema.alerts.version} + 1`,
      }).where(and(
        eq(schema.alerts.id, z.string().uuid().parse(alertId)),
        eq(schema.alerts.organisationId, subject.organisationId),
      )).returning();
      if (!alert) throw new Error("Alert not found");
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: `alert.${status}`,
        aggregateType: "alert",
        aggregateId: alert.id,
        queueName: "muster-outbox",
        payload: { alertId: alert.id },
        idempotencyKey: `alert.${status}:${alert.id}:${alert.version}`,
        traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: `alert.${status}`,
        targetType: "alert",
        targetId: alert.id,
        metadata,
        traceId,
      });
      return alert;
    });
  }
}
