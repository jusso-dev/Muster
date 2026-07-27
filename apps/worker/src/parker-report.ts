import { createHash } from "node:crypto";
import { buildParkerManifest, CreateParkerReportSchema } from "@muster/agents";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

const ParkerRunRequestSchema = z.object({
  kind: z.literal("parker_report"),
  reportId: z.uuid(),
  taskId: z.uuid(),
  input: CreateParkerReportSchema,
});

async function processParkerReportAttempt(
  organisationId: string,
  agentRunId: string,
  traceId: string,
  finalAttempt: boolean,
) {
  const db = database();
  const [row] = await db
    .select({
      run: schema.agentRuns,
      agent: schema.agentDefinitions,
    })
    .from(schema.agentRuns)
    .innerJoin(
      schema.agentDefinitions,
      and(
        eq(schema.agentDefinitions.id, schema.agentRuns.agentId),
        eq(schema.agentDefinitions.organisationId, organisationId),
      ),
    )
    .where(
      and(
        eq(schema.agentRuns.organisationId, organisationId),
        eq(schema.agentRuns.id, agentRunId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Authoritative Parker run not found");
  if (row.run.status === "completed") return;
  const request = ParkerRunRequestSchema.parse(row.run.request);
  const [task] = await db
    .select({
      id: schema.tasks.id,
      assignedActorId: schema.tasks.assignedActorId,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.organisationId, organisationId),
        eq(schema.tasks.id, request.taskId),
        eq(schema.tasks.roomId, request.input.roomId),
      ),
    )
    .limit(1);
  if (!task || task.assignedActorId !== row.agent.id) {
    throw new Error("Parker task assignment is no longer authorised");
  }
  if (
    row.agent.status !== "active" ||
    row.agent.killSwitch ||
    !Array.isArray(row.agent.allowedRooms) ||
    !row.agent.allowedRooms.includes(request.input.roomId)
  ) {
    throw new Error("Parker is no longer authorised for this room");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.agentRuns)
      .set({
        status: "running",
        startedAt: row.run.startedAt ?? new Date(),
        heartbeatAt: new Date(),
        attemptCount: sql`${schema.agentRuns.attemptCount} + 1`,
        progress: {
          stage: "calculating authoritative aggregates",
          percent: 20,
        },
      })
      .where(
        and(
          eq(schema.agentRuns.organisationId, organisationId),
          eq(schema.agentRuns.id, agentRunId),
        ),
      );
    await tx
      .update(schema.tasks)
      .set({
        status: "in_progress",
        agentRunStatus: "running",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.tasks.organisationId, organisationId),
          eq(schema.tasks.id, request.taskId),
        ),
      );
    await tx.insert(schema.agentRunEvents).values({
      id: newId(),
      organisationId,
      runId: agentRunId,
      eventType: "started",
      message: "Parker began authoritative report calculation",
      payload: { reportId: request.reportId },
    });
  });

  try {
    const { from, to } = request.input.period;
    const alerts = await db
      .select()
      .from(schema.alerts)
      .where(
        and(
          eq(schema.alerts.organisationId, organisationId),
          gte(schema.alerts.receivedAt, from),
          lt(schema.alerts.receivedAt, to),
        ),
      );
    const linkedInvestigationIds = alerts
      .map((alert) => alert.investigationId)
      .filter((id): id is string => Boolean(id));
    const investigationPeriod = and(
      gte(schema.investigations.createdAt, from),
      lt(schema.investigations.createdAt, to),
    );
    const investigations = await db
      .select()
      .from(schema.investigations)
      .where(
        and(
          eq(schema.investigations.organisationId, organisationId),
          linkedInvestigationIds.length
            ? or(
                investigationPeriod,
                inArray(schema.investigations.id, linkedInvestigationIds),
              )
            : investigationPeriod,
        ),
      );
    const [approvals, agentRuns, workflowRuns] = await Promise.all([
      db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.organisationId, organisationId),
            gte(schema.approvals.requestedAt, from),
            lt(schema.approvals.requestedAt, to),
          ),
        ),
      db
        .select()
        .from(schema.agentRuns)
        .where(
          and(
            eq(schema.agentRuns.organisationId, organisationId),
            or(
              and(
                gte(schema.agentRuns.startedAt, from),
                lt(schema.agentRuns.startedAt, to),
              ),
              and(
                isNull(schema.agentRuns.startedAt),
                gte(schema.agentRuns.completedAt, from),
                lt(schema.agentRuns.completedAt, to),
              ),
            ),
          ),
        ),
      db
        .select()
        .from(schema.workflowRuns)
        .where(
          and(
            eq(schema.workflowRuns.organisationId, organisationId),
            or(
              and(
                gte(schema.workflowRuns.startedAt, from),
                lt(schema.workflowRuns.startedAt, to),
              ),
              and(
                isNull(schema.workflowRuns.startedAt),
                gte(schema.workflowRuns.completedAt, from),
                lt(schema.workflowRuns.completedAt, to),
              ),
            ),
          ),
        ),
    ]);
    const manifest = buildParkerManifest(request.input, {
      alerts,
      investigations,
      approvals,
      agentRuns,
      workflowRuns,
    });
    const manifestHash = createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex");
    await db.transaction(async (tx) => {
      await tx.insert(schema.reportManifests).values({
        id: request.reportId,
        organisationId,
        agentRunId,
        taskId: request.taskId,
        roomId: request.input.roomId,
        requestedByActorId: row.run.requestedByActorId,
        manifest,
        classification: manifest.classification,
        idempotencyKey: request.input.idempotencyKey,
      });
      await tx
        .update(schema.agentRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
          heartbeatAt: new Date(),
          outputHash: manifestHash,
          outputSchema: "ReportManifest",
          structuredOutput: manifest,
          progress: { stage: "completed", percent: 100 },
          error: null,
          failureCode: null,
        })
        .where(
          and(
            eq(schema.agentRuns.organisationId, organisationId),
            eq(schema.agentRuns.id, agentRunId),
          ),
        );
      await tx
        .update(schema.tasks)
        .set({
          status: "review",
          agentRunStatus: "completed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.tasks.organisationId, organisationId),
            eq(schema.tasks.id, request.taskId),
          ),
        );
      await tx.insert(schema.agentRunEvents).values({
        id: newId(),
        organisationId,
        runId: agentRunId,
        eventType: "completed",
        message: "Parker stored deterministic report manifest",
        payload: {
          reportId: request.reportId,
          outputSchema: "ReportManifest",
        },
      });
      await appendAuditEvent(tx, {
        organisationId,
        actorId: row.agent.id,
        actorType: "agent",
        action: "report.generated",
        targetType: "report_manifest",
        targetId: request.reportId,
        metadata: {
          taskId: request.taskId,
          classification: manifest.classification,
          manifestHash,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId,
        eventType: "report.generated",
        aggregateType: "report_manifest",
        aggregateId: request.reportId,
        queueName: "muster-outbox",
        payload: { reportId: request.reportId, taskId: request.taskId },
        idempotencyKey: `report.generated:${request.reportId}`,
        traceId,
      });
    });
  } catch (error) {
    if (finalAttempt) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 2_000)
          : "Parker report generation failed";
      await db.transaction(async (tx) => {
        await tx
          .update(schema.agentRuns)
          .set({
            status: "failed",
            completedAt: new Date(),
            heartbeatAt: new Date(),
            error: message,
            failureCode: "report_generation_failed",
            progress: { stage: "failed", percent: 100 },
          })
          .where(
            and(
              eq(schema.agentRuns.organisationId, organisationId),
              eq(schema.agentRuns.id, agentRunId),
            ),
          );
        await tx
          .update(schema.tasks)
          .set({
            status: "ready",
            agentRunStatus: "failed",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.tasks.organisationId, organisationId),
              eq(schema.tasks.id, request.taskId),
            ),
          );
        await tx.insert(schema.agentRunEvents).values({
          id: newId(),
          organisationId,
          runId: agentRunId,
          eventType: "failed",
          message: "Parker report generation failed",
          payload: { failureCode: "report_generation_failed" },
        });
        await appendAuditEvent(tx, {
          organisationId,
          actorId: row.agent.id,
          actorType: "agent",
          action: "report.generation.failed",
          targetType: "agent_run",
          targetId: agentRunId,
          metadata: { failureCode: "report_generation_failed" },
          traceId,
        });
        await writeOutbox(tx, {
          organisationId,
          eventType: "report.generation.failed",
          aggregateType: "agent_run",
          aggregateId: agentRunId,
          queueName: "muster-outbox",
          payload: { agentRunId, failureCode: "report_generation_failed" },
          idempotencyKey: `report.generation.failed:${agentRunId}`,
          traceId,
        });
      });
    }
    throw error;
  }
}

