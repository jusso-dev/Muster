import { appendAuditEvent, database, newId, schema, writeOutbox } from "@muster/database";
import { and, eq, lte } from "drizzle-orm";

export function nextScheduledReportRun(cadence: string, now: Date) {
  return new Date(now.valueOf() + (cadence === "weekly" ? 7 : 31) * 86_400_000);
}

/** PostgreSQL is authoritative: row locks plus occurrence idempotency make ticks replay-safe. */
export async function queueDueParkerReports(organisationId: string, traceId: string) {
  const now = new Date();
  return database().transaction(async (tx) => {
    const due = await tx.select().from(schema.reportSchedules).where(and(eq(schema.reportSchedules.organisationId, organisationId), eq(schema.reportSchedules.enabled, true), lte(schema.reportSchedules.nextRunAt, now))).for("update", { skipLocked: true });
    if (!due.length) return 0;
    const [parker] = await tx.select().from(schema.agentDefinitions).where(and(eq(schema.agentDefinitions.organisationId, organisationId), eq(schema.agentDefinitions.name, "Parker"), eq(schema.agentDefinitions.status, "active"), eq(schema.agentDefinitions.killSwitch, false))).limit(1);
    if (!parker) throw new Error("Parker is not configured for this organisation");
    let created = 0;
    for (const schedule of due) {
      const idempotencyKey = `parker:schedule:${schedule.id}:${schedule.nextRunAt.toISOString()}`;
      const [existing] = await tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.organisationId, organisationId), eq(schema.tasks.idempotencyKey, idempotencyKey))).limit(1);
      await tx.update(schema.reportSchedules).set({ lastRunAt: now, nextRunAt: nextScheduledReportRun(schedule.cadence, now), updatedAt: now }).where(eq(schema.reportSchedules.id, schedule.id));
      if (existing) continue;
      const taskId = newId(); created++;
      await tx.insert(schema.tasks).values({ id: taskId, organisationId, roomId: schedule.roomId, title: `Parker ${schedule.cadence} ${schedule.audience} report`, description: `Scheduled ${schedule.cadence} report in ${schedule.timezone}. Review and delegate Parker to generate the authoritative manifest.`, status: "ready", priority: "normal", assignedActorId: parker.id, createdByActorId: schedule.createdByActorId, idempotencyKey, approvalRequired: false });
      await appendAuditEvent(tx, { organisationId, actorId: parker.id, actorType: "agent", action: "report.schedule.task_created", targetType: "task", targetId: taskId, metadata: { scheduleId: schedule.id, cadence: schedule.cadence, timezone: schedule.timezone }, traceId });
      await writeOutbox(tx, { organisationId, eventType: "report.schedule.task_created", aggregateType: "task", aggregateId: taskId, queueName: "muster-outbox", payload: { taskId, scheduleId: schedule.id }, idempotencyKey: `report.schedule.task:${taskId}`, traceId });
    }
    return created;
  });
}
