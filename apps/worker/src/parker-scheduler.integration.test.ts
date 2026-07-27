import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, eq, like } from "drizzle-orm";
import { queueDueParkerReports } from "./parker-scheduler";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("Parker report scheduler", () => {
  const db = database();
  const suffix = newId();
  const scheduleId = newId();
  const isolatedOrganisationId = newId();
  const isolatedActorId = newId();
  const isolatedRoomId = newId();
  const isolatedScheduleId = newId();
  const idempotencyKey = `test:parker-schedule:${suffix}`;
  let organisationId = "";
  let parkerId = "";
  let roomId = "";
  let actorId = "";
  let dueAt = new Date();

  beforeAll(async () => {
    const [parker] = await db
      .select({
        organisationId: schema.agentDefinitions.organisationId,
        id: schema.agentDefinitions.id,
      })
      .from(schema.agentDefinitions)
      .where(
        and(
          eq(schema.agentDefinitions.name, "Parker"),
          eq(schema.agentDefinitions.status, "active"),
          eq(schema.agentDefinitions.killSwitch, false),
        ),
      )
      .limit(1);
    if (!parker) throw new Error("Bootstrap an active Parker agent before integration tests");
    organisationId = parker.organisationId;
    parkerId = parker.id;
    const [room] = await db
      .select({ roomId: schema.roomMemberships.roomId, actorId: schema.roomMemberships.actorId })
      .from(schema.roomMemberships)
      .where(
        and(
          eq(schema.roomMemberships.organisationId, organisationId),
          eq(schema.roomMemberships.actorId, parkerId),
        ),
      )
      .limit(1);
    if (!room) throw new Error("Bootstrap a Parker room before integration tests");
    roomId = room.roomId;
    const [creator] = await db
      .select({ id: schema.actors.id })
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.organisationId, organisationId),
          eq(schema.actors.actorType, "human"),
          eq(schema.actors.status, "active"),
        ),
      )
      .limit(1);
    if (!creator) throw new Error("Bootstrap a human actor before integration tests");
    actorId = creator.id;
    dueAt = new Date(Date.now() - 60_000);
    await db.insert(schema.reportSchedules).values({
      id: scheduleId,
      organisationId,
      roomId,
      createdByActorId: actorId,
      cadence: "weekly",
      timezone: "Pacific/Auckland",
      audience: "leadership",
      nextRunAt: dueAt,
      idempotencyKey,
    });

    await db.insert(schema.organisations).values({
      id: isolatedOrganisationId,
      name: `Scheduler isolation ${suffix}`,
      slug: `scheduler-isolation-${suffix}`,
    });
    await db.insert(schema.actors).values({
      id: isolatedActorId,
      organisationId: isolatedOrganisationId,
      actorType: "human",
      displayName: "Synthetic scheduler owner",
      identityReference: `scheduler-owner:${suffix}`,
      capabilityAssignments: [],
    });
    await db.insert(schema.rooms).values({
      id: isolatedRoomId,
      organisationId: isolatedOrganisationId,
      name: "scheduler-isolation",
      slug: `scheduler-isolation-${suffix}`,
      displayName: "Scheduler isolation",
      roomType: "operations",
      createdByActorId: isolatedActorId,
    });
    await db.insert(schema.reportSchedules).values({
      id: isolatedScheduleId,
      organisationId: isolatedOrganisationId,
      roomId: isolatedRoomId,
      createdByActorId: isolatedActorId,
      cadence: "weekly",
      timezone: "UTC",
      audience: "analyst",
      nextRunAt: dueAt,
      idempotencyKey: `test:parker-schedule:isolated:${suffix}`,
    });
  });

  afterAll(async () => {
    await db.delete(schema.outboxEvents).where(and(eq(schema.outboxEvents.organisationId, organisationId), like(schema.outboxEvents.traceId, `scheduler:${suffix}:%`)));
    await db.delete(schema.auditEvents).where(and(eq(schema.auditEvents.organisationId, organisationId), like(schema.auditEvents.traceId, `scheduler:${suffix}:%`)));
    await db.delete(schema.tasks).where(and(eq(schema.tasks.organisationId, organisationId), eq(schema.tasks.idempotencyKey, `parker:schedule:${scheduleId}:${dueAt.toISOString()}`)));
    await db.delete(schema.reportSchedules).where(eq(schema.reportSchedules.id, scheduleId));
    await db.delete(schema.reportSchedules).where(eq(schema.reportSchedules.id, isolatedScheduleId));
    await db.delete(schema.rooms).where(eq(schema.rooms.id, isolatedRoomId));
    await db.delete(schema.actors).where(eq(schema.actors.id, isolatedActorId));
    await db.delete(schema.organisations).where(eq(schema.organisations.id, isolatedOrganisationId));
    await closeDatabase();
  });

  it("creates one task, audit and outbox event under replay/concurrency while keeping other organisations untouched", async () => {
    const results = await Promise.all([
      queueDueParkerReports(organisationId, `scheduler:${suffix}:one`),
      queueDueParkerReports(organisationId, `scheduler:${suffix}:two`),
    ]);
    expect(results.sort()).toEqual([0, 1]);
    expect(await queueDueParkerReports(organisationId, `scheduler:${suffix}:replay`)).toBe(0);

    const taskKey = `parker:schedule:${scheduleId}:${dueAt.toISOString()}`;
    const [tasks, audits, outbox, schedule, isolated] = await Promise.all([
      db.select().from(schema.tasks).where(and(eq(schema.tasks.organisationId, organisationId), eq(schema.tasks.idempotencyKey, taskKey))),
      db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.organisationId, organisationId), eq(schema.auditEvents.action, "report.schedule.task_created"))),
      db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.organisationId, organisationId), eq(schema.outboxEvents.eventType, "report.schedule.task_created"))),
      db.select().from(schema.reportSchedules).where(and(eq(schema.reportSchedules.organisationId, organisationId), eq(schema.reportSchedules.id, scheduleId))).limit(1),
      db.select().from(schema.reportSchedules).where(and(eq(schema.reportSchedules.organisationId, isolatedOrganisationId), eq(schema.reportSchedules.id, isolatedScheduleId))).limit(1),
    ]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.description).toContain("Pacific/Auckland");
    expect(audits).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(schedule[0]?.lastRunAt).toBeTruthy();
    expect(schedule[0]!.nextRunAt.getTime() - schedule[0]!.lastRunAt!.getTime()).toBe(7 * 86_400_000);
    expect(isolated[0]).toMatchObject({ lastRunAt: null, nextRunAt: dueAt });
  });
});
