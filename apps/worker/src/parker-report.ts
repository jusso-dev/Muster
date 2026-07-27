import { createHash } from "node:crypto";
import { buildParkerManifest, CreateParkerReportSchema } from "@muster/agents";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
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
  const claimToken = newId();
  const now = new Date();
  const [claimed] = await db
    .update(schema.agentRuns)
    .set({
      status: "running",
      startedAt: row.run.startedAt ?? now,
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
      workerId: claimToken,
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
        or(
          eq(schema.agentRuns.status, "queued"),
          and(
            eq(schema.agentRuns.status, "running"),
            or(
              isNull(schema.agentRuns.leaseExpiresAt),
              lte(schema.agentRuns.leaseExpiresAt, now),
            ),
          ),
        ),
      ),
    )
    .returning({ id: schema.agentRuns.id });
  if (!claimed) return;
  let request: z.infer<typeof ParkerRunRequestSchema> | undefined;
  try {
    const activeRequest = ParkerRunRequestSchema.parse(row.run.request);
    request = activeRequest;
    const [task] = await db
      .select({
        id: schema.tasks.id,
        assignedActorId: schema.tasks.assignedActorId,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.organisationId, organisationId),
          eq(schema.tasks.id, activeRequest.taskId),
          eq(schema.tasks.roomId, activeRequest.input.roomId),
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
      !row.agent.allowedRooms.includes(activeRequest.input.roomId)
    ) {
      throw new Error("Parker is no longer authorised for this room");
    }
    await db.transaction(async (tx) => {
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
            eq(schema.tasks.id, activeRequest.taskId),
          ),
        );
      await tx.insert(schema.agentRunEvents).values({
        id: newId(),
        organisationId,
        runId: agentRunId,
        eventType: "started",
        message: "Parker began authoritative report calculation",
        payload: { reportId: activeRequest.reportId },
      });
    });
    const { from, to } = activeRequest.input.period;
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
    const manifest = buildParkerManifest(activeRequest.input, {
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
      const [completed] = await tx
        .update(schema.agentRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
          heartbeatAt: new Date(),
          leaseExpiresAt: null,
          workerId: null,
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
            eq(schema.agentRuns.status, "running"),
            eq(schema.agentRuns.workerId, claimToken),
          ),
        )
        .returning({ id: schema.agentRuns.id });
      if (!completed) return;
      await tx.insert(schema.reportManifests).values({
        id: activeRequest.reportId,
        organisationId,
        agentRunId,
        taskId: activeRequest.taskId,
        roomId: activeRequest.input.roomId,
        requestedByActorId: row.run.requestedByActorId,
        manifest,
        classification: manifest.classification,
        idempotencyKey: activeRequest.input.idempotencyKey,
      });
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
            eq(schema.tasks.id, activeRequest.taskId),
          ),
        );
      await tx.insert(schema.agentRunEvents).values({
        id: newId(),
        organisationId,
        runId: agentRunId,
        eventType: "completed",
        message: "Parker stored deterministic report manifest",
        payload: {
          reportId: activeRequest.reportId,
          outputSchema: "ReportManifest",
        },
      });
      await appendAuditEvent(tx, {
        organisationId,
        actorId: row.agent.id,
        actorType: "agent",
        action: "report.generated",
        targetType: "report_manifest",
        targetId: activeRequest.reportId,
        metadata: {
          taskId: activeRequest.taskId,
          classification: manifest.classification,
          manifestHash,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId,
        eventType: "report.generated",
        aggregateType: "report_manifest",
        aggregateId: activeRequest.reportId,
        queueName: "muster-outbox",
        payload: {
          reportId: activeRequest.reportId,
          taskId: activeRequest.taskId,
        },
        idempotencyKey: `report.generated:${activeRequest.reportId}`,
        traceId,
      });
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 2_000)
        : "Parker report generation failed";
    if (!finalAttempt) {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.agentRuns)
          .set({
            status: "queued",
            heartbeatAt: new Date(),
            leaseExpiresAt: null,
            workerId: null,
            error: message,
            progress: { stage: "queued for retry", percent: 0 },
          })
          .where(
            and(
              eq(schema.agentRuns.organisationId, organisationId),
              eq(schema.agentRuns.id, agentRunId),
              eq(schema.agentRuns.status, "running"),
              eq(schema.agentRuns.workerId, claimToken),
            ),
          );
        if (request) {
          await tx
            .update(schema.tasks)
            .set({
              status: "in_progress",
              agentRunStatus: "queued",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.tasks.organisationId, organisationId),
                eq(schema.tasks.id, request.taskId),
              ),
            );
        }
      });
      throw error;
    }
    await db.transaction(async (tx) => {
      const [failed] = await tx
        .update(schema.agentRuns)
        .set({
          status: "failed",
          completedAt: new Date(),
          heartbeatAt: new Date(),
          leaseExpiresAt: null,
          workerId: null,
          error: message,
          failureCode: "report_generation_failed",
          progress: { stage: "failed", percent: 100 },
        })
        .where(
          and(
            eq(schema.agentRuns.organisationId, organisationId),
            eq(schema.agentRuns.id, agentRunId),
            eq(schema.agentRuns.status, "running"),
            eq(schema.agentRuns.workerId, claimToken),
          ),
        )
        .returning({ id: schema.agentRuns.id });
      if (!failed) return;
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
    throw error;
  }
}

export async function processParkerReport(
  organisationId: string,
  agentRunId: string,
  traceId: string,
  finalAttempt: boolean,
) {
  await processParkerReportAttempt(
    organisationId,
    agentRunId,
    traceId,
    finalAttempt,
  );
}
