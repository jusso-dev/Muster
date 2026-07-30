import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";

type Cadence = "daily" | "weekly" | "weekdays";

function computeNextOccurrence(
  cadence: Cadence,
  timezone: string,
  hour: number,
  from: Date,
): Date {
  // Same operational rule as web: step one day until cadence matches.
  let cursor = new Date(from.getTime() + 60_000);
  for (let i = 0; i < 16; i += 1) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    }).format(cursor);
    const localHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      }).format(cursor),
    );
    const okCadence =
      cadence === "daily" ||
      (cadence === "weekdays" && !["Sat", "Sun"].includes(weekday)) ||
      (cadence === "weekly" && weekday === "Mon");
    if (okCadence && localHour === hour) return cursor;
    // Jump toward next local hour boundary.
    cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
  }
  // Fallback: +1 day.
  return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * For each due recurring template task, spawn a child work item and advance
 * next_occurrence_at. Templates stay on the board as the recurrence definition.
 */
export async function spawnDueRecurringTasks(
  organisationId: string,
  traceId: string,
) {
  const now = new Date();
  return database().transaction(async (tx) => {
    const due = await tx
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.organisationId, organisationId),
          isNull(schema.tasks.archivedAt),
          isNotNull(schema.tasks.recurrenceCadence),
          isNotNull(schema.tasks.nextOccurrenceAt),
          lte(schema.tasks.nextOccurrenceAt, now),
          // Only templates (not child instances) spawn.
          isNull(schema.tasks.recurrenceSourceTaskId),
        ),
      )
      .for("update", { skipLocked: true });

    let created = 0;
    for (const template of due) {
      const cadence = template.recurrenceCadence as Cadence;
      const timezone = template.recurrenceTimezone || "Australia/Sydney";
      const hour = template.recurrenceHour ?? 7;
      const occurrenceKey = template.nextOccurrenceAt!.toISOString();
      const idempotencyKey = `task:recurrence:${template.id}:${occurrenceKey}`;
      const [existing] = await tx
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.organisationId, organisationId),
            eq(schema.tasks.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);

      const next = computeNextOccurrence(cadence, timezone, hour, now);
      await tx
        .update(schema.tasks)
        .set({ nextOccurrenceAt: next, updatedAt: now })
        .where(
          and(
            eq(schema.tasks.organisationId, organisationId),
            eq(schema.tasks.id, template.id),
          ),
        );

      if (existing) continue;

      const childId = newId();
      await tx.insert(schema.tasks).values({
        id: childId,
        organisationId,
        title: template.title,
        description:
          template.description ||
          `Recurring occurrence of ${template.title} (${cadence}).`,
        status: "ready",
        priority: template.priority,
        assignedActorId: template.assignedActorId,
        createdByActorId: template.createdByActorId,
        roomId: template.roomId,
        investigationId: template.investigationId,
        relatedCaseId: template.relatedCaseId,
        approvalRequired: template.approvalRequired,
        dueAt: template.nextOccurrenceAt,
        idempotencyKey,
        recurrenceCadence: null,
        recurrenceSourceTaskId: template.id,
      });
      created += 1;

      await appendAuditEvent(tx, {
        organisationId,
        actorId: template.createdByActorId,
        actorType: "system",
        action: "task.recurrence.spawned",
        targetType: "task",
        targetId: childId,
        metadata: {
          sourceTaskId: template.id,
          cadence,
          occurrenceKey,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId,
        eventType: "task.created",
        aggregateType: "task",
        aggregateId: childId,
        queueName: "muster-notifications",
        payload: { taskId: childId, recurrenceSourceTaskId: template.id },
        idempotencyKey: `task.recurrence.spawned:${childId}`,
        traceId,
      });
    }
    return created;
  });
}

export async function spawnAllDueRecurringTasks() {
  const orgs = await database()
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.status, "active"));
  let total = 0;
  for (const org of orgs) {
    total += await spawnDueRecurringTasks(
      org.id,
      `task-recurrence-${org.id}-${Date.now()}`,
    );
  }
  return total;
}
