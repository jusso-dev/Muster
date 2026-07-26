import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, count, eq } from "drizzle-orm";
import { createTask } from "./task-domain";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("task domain durability", () => {
  let actorId = "";
  let organisationId = "";

  beforeAll(async () => {
    const actors = await database().select().from(schema.actors);
    const actor = actors.find(
      (candidate) =>
        Array.isArray(candidate.capabilityAssignments) &&
        candidate.capabilityAssignments.includes("tasks.create"),
    );
    if (!actor) throw new Error("Seeded task creator required");
    actorId = actor.id;
    organisationId = actor.organisationId;
  });

  afterAll(closeDatabase);

  it("creates one task and one outbox event for an ambiguous retry", async () => {
    const idempotencyKey = `synthetic-task-create:${newId()}`;
    const context = {
      organisationId,
      actorId,
      traceId: `task-create:${newId()}`,
    };
    const input = {
      idempotencyKey,
      title: "Synthetic duplicate-safe task",
      description: "Prove ambiguous task retries do not invent durable work.",
      status: "backlog" as const,
      priority: "normal" as const,
      assignedActorId: null,
      roomId: null,
      investigationId: null,
      relatedCaseId: null,
      approvalRequired: false,
      dueAt: null,
    };

    const first = await createTask(context, input);
    const duplicate = await createTask(
      { ...context, traceId: `task-retry:${newId()}` },
      input,
    );
    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ id: first.id, created: false });

    const [taskCount] = await database()
      .select({ value: count() })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.organisationId, organisationId),
          eq(schema.tasks.idempotencyKey, idempotencyKey),
        ),
      );
    const [outboxCount] = await database()
      .select({ value: count() })
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.organisationId, organisationId),
          eq(schema.outboxEvents.aggregateId, first.id),
          eq(schema.outboxEvents.eventType, "task.created"),
        ),
      );
    expect(taskCount?.value).toBe(1);
    expect(outboxCount?.value).toBe(1);
  });
});