export async function processParkerReport(
  organisationId: string,
  agentRunId: string,
  traceId: string,
  finalAttempt: boolean,
) {
  try {
    await processParkerReportAttempt(
      organisationId,
      agentRunId,
      traceId,
      finalAttempt,
    );
  } catch (error) {
    if (finalAttempt) {
      const db = database();
      const [run] = await db
        .select()
        .from(schema.agentRuns)
        .where(
          and(
            eq(schema.agentRuns.organisationId, organisationId),
            eq(schema.agentRuns.id, agentRunId),
          ),
        )
        .limit(1);
      if (run && run.status !== "failed") {
        const request = z
          .object({ taskId: z.uuid() })
          .safeParse(run.request).data;
        const message =
          error instanceof Error
            ? error.message.slice(0, 2_000)
            : "Parker report generation failed";
        await db.transaction(async (tx) => {
          await tx
            .update(schema.agentRuns)
            .set({
              status: "failed",
              completedAt: new Date(),
              heartbeatAt: new Date(),
              error: message,
              failureCode: "report_generation_failed",
              progress: { stage: "failed", percent: 100 },
            })
            .where(
              and(
                eq(schema.agentRuns.organisationId, organisationId),
                eq(schema.agentRuns.id, agentRunId),
              ),
            );
          if (request) {
            await tx
              .update(schema.tasks)
              .set({
                status: "ready",
                agentRunStatus: "failed",
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.tasks.organisationId, organisationId),
                  eq(schema.tasks.id, request.taskId),
                ),
              );
          }
          await tx.insert(schema.agentRunEvents).values({
            id: newId(),
            organisationId,
            runId: agentRunId,
            eventType: "failed",
            message: "Parker report generation failed",
            payload: { failureCode: "report_generation_failed" },
          });
          await appendAuditEvent(tx, {
            organisationId,
            actorId: run.agentId,
            actorType: "agent",
            action: "report.generation.failed",
            targetType: "agent_run",
            targetId: agentRunId,
            metadata: { failureCode: "report_generation_failed" },
            traceId,
          });
          await writeOutbox(tx, {
            organisationId,
            eventType: "report.generation.failed",
            aggregateType: "agent_run",
            aggregateId: agentRunId,
            queueName: "muster-outbox",
            payload: { agentRunId, failureCode: "report_generation_failed" },
            idempotencyKey: `report.generation.failed:${agentRunId}`,
            traceId,
          });
        });
      }
    }
    throw error;
  }
}
