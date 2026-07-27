import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, eq } from "drizzle-orm";
import { processParkerReport } from "./parker-report";

const describeIntegration =
  process.env.MUSTER_INTEGRATION_TESTS === "true"
    ? describe.sequential
    : describe.skip;

describeIntegration("Parker asynchronous report execution", () => {
  const db = database();
  let organisationId = "";
  let parkerId = "";
  let roomId = "";
  let humanId = "";
  let runtime = "";
  let model = "";
  let promptVersion = "";

  beforeAll(async () => {
    const [parker] = await db
      .select()
      .from(schema.agentDefinitions)
      .where(
        and(
          eq(schema.agentDefinitions.name, "Parker"),
          eq(schema.agentDefinitions.status, "active"),
          eq(schema.agentDefinitions.killSwitch, false),
        ),
      )
      .limit(1);
    if (!parker) throw new Error("Bootstrap Parker before integration tests");
    organisationId = parker.organisationId;
    parkerId = parker.id;
    runtime = parker.runtime;
    model = parker.model;
    promptVersion = parker.systemPromptVersion;
    const [room] = await db
      .select({ id: schema.roomMemberships.roomId })
      .from(schema.roomMemberships)
      .where(
        and(
          eq(schema.roomMemberships.organisationId, organisationId),
          eq(schema.roomMemberships.actorId, parkerId),
        ),
      )
      .limit(1);
    if (!room) throw new Error("Bootstrap a Parker room");
    roomId = room.id;
    const [human] = await db
      .select({ id: schema.roomMemberships.actorId })
      .from(schema.roomMemberships)
      .innerJoin(
        schema.actors,
        and(
          eq(schema.actors.id, schema.roomMemberships.actorId),
          eq(schema.actors.organisationId, organisationId),
        ),
      )
      .where(
        and(
          eq(schema.roomMemberships.organisationId, organisationId),
          eq(schema.roomMemberships.roomId, roomId),
          eq(schema.actors.actorType, "human"),
        ),
      )
      .limit(1);
    if (!human) throw new Error("Bootstrap a human room member");
    humanId = human.id;
  });

  it("completes one authoritative manifest and is replay safe", async () => {
    const taskId = newId();
    const runId = newId();
    const reportId = newId();
    const idempotencyKey = `test:parker-async:${runId}`;
    const input = {
      roomId,
      taskId,
      audience: "leadership",
      period: {
        from: new Date(Date.now() - 7 * 86_400_000),
        to: new Date(),
      },
      timezone: "Pacific/Auckland",
      idempotencyKey,
    };
    await db.insert(schema.tasks).values({
      id: taskId,
      organisationId,
      roomId,
      title: "Synthetic Parker async report",
      description: "Generated test data only",
      status: "in_progress",
      priority: "normal",
      assignedActorId: parkerId,
      createdByActorId: humanId,
      idempotencyKey: `test:parker-task:${taskId}`,
      agentRunId: runId,
      agentRunStatus: "queued",
      approvalRequired: false,
    });
    await db.insert(schema.agentRuns).values({
      id: runId,
      agentId: parkerId,
      organisationId,
      roomId,
      requestedByActorId: humanId,
      trigger: "task",
      status: "queued",
      request: { kind: "parker_report", reportId, taskId, input },
      progress: { stage: "queued", percent: 0 },
      inputHash: "0".repeat(64),
      promptVersion,
      runtime,
      model,
      idempotencyKey: `test:parker-run:${runId}`,
    });

    await Promise.all([
      processParkerReport(organisationId, runId, newId(), false),
      processParkerReport(organisationId, runId, newId(), true),
    ]);
    await processParkerReport(organisationId, runId, newId(), false);

    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.organisationId, organisationId),
          eq(schema.agentRuns.id, runId),
        ),
      );
    const reports = await db
      .select()
      .from(schema.reportManifests)
      .where(
        and(
          eq(schema.reportManifests.organisationId, organisationId),
          eq(schema.reportManifests.id, reportId),
        ),
      );
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.organisationId, organisationId),
          eq(schema.tasks.id, taskId),
        ),
      );
    expect(run).toMatchObject({
      status: "completed",
      outputSchema: "ReportManifest",
      attemptCount: 1,
    });
    expect(reports).toHaveLength(1);
    expect(task).toMatchObject({
      status: "review",
      agentRunStatus: "completed",
    });
    expect(run?.outputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records a terminal authorisation failure without a manifest", async () => {
    const taskId = newId();
    const runId = newId();
    const reportId = newId();
    await db.insert(schema.tasks).values({
      id: taskId,
      organisationId,
      roomId,
      title: "Synthetic Parker rejected report",
      description: "Generated test data only",
      status: "in_progress",
      priority: "normal",
      assignedActorId: humanId,
      createdByActorId: humanId,
      idempotencyKey: `test:parker-task:${taskId}`,
      agentRunId: runId,
      agentRunStatus: "queued",
      approvalRequired: false,
    });
    await db.insert(schema.agentRuns).values({
      id: runId,
      agentId: parkerId,
      organisationId,
      roomId,
      requestedByActorId: humanId,
      trigger: "task",
      status: "queued",
      request: {
        kind: "parker_report",
        reportId,
        taskId,
        input: {
          roomId,
          taskId,
          audience: "executive",
          period: {
            from: new Date(Date.now() - 86_400_000),
            to: new Date(),
          },
          timezone: "UTC",
          idempotencyKey: `test:parker-failure:${runId}`,
        },
      },
      progress: { stage: "queued", percent: 0 },
      inputHash: "1".repeat(64),
      promptVersion,
      runtime,
      model,
      idempotencyKey: `test:parker-run:${runId}`,
    });

    await expect(
      processParkerReport(organisationId, runId, newId(), true),
    ).rejects.toThrow("assignment");
    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.organisationId, organisationId),
          eq(schema.agentRuns.id, runId),
        ),
      );
    const reports = await db
      .select({ id: schema.reportManifests.id })
      .from(schema.reportManifests)
      .where(
        and(
          eq(schema.reportManifests.organisationId, organisationId),
          eq(schema.reportManifests.id, reportId),
        ),
      );
    expect(run).toMatchObject({
      status: "failed",
      failureCode: "report_generation_failed",
    });
    expect(reports).toHaveLength(0);
  });

  afterAll(async () => {
    await closeDatabase();
  });
});
