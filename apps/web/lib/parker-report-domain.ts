import { createHash } from "node:crypto";
import {
  actionApprovalPolicy,
  capabilities,
  requireCapability,
  type AuthorisationSubject,
  type Capability,
} from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { ReportManifestSchema } from "@muster/contracts";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ApiProblem } from "./api-context";

const PeriodSchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((period) => period.from < period.to, "Report start must precede end.");

export const CreateParkerReportSchema = z.object({
  roomId: z.uuid(),
  taskId: z.uuid().optional(),
  audience: z.enum(["analyst", "leadership", "executive"]).default("analyst"),
  period: PeriodSchema,
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(
      (timezone) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: timezone });
          return true;
        } catch {
          return false;
        }
      },
      "Timezone must be an IANA timezone.",
    )
    .default("UTC"),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export const RequestReportEmailSchema = z.object({
  recipient: z.string().email().max(320),
  idempotencyKey: z.string().trim().min(8).max(200),
});
export const CreateParkerScheduleSchema = z.object({
  roomId: z.uuid(),
  cadence: z.enum(["weekly", "monthly"]),
  timezone: z.string().trim().min(1).max(100).refine((timezone) => {
    try { Intl.DateTimeFormat(undefined, { timeZone: timezone }); return true; } catch { return false; }
  }, "Timezone must be an IANA timezone."),
  audience: z.enum(["analyst", "leadership", "executive"]).default("leadership"),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export function nextParkerScheduleRun(cadence: "weekly" | "monthly", now = new Date()) {
  const next = new Date(now);
  if (cadence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

type Metric = z.infer<typeof ReportManifestSchema>["values"][number];

type AggregateData = {
  alerts: Array<typeof schema.alerts.$inferSelect>;
  investigations: Array<typeof schema.investigations.$inferSelect>;
  approvals: Array<typeof schema.approvals.$inferSelect>;
  agentRuns: Array<typeof schema.agentRuns.$inferSelect>;
  workflowRuns: Array<typeof schema.workflowRuns.$inferSelect>;
};

function inside(date: Date | null, from: Date, to: Date) {
  return !!date && date >= from && date < to;
}

function averageMinutes(values: number[]): Metric {
  if (!values.length)
    return { key: "metric", value: null, unit: "minutes", state: "not_applicable", sampleSize: 0 };
  const value = values.reduce((sum, item) => sum + item, 0) / values.length;
  return { key: "metric", value: Number(value.toFixed(2)), unit: "minutes", state: "available", sampleSize: values.length };
}

function rate(key: string, failed: number, total: number): Metric {
  if (!total)
    return { key, value: null, unit: "percent", state: "not_applicable", sampleSize: 0 };
  return { key, value: Number(((failed / total) * 100).toFixed(2)), unit: "percent", state: failed === 0 ? "zero" : "available", sampleSize: total };
}

function metric(key: string, values: number[]): Metric {
  const value = averageMinutes(values);
  return { ...value, key };
}

function requiredCapabilities(value: unknown): Capability[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (capability): capability is Capability =>
      typeof capability === "string" && capabilities.includes(capability as Capability),
  );
}

export function buildParkerManifest(
  input: z.infer<typeof CreateParkerReportSchema>,
  data: AggregateData,
) {
  const { from, to } = input.period;
  const periodAlerts = data.alerts.filter((alert) => inside(alert.receivedAt, from, to));
  const periodInvestigations = data.investigations.filter((row) => inside(row.createdAt, from, to));
  const periodApprovals = data.approvals.filter((row) => inside(row.requestedAt, from, to));
  const periodAgentRuns = data.agentRuns.filter((row) => inside(row.startedAt ?? row.completedAt, from, to));
  const periodWorkflowRuns = data.workflowRuns.filter((row) => inside(row.startedAt ?? row.completedAt, from, to));
  const investigationsById = new Map(data.investigations.map((row) => [row.id, row]));

  const investigationMinutes = periodAlerts.flatMap((alert) => {
    const investigation = alert.investigationId ? investigationsById.get(alert.investigationId) : undefined;
    return investigation ? [(investigation.createdAt.getTime() - alert.receivedAt.getTime()) / 60_000] : [];
  }).filter((value) => value >= 0);
  const approvalMinutes = periodApprovals.flatMap((row) =>
    row.decisionAt ? [(row.decisionAt.getTime() - row.requestedAt.getTime()) / 60_000] : [],
  ).filter((value) => value >= 0);
  const resolutionMinutes = periodInvestigations.flatMap((row) =>
    row.closedAt ? [(row.closedAt.getTime() - row.createdAt.getTime()) / 60_000] : [],
  ).filter((value) => value >= 0);
  const recurringAlertCount = periodAlerts.filter((alert) =>
    !!alert.correlationKey && periodAlerts.filter((other) => other.correlationKey === alert.correlationKey).length > 1,
  ).length;

  const values: Metric[] = [
    { key: "mtta", value: null, unit: "minutes", state: "unavailable", sampleSize: 0 },
    metric("time_to_investigation", investigationMinutes),
    { key: "time_to_promotion", value: null, unit: "minutes", state: "unavailable", sampleSize: 0 },
    metric("approval_wait", approvalMinutes),
    metric("mttr", resolutionMinutes),
    rate("recurrence_rate", recurringAlertCount, periodAlerts.length),
    rate("agent_failure_rate", periodAgentRuns.filter((row) => row.status === "failed").length, periodAgentRuns.length),
    rate("workflow_failure_rate", periodWorkflowRuns.filter((row) => row.status === "failed").length, periodWorkflowRuns.length),
  ];
  const definitions = [
    ["mtta", "Mean alert acknowledgement time.", "Acknowledged alerts in period.", "Unavailable: alerts do not yet retain acknowledgement timestamps."],
    ["time_to_investigation", "Mean received-to-investigation creation time.", "Alerts received in period linked to an investigation.", "Alerts without an investigation and negative durations excluded."],
    ["time_to_promotion", "Mean investigation-to-Kelpie promotion time.", "Promoted investigations in period.", "Unavailable: authoritative promotion timestamp is not stored."],
    ["approval_wait", "Mean approval request-to-decision time.", "Approvals requested in period with a decision.", "Pending approvals and negative durations excluded."],
    ["mttr", "Mean investigation creation-to-closure time.", "Investigations created in period and closed.", "Open investigations and negative durations excluded."],
    ["recurrence_rate", "Share of alerts whose correlation key occurs more than once in the period.", "Alerts received in period.", "Alerts without a correlation key are not recurrent."],
    ["agent_failure_rate", "Share of durable agent runs ending failed.", "Agent runs created in period.", "Cancelled runs remain in denominator but are not failures."],
    ["workflow_failure_rate", "Share of workflow runs ending failed.", "Workflow runs created in period.", "Cancelled runs remain in denominator but are not failures."],
  ].map(([key, definition, population, exclusions]) => ({ key, definition, population, exclusions }));
  const available = values.filter((value) => value.state === "available" || value.state === "zero");
  const narrative = input.audience === "executive"
    ? `Operational briefing for ${from.toISOString()} to ${to.toISOString()}. ${available.length} of ${values.length} governed metrics have authoritative values; unavailable metrics are explicitly withheld.`
    : `Parker calculated ${available.length} authoritative metrics for the requested period. Every value retains its population, exclusions, and stored query parameters.`;
  return ReportManifestSchema.parse({
    version: "parker-report-v1",
    audience: input.audience,
    period: { from: from.toISOString(), to: to.toISOString(), timezone: input.timezone, comparisonPeriod: null },
    filters: { organisationScoped: true, period: { from: from.toISOString(), to: to.toISOString() } },
    metricDefinitions: definitions,
    values,
    sourceReferences: [
      { source: "alerts", query: { receivedAt: { gte: from.toISOString(), lt: to.toISOString() }, organisationScoped: true } },
      { source: "investigations", query: { createdAt: { gte: from.toISOString(), lt: to.toISOString() }, organisationScoped: true } },
      { source: "approvals", query: { requestedAt: { gte: from.toISOString(), lt: to.toISOString() }, organisationScoped: true } },
      { source: "agent_runs", query: { startedAtOrCompletedAt: { gte: from.toISOString(), lt: to.toISOString() }, organisationScoped: true } },
      { source: "workflow_runs", query: { startedAtOrCompletedAt: { gte: from.toISOString(), lt: to.toISOString() }, organisationScoped: true } },
    ],
    narrative,
    caveats: values.filter((value) => value.state === "unavailable" || value.state === "not_applicable").map((value) => `${value.key}: ${value.state.replace("_", " ")}.`),
    classification: input.audience === "executive" ? "internal" : "restricted",
  });
}

export class ParkerReportDomainService {
  constructor(private readonly db = database()) {}

  private async requireRoomMembership(
    subject: AuthorisationSubject,
    roomId: string,
  ) {
    const [membership] = await this.db
      .select({ roomId: schema.roomMemberships.roomId })
      .from(schema.roomMemberships)
      .where(
        and(
          eq(schema.roomMemberships.organisationId, subject.organisationId),
          eq(schema.roomMemberships.roomId, roomId),
          eq(schema.roomMemberships.actorId, subject.actorId),
        ),
      )
      .limit(1);
    if (!membership)
      throw new ApiProblem(404, "Not found", "Report room not found.");
  }

  private async accessibleReport(subject: AuthorisationSubject, reportId: string) {
    const [row] = await this.db
      .select({ report: schema.reportManifests })
      .from(schema.reportManifests)
      .innerJoin(
        schema.roomMemberships,
        and(
          eq(schema.roomMemberships.organisationId, schema.reportManifests.organisationId),
          eq(schema.roomMemberships.roomId, schema.reportManifests.roomId),
          eq(schema.roomMemberships.actorId, subject.actorId),
        ),
      )
      .where(
        and(
          eq(schema.reportManifests.organisationId, subject.organisationId),
          eq(schema.reportManifests.id, reportId),
        ),
      )
      .limit(1);
    if (!row) throw new ApiProblem(404, "Not found", "Report does not exist.");
    return row.report;
  }

  async create(subject: AuthorisationSubject, raw: unknown, traceId: string) {
    requireCapability(subject, "agents.invoke");
    requireCapability(subject, "audit.read");
    const input = CreateParkerReportSchema.parse(raw);
    if (input.period.to.getTime() - input.period.from.getTime() > 366 * 24 * 60 * 60_000)
      throw new ApiProblem(400, "Report period too broad", "Reports are limited to 366 days.");
    const [room, parker, existing, task, data] = await Promise.all([
      this.db.select({ id: schema.roomMemberships.roomId }).from(schema.roomMemberships).where(and(eq(schema.roomMemberships.organisationId, subject.organisationId), eq(schema.roomMemberships.roomId, input.roomId), eq(schema.roomMemberships.actorId, subject.actorId))).limit(1).then((rows) => rows[0]),
      this.db.select({ id: schema.agentDefinitions.id, runtime: schema.agentDefinitions.runtime, model: schema.agentDefinitions.model, promptVersion: schema.agentDefinitions.systemPromptVersion, allowedRooms: schema.agentDefinitions.allowedRooms, capabilityRequirements: schema.agentDefinitions.capabilityRequirements }).from(schema.agentDefinitions).where(and(eq(schema.agentDefinitions.organisationId, subject.organisationId), eq(schema.agentDefinitions.name, "Parker"), eq(schema.agentDefinitions.status, "active"), eq(schema.agentDefinitions.killSwitch, false))).limit(1).then((rows) => rows[0]),
      this.db.select().from(schema.reportManifests).where(and(eq(schema.reportManifests.organisationId, subject.organisationId), eq(schema.reportManifests.idempotencyKey, input.idempotencyKey))).limit(1).then((rows) => rows[0]),
      input.taskId
        ? this.db
            .select({ id: schema.tasks.id, roomId: schema.tasks.roomId, assignedActorId: schema.tasks.assignedActorId })
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.organisationId, subject.organisationId),
                eq(schema.tasks.id, input.taskId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0])
        : Promise.resolve(undefined),
      Promise.all([
        this.db.select().from(schema.alerts).where(eq(schema.alerts.organisationId, subject.organisationId)),
        this.db.select().from(schema.investigations).where(eq(schema.investigations.organisationId, subject.organisationId)),
        this.db.select().from(schema.approvals).where(eq(schema.approvals.organisationId, subject.organisationId)),
        this.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.organisationId, subject.organisationId)),
        this.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.organisationId, subject.organisationId)),
      ]),
    ]);
    if (existing) {
      await this.requireRoomMembership(subject, existing.roomId);
      return { id: existing.id, status: existing.status, duplicate: true };
    }
    if (!room) throw new ApiProblem(404, "Not found", "Room not found.");
    if (input.taskId && !task)
      throw new ApiProblem(404, "Not found", "Task not found.");
    if (task && task.roomId !== input.roomId)
      throw new ApiProblem(409, "Task room mismatch", "The report task belongs to a different room.");
    if (!parker || !Array.isArray(parker.allowedRooms) || !parker.allowedRooms.includes(input.roomId))
      throw new ApiProblem(409, "Parker unavailable", "Parker is not active in this room.");
    if (task && task.assignedActorId !== parker.id)
      throw new ApiProblem(409, "Task agent mismatch", "The task is not assigned to Parker.");
    for (const capability of requiredCapabilities(parker.capabilityRequirements))
      requireCapability(subject, capability);
    const manifest = buildParkerManifest(input, { alerts: data[0], investigations: data[1], approvals: data[2], agentRuns: data[3], workflowRuns: data[4] });
    return this.db.transaction(async (tx) => {
      const reportId = newId();
      const runId = newId();
      const taskId = input.taskId ?? newId();
      if (!input.taskId) await tx.insert(schema.tasks).values({ id: taskId, organisationId: subject.organisationId, title: `Parker report: ${input.period.from.toISOString().slice(0, 10)}`, description: `Authoritative ${input.audience} report`, status: "review", priority: "normal", assignedActorId: parker.id, createdByActorId: subject.actorId, roomId: input.roomId, idempotencyKey: `parker-task:${input.idempotencyKey}`, approvalRequired: false, agentRunId: runId, agentRunStatus: "completed" });
      await tx.insert(schema.agentRuns).values({ id: runId, agentId: parker.id, organisationId: subject.organisationId, roomId: input.roomId, requestedByActorId: subject.actorId, trigger: "task", status: "completed", request: { kind: "parker_report", reportId, humanRequest: `Generate ${input.audience} report`, traceId }, progress: { stage: "completed", percent: 100 }, startedAt: new Date(), completedAt: new Date(), inputHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"), outputHash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"), outputSchema: "ReportManifest", structuredOutput: manifest, promptVersion: parker.promptVersion, runtime: parker.runtime, model: parker.model, idempotencyKey: `parker-agent-run:${input.idempotencyKey}` });
      if (input.taskId) await tx.update(schema.tasks).set({ status: "review", agentRunId: runId, agentRunStatus: "completed", updatedAt: new Date() }).where(and(eq(schema.tasks.organisationId, subject.organisationId), eq(schema.tasks.id, input.taskId)));
      await tx.insert(schema.reportManifests).values({ id: reportId, organisationId: subject.organisationId, agentRunId: runId, taskId, roomId: input.roomId, requestedByActorId: subject.actorId, manifest, classification: manifest.classification, idempotencyKey: input.idempotencyKey });
      await tx.insert(schema.agentRunEvents).values({ id: newId(), organisationId: subject.organisationId, runId, eventType: "completed", message: "Parker stored deterministic report manifest", payload: { reportId, outputSchema: "ReportManifest" } });
      await appendAuditEvent(tx, { organisationId: subject.organisationId, actorId: parker.id, actorType: "agent", action: "report.generated", targetType: "report_manifest", targetId: reportId, metadata: { taskId, classification: manifest.classification, manifestHash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex") }, traceId });
      return { id: reportId, taskId, agentRunId: runId, status: "draft", manifest, duplicate: false };
    });
  }

  async get(subject: AuthorisationSubject, reportId: string) {
    requireCapability(subject, "agents.read");
    return this.accessibleReport(subject, reportId);
  }

  async review(subject: AuthorisationSubject, reportId: string, note: string | undefined, traceId: string) {
    requireCapability(subject, "tasks.update");
    await this.accessibleReport(subject, reportId);
    return this.db.transaction(async (tx) => {
      const [report] = await tx.update(schema.reportManifests).set({ status: "reviewed", reviewNote: note?.slice(0, 2_000) ?? null, reviewedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.reportManifests.organisationId, subject.organisationId), eq(schema.reportManifests.id, reportId), eq(schema.reportManifests.status, "draft"))).returning();
      if (!report) throw new ApiProblem(409, "Review unavailable", "Only a draft report can be reviewed.");
      await appendAuditEvent(tx, { organisationId: subject.organisationId, actorId: subject.actorId, actorType: "human", action: "report.reviewed", targetType: "report_manifest", targetId: reportId, metadata: {}, traceId });
      return report;
    });
  }

  async createVersion(subject: AuthorisationSubject, reportId: string, traceId: string) {
    requireCapability(subject, "tasks.update");
    await this.accessibleReport(subject, reportId);
    return this.db.transaction(async (tx) => {
      const [report] = await tx.select().from(schema.reportManifests).where(and(eq(schema.reportManifests.organisationId, subject.organisationId), eq(schema.reportManifests.id, reportId))).for("update").limit(1);
      const versionKey = report ? `parker-report-version:${report.id}:${report.version + 1}` : "";
      const [existing] = versionKey
        ? await tx.select().from(schema.reportManifests).where(and(eq(schema.reportManifests.organisationId, subject.organisationId), eq(schema.reportManifests.idempotencyKey, versionKey))).limit(1)
        : [];
      if (existing)
        return { id: existing.id, previousId: reportId, version: existing.version, status: existing.status, duplicate: true };
      if (!report || !["reviewed", "posted"].includes(report.status))
        throw new ApiProblem(409, "Version unavailable", "Only a reviewed or posted report can be versioned.");
      const versionId = newId();
      await tx.update(schema.reportManifests).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(schema.reportManifests.organisationId, subject.organisationId), eq(schema.reportManifests.id, reportId)));
      await tx.insert(schema.reportManifests).values({
        id: versionId,
        organisationId: subject.organisationId,
        agentRunId: report.agentRunId,
        taskId: report.taskId,
        roomId: report.roomId,
        requestedByActorId: subject.actorId,
        version: report.version + 1,
        status: "draft",
        manifest: report.manifest,
        classification: report.classification,
        idempotencyKey: versionKey,
      });
      await appendAuditEvent(tx, { organisationId: subject.organisationId, actorId: subject.actorId, actorType: "human", action: "report.versioned", targetType: "report_manifest", targetId: versionId, metadata: { previousReportId: reportId, version: report.version + 1 }, traceId });
      return { id: versionId, previousId: reportId, version: report.version + 1, status: "draft", duplicate: false };
    });
  }

  async post(subject: AuthorisationSubject, reportId: string, traceId: string) {
    requireCapability(subject, "messages.create");
    await this.accessibleReport(subject, reportId);
    return this.db.transaction(async (tx) => {
      const [report] = await tx.select().from(schema.reportManifests).where(and(eq(schema.reportManifests.organisationId, subject.organisationId), eq(schema.reportManifests.id, reportId), eq(schema.reportManifests.status, "reviewed"))).limit(1);
      if (!report) throw new ApiProblem(409, "Post unavailable", "Review the report before posting it.");
      const manifest = ReportManifestSchema.parse(report.manifest);
      const messageId = newId();
      const [run] = report.agentRunId
        ? await tx.select({ agentId: schema.agentRuns.agentId }).from(schema.agentRuns).where(and(eq(schema.agentRuns.organisationId, subject.organisationId), eq(schema.agentRuns.id, report.agentRunId))).limit(1)
        : [];
      const message: typeof schema.messages.$inferInsert = {
        id: messageId,
        organisationId: subject.organisationId,
        roomId: report.roomId,
        authorActorId: run?.agentId ?? subject.actorId,
        messageType: "agent-status",
        document: { type: "parker-report", reportId, manifest, trust: "authoritative-aggregate" },
        plainText: manifest.narrative,
        dataClassification: manifest.classification,
        relatedAgentRunId: report.agentRunId,
        idempotencyKey: `parker-report-message:${report.id}`,
      };
      await tx.insert(schema.messages).values(message);
      await tx.update(schema.reportManifests).set({ status: "posted", postedMessageId: messageId, updatedAt: new Date() }).where(and(eq(schema.reportManifests.organisationId, subject.organisationId), eq(schema.reportManifests.id, reportId)));
      await writeOutbox(tx, { organisationId: subject.organisationId, eventType: "room.message.created", aggregateType: "message", aggregateId: messageId, queueName: "muster-outbox", payload: { messageId, roomId: report.roomId }, idempotencyKey: `room.message.created:parker-report:${report.id}`, traceId });
      await appendAuditEvent(tx, { organisationId: subject.organisationId, actorId: subject.actorId, actorType: "human", action: "report.posted", targetType: "report_manifest", targetId: reportId, metadata: { messageId }, traceId });
      return { id: reportId, messageId, status: "posted" };
    });
  }

  async requestEmail(subject: AuthorisationSubject, reportId: string, raw: unknown, traceId: string) {
    requireCapability(subject, "workflows.approve");
    await this.accessibleReport(subject, reportId);
    const input = RequestReportEmailSchema.parse(raw);
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.reportDeliveries)
        .where(
          and(
            eq(schema.reportDeliveries.organisationId, subject.organisationId),
            eq(schema.reportDeliveries.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.reportId !== reportId || existing.recipient !== input.recipient)
          throw new ApiProblem(409, "Idempotency conflict", "Email idempotency key belongs to a different request.");
        return { id: existing.id, approvalId: existing.approvalId, status: existing.status, duplicate: true };
      }
      const [report] = await tx.select().from(schema.reportManifests).where(and(eq(schema.reportManifests.organisationId, subject.organisationId), eq(schema.reportManifests.id, reportId), eq(schema.reportManifests.status, "reviewed"))).for("update").limit(1);
      if (!report) throw new ApiProblem(409, "Email unavailable", "Only reviewed reports can be emailed.");
      const deliveryId = newId(); const approvalId = newId(); const policy = actionApprovalPolicy["report.email.dispatch"];
      await tx.insert(schema.approvals).values({ id: approvalId, organisationId: subject.organisationId, requestingActorId: subject.actorId, actionType: "report.email.dispatch", target: { deliveryId, reportId }, riskSummary: `Emailing reviewed report ${reportId} to ${input.recipient} requires approval.`, expiresAt: new Date(Date.now() + 30 * 60_000), requiredCapability: policy.capability, requiredApprovalCount: policy.approvalCount, idempotencyKey: `parker-email-approval:${input.idempotencyKey}` });
      await tx.insert(schema.reportDeliveries).values({ id: deliveryId, organisationId: subject.organisationId, reportId, approvalId, requestedByActorId: subject.actorId, recipient: input.recipient, idempotencyKey: input.idempotencyKey });
      await appendAuditEvent(tx, { organisationId: subject.organisationId, actorId: subject.actorId, actorType: "human", action: "report.email.approval_requested", targetType: "report_delivery", targetId: deliveryId, metadata: { reportId }, traceId });
      return { id: deliveryId, approvalId, status: "awaiting_approval", duplicate: false };
    });
  }

  async createSchedule(subject: AuthorisationSubject, raw: unknown, traceId: string) {
    requireCapability(subject, "administration.manage");
    const input = CreateParkerScheduleSchema.parse(raw);
    await this.requireRoomMembership(subject, input.roomId);
    const [parker] = await this.db
      .select({ allowedRooms: schema.agentDefinitions.allowedRooms, capabilityRequirements: schema.agentDefinitions.capabilityRequirements })
      .from(schema.agentDefinitions)
      .where(and(eq(schema.agentDefinitions.organisationId, subject.organisationId), eq(schema.agentDefinitions.name, "Parker"), eq(schema.agentDefinitions.status, "active"), eq(schema.agentDefinitions.killSwitch, false)))
      .limit(1);
    if (!parker || !Array.isArray(parker.allowedRooms) || !parker.allowedRooms.includes(input.roomId))
      throw new ApiProblem(409, "Parker unavailable", "Parker is not active in this room.");
    for (const capability of requiredCapabilities(parker.capabilityRequirements))
      requireCapability(subject, capability);
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(schema.reportSchedules).where(and(eq(schema.reportSchedules.organisationId, subject.organisationId), eq(schema.reportSchedules.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) return { id: existing.id, nextRunAt: existing.nextRunAt, duplicate: true };
      const id = newId(); const nextRunAt = nextParkerScheduleRun(input.cadence);
      await tx.insert(schema.reportSchedules).values({ id, organisationId: subject.organisationId, roomId: input.roomId, createdByActorId: subject.actorId, cadence: input.cadence, timezone: input.timezone, audience: input.audience, nextRunAt, idempotencyKey: input.idempotencyKey });
      await appendAuditEvent(tx, { organisationId: subject.organisationId, actorId: subject.actorId, actorType: "human", action: "report.schedule.created", targetType: "report_schedule", targetId: id, metadata: { cadence: input.cadence, timezone: input.timezone, roomId: input.roomId }, traceId });
      return { id, nextRunAt, duplicate: false };
    });
  }
}
