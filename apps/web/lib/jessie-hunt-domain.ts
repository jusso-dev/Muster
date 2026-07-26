import { createHash } from "node:crypto";
import { isIP } from "node:net";
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
import {
  encryptConnectorPayload,
  QueryTemplateSchema,
  type QueryTemplate,
} from "@muster/integrations";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ApiProblem } from "./api-context";

const TimeRangeSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((range) => range.from < range.to, {
    message: "Hunt start must be before its end.",
  });

export const CreateJessieHuntSchema = z.object({
  question: z.string().trim().min(3).max(4_000),
  roomId: z.uuid(),
  taskId: z.uuid().optional(),
  sourceMessageId: z.uuid().optional(),
  investigationId: z.uuid().optional(),
  linkedCaseId: z.string().trim().min(1).max(200).optional(),
  sourceIds: z.array(z.uuid()).max(10).optional(),
  timeRange: TimeRangeSchema.optional(),
  maxRecordsPerSource: z.number().int().min(1).max(1_000).default(200),
  trainingMode: z.boolean().default(false),
  unifiSiteId: z.string().trim().min(1).max(160).optional(),
  sentinelWorkspaceId: z.string().trim().min(1).max(160).optional(),
  defenderSubscriptionId: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

type CreateJessieHunt = z.infer<typeof CreateJessieHuntSchema>;
type Db = ReturnType<typeof database>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type NormalizedObservable = {
  type:
    | "ip"
    | "domain"
    | "url"
    | "hash"
    | "identity"
    | "endpoint"
    | "cloud_resource";
  value: string;
  normalizedValue: string;
};

export type JessieHuntPlanQuery = {
  integrationId: string;
  templateId: string;
  product: string;
  source: string;
  templateKey: string;
  displayName: string;
  requiredCapability: Capability;
  input: Record<string, unknown>;
  rationale: string;
};

export type JessieHuntPlan = {
  version: "jessie-hunt-plan-v1";
  question: string;
  trainingMode: boolean;
  timeRange: { from: string; to: string; hours: number };
  limits: {
    maxSources: number;
    maxRecordsPerSource: number;
    maximumRuntimeSeconds: number;
    maximumConcurrentQueries: number;
  };
  observables: NormalizedObservable[];
  queries: Array<
    Omit<JessieHuntPlanQuery, "input"> & {
      inputSummary: Record<string, unknown>;
    }
  >;
  gaps: string[];
  approvalRequired: boolean;
  approvalReasons: string[];
};

type TemplateRow = {
  integrationId: string;
  product: string;
  source: string;
  templateId: string;
  definition: unknown;
};

const maxHuntHours = 24 * 30;
const maxHuntSources = 5;
const maximumConcurrentQueries = 2;

function encryptionKey() {
  const key = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!key)
    throw new ApiProblem(
      503,
      "Hunting unavailable",
      "Connector encryption is not configured.",
    );
  return key;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normaliseDomain(value: string) {
  return value.toLowerCase().replace(/\.$/, "");
}

export function extractObservables(question: string): NormalizedObservable[] {
  const values = new Map<string, NormalizedObservable>();
  const add = (observable: NormalizedObservable) => {
    const key = `${observable.type}:${observable.normalizedValue}`;
    if (!values.has(key)) values.set(key, observable);
  };

  for (const match of question.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    if (isIP(match[0]) === 4) {
      add({ type: "ip", value: match[0], normalizedValue: match[0] });
    }
  }
  for (const match of question.matchAll(
    /\b(?:[a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{32})\b/gi,
  )) {
    add({
      type: "hash",
      value: match[0],
      normalizedValue: match[0].toLowerCase(),
    });
  }
  for (const match of question.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    try {
      const url = new URL(match[0]);
      url.hostname = normaliseDomain(url.hostname);
      add({ type: "url", value: match[0], normalizedValue: url.toString() });
    } catch {
      // Invalid URL-shaped text remains ordinary question text.
    }
  }
  for (const match of question.matchAll(
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi,
  )) {
    const domain = normaliseDomain(match[0]);
    if (!values.has(`url:${domain}`)) {
      add({ type: "domain", value: match[0], normalizedValue: domain });
    }
  }
  for (const match of question.matchAll(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi,
  )) {
    add({
      type: "identity",
      value: match[0],
      normalizedValue: match[0].toLowerCase(),
    });
  }
  return [...values.values()].slice(0, 50);
}

function templateRequiredKeys(template: QueryTemplate) {
  const required = template.inputSchema.required;
  return Array.isArray(required)
    ? required.filter((value): value is string => typeof value === "string")
    : [];
}

function safeInputSummary(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      key === "query" && typeof value === "string"
        ? value.slice(0, 500)
        : value,
    ]),
  );
}

function sourceInput(
  row: TemplateRow,
  template: QueryTemplate,
  input: CreateJessieHunt,
  range: { from: Date; to: Date; hours: number },
  observables: NormalizedObservable[],
): Record<string, unknown> | null {
  const limit = Math.min(input.maxRecordsPerSource, 200);
  const observableValues = observables.map((item) => item.normalizedValue);
  const last = `${Math.max(1, Math.ceil(range.hours))}h`;
  switch (template.key) {
    case "tawny.hunt.run":
      return {
        query:
          observableValues.length > 0
            ? `last:"${last}" ${observableValues.map((value) => `"${value}"`).join(" ")}`
            : `last:"${last}"`,
        limit: input.maxRecordsPerSource,
      };
    case "unifi.sites.list":
      return { offset: 0, limit };
    case "unifi.clients.list":
    case "unifi.devices.list":
      return input.unifiSiteId
        ? {
            siteId: input.unifiSiteId,
            offset: 0,
            limit,
            filter: observableValues
              .map((value) => `ipAddress.eq('${value}')`)
              .join(" or "),
          }
        : null;
    case "kelpie.case.get":
      return input.linkedCaseId ? { caseId: input.linkedCaseId } : null;
    case "kelpie.cases.list":
    case "kelpie.observables.search":
      return template.key === "kelpie.observables.search"
        ? observableValues[0]
          ? { value: observableValues[0] }
          : null
        : {};
    case "sentinel.log_analytics.query":
      return input.sentinelWorkspaceId
        ? {
            workspaceId: input.sentinelWorkspaceId,
            query: [
              "union isfuzzy=true SecurityEvent, DeviceNetworkEvents",
              `| where TimeGenerated between (datetime(${range.from.toISOString()}) .. datetime(${range.to.toISOString()}))`,
              ...(observableValues.length > 0
                ? [
                    `| where tostring(pack_all()) has_any (${observableValues.map((value) => JSON.stringify(value)).join(", ")})`,
                  ]
                : []),
              `| take ${input.maxRecordsPerSource}`,
            ].join("\n"),
            timespan: `${range.from.toISOString()}/${range.to.toISOString()}`,
          }
        : null;
    case "defender_cloud.assessments.list":
      return input.defenderSubscriptionId
        ? { subscriptionId: input.defenderSubscriptionId }
        : null;
    default: {
      const required = templateRequiredKeys(template);
      if (required.length === 0) return {};
      const known: Record<string, unknown> = {
        query: observableValues.join(" "),
        limit: input.maxRecordsPerSource,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        startTime: range.from.toISOString(),
        endTime: range.to.toISOString(),
      };
      return required.every((key) => known[key] !== undefined)
        ? Object.fromEntries(required.map((key) => [key, known[key]]))
        : null;
    }
  }
}

function preferredTemplates(product: string, linkedCaseId?: string) {
  const byProduct: Record<string, string[]> = {
    tawny: ["tawny.hunt.run"],
    sentinel: ["sentinel.log_analytics.query"],
    defender_endpoint: ["mde.alerts.list"],
    defender_cloud: ["defender_cloud.assessments.list"],
    firewall: ["firewall.events.list"],
    cspm: ["cspm.findings.list"],
    kelpie: linkedCaseId
      ? ["kelpie.case.get", "kelpie.observables.search"]
      : ["kelpie.cases.list"],
    unifi: ["unifi.sites.list", "unifi.clients.list", "unifi.devices.list"],
  };
  return byProduct[product] ?? [];
}

function planText(plan: JessieHuntPlan) {
  const sourceList = plan.queries.map((query) => query.source).join(", ");
  return [
    `Jessie prepared a bounded hunt plan for: ${plan.question}`,
    `Window: ${plan.timeRange.from} to ${plan.timeRange.to} (${plan.timeRange.hours}h).`,
    `Sources: ${sourceList}. Limit: ${plan.limits.maxRecordsPerSource} records per source.`,
    plan.approvalRequired
      ? `Human approval required: ${plan.approvalReasons.join("; ")}.`
      : "The plan is within automatic read-only policy and has started.",
    "External results remain untrusted evidence. Facts and inference will be separated.",
  ].join("\n");
}

export class JessieHuntDomainService {
  constructor(private readonly db = database()) {}

  async create(subject: AuthorisationSubject, raw: unknown, traceId: string) {
    requireCapability(subject, "agents.invoke");
    const input = CreateJessieHuntSchema.parse(raw);
    const existing = await this.existing(
      subject.organisationId,
      input.idempotencyKey,
    );
    if (existing) return { ...existing, duplicate: true };

    const now = new Date();
    const from =
      input.timeRange?.from ?? new Date(now.getTime() - 24 * 60 * 60_000);
    const to = input.timeRange?.to ?? now;
    const hours = Math.ceil((to.getTime() - from.getTime()) / 3_600_000);
    if (hours > maxHuntHours) {
      throw new ApiProblem(
        400,
        "Hunt range too broad",
        `Hunt windows cannot exceed ${maxHuntHours} hours.`,
      );
    }

    const [room, jessie, task, sourceMessage] = await Promise.all([
      this.db
        .select({ id: schema.roomMemberships.roomId })
        .from(schema.roomMemberships)
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, input.roomId),
            eq(schema.roomMemberships.actorId, subject.actorId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      this.db
        .select({
          id: schema.agentDefinitions.id,
          name: schema.agentDefinitions.name,
          runtime: schema.agentDefinitions.runtime,
          model: schema.agentDefinitions.model,
          promptVersion: schema.agentDefinitions.systemPromptVersion,
          allowedRooms: schema.agentDefinitions.allowedRooms,
          maximumRuntimeSeconds: schema.agentDefinitions.maximumRuntimeSeconds,
          maximumTokenBudget: schema.agentDefinitions.maximumTokenBudget,
          maximumCostCents: schema.agentDefinitions.maximumCostCents,
          capabilities: schema.actors.capabilityAssignments,
        })
        .from(schema.agentDefinitions)
        .innerJoin(
          schema.actors,
          and(
            eq(schema.actors.organisationId, subject.organisationId),
            eq(schema.actors.id, schema.agentDefinitions.id),
          ),
        )
        .where(
          and(
            eq(schema.agentDefinitions.organisationId, subject.organisationId),
            eq(schema.agentDefinitions.name, "Jessie"),
            eq(schema.agentDefinitions.status, "active"),
            eq(schema.agentDefinitions.killSwitch, false),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      input.taskId
        ? this.db
            .select()
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.organisationId, subject.organisationId),
                eq(schema.tasks.id, input.taskId),
                eq(schema.tasks.roomId, input.roomId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0])
        : Promise.resolve(undefined),
      input.sourceMessageId
        ? this.db
            .select({ id: schema.messages.id })
            .from(schema.messages)
            .where(
              and(
                eq(schema.messages.organisationId, subject.organisationId),
                eq(schema.messages.id, input.sourceMessageId),
                eq(schema.messages.roomId, input.roomId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0])
        : Promise.resolve(undefined),
    ]);
    if (!room) throw new ApiProblem(404, "Not found", "Room not found.");
    if (!jessie)
      throw new ApiProblem(409, "Jessie unavailable", "Jessie is not active.");
    if (
      !Array.isArray(jessie.allowedRooms) ||
      !jessie.allowedRooms.includes(input.roomId)
    ) {
      throw new ApiProblem(
        403,
        "Jessie unavailable",
        "Jessie is not permitted in this room.",
      );
    }
    if (input.taskId && !task)
      throw new ApiProblem(404, "Not found", "Task not found in room.");
    if (task && task.assignedActorId !== jessie.id)
      throw new ApiProblem(
        409,
        "Jessie assignment required",
        "The task must be assigned to Jessie.",
      );
    if (input.sourceMessageId && !sourceMessage)
      throw new ApiProblem(404, "Not found", "Source message not found.");

    const rows = await this.db
      .select({
        integrationId: schema.integrationRecords.id,
        product: schema.integrationRecords.product,
        source: schema.integrationRecords.displayName,
        templateId: schema.integrationQueryTemplates.id,
        definition: schema.integrationQueryTemplates.definition,
      })
      .from(schema.integrationRecords)
      .innerJoin(
        schema.integrationQueryTemplates,
        and(
          eq(
            schema.integrationQueryTemplates.organisationId,
            schema.integrationRecords.organisationId,
          ),
          eq(
            schema.integrationQueryTemplates.integrationId,
            schema.integrationRecords.id,
          ),
          eq(schema.integrationQueryTemplates.enabled, true),
        ),
      )
      .where(
        and(
          eq(schema.integrationRecords.organisationId, subject.organisationId),
          inArray(schema.integrationRecords.status, ["configured", "healthy"]),
          ...(input.sourceIds?.length
            ? [inArray(schema.integrationRecords.id, input.sourceIds)]
            : []),
        ),
      )
      .orderBy(
        asc(schema.integrationRecords.displayName),
        asc(schema.integrationQueryTemplates.templateKey),
      );

    const observables = extractObservables(input.question);
    const gaps: string[] = [];
    const queries: JessieHuntPlanQuery[] = [];
    const usedIntegrations = new Set<string>();
    const jessieCapabilities = new Set(
      Array.isArray(jessie.capabilities)
        ? jessie.capabilities.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
    for (const row of rows) {
      if (queries.length >= 20) break;
      if (
        usedIntegrations.size >= maxHuntSources &&
        !usedIntegrations.has(row.integrationId)
      ) {
        continue;
      }
      const template = QueryTemplateSchema.parse(row.definition);
      const preferred = preferredTemplates(row.product, input.linkedCaseId);
      if (preferred.length > 0 && !preferred.includes(template.key)) continue;
      if (
        !capabilities.includes(template.requiredCapability as Capability) ||
        !subject.capabilities.has(template.requiredCapability as Capability) ||
        !jessieCapabilities.has(template.requiredCapability)
      ) {
        gaps.push(
          `${row.source} ${template.displayName} was excluded because an authoritative capability is missing.`,
        );
        continue;
      }
      const plannedInput = sourceInput(
        row,
        template,
        input,
        { from, to, hours },
        observables,
      );
      if (!plannedInput) {
        gaps.push(
          `${row.source} ${template.displayName} needs organisation-specific input before it can run.`,
        );
        continue;
      }
      queries.push({
        integrationId: row.integrationId,
        templateId: row.templateId,
        product: row.product,
        source: row.source,
        templateKey: template.key,
        displayName: template.displayName,
        requiredCapability: template.requiredCapability as Capability,
        input: plannedInput,
        rationale:
          observables.length > 0
            ? `Search for ${observables.map((item) => item.normalizedValue).join(", ")} in the bounded window.`
            : "Collect bounded source evidence relevant to the analyst question.",
      });
      usedIntegrations.add(row.integrationId);
    }
    if (queries.length === 0) {
      throw new ApiProblem(
        409,
        "No hunt sources",
        "No configured source can execute this bounded hunt with current capabilities and inputs.",
      );
    }

    const approvalReasons = [
      ...(hours > 24 ? [`time range is ${hours} hours`] : []),
      ...(input.maxRecordsPerSource > 500
        ? [`record limit is ${input.maxRecordsPerSource} per source`]
        : []),
      ...(usedIntegrations.size > 2
        ? [`plan spans ${usedIntegrations.size} sources`]
        : []),
    ];
    const approvalRequired = approvalReasons.length > 0;
    const plan: JessieHuntPlan = {
      version: "jessie-hunt-plan-v1",
      question: input.question,
      trainingMode: input.trainingMode,
      timeRange: {
        from: from.toISOString(),
        to: to.toISOString(),
        hours,
      },
      limits: {
        maxSources: maxHuntSources,
        maxRecordsPerSource: input.maxRecordsPerSource,
        maximumRuntimeSeconds: jessie.maximumRuntimeSeconds,
        maximumConcurrentQueries,
      },
      observables,
      queries: queries.map(({ input: queryInput, ...query }) => ({
        ...query,
        inputSummary: safeInputSummary(queryInput),
      })),
      gaps: [...new Set(gaps)].slice(0, 50),
      approvalRequired,
      approvalReasons,
    };

    const result = await this.db.transaction(async (tx) => {
      const concurrent = await this.existing(
        subject.organisationId,
        input.idempotencyKey,
        tx,
      );
      if (concurrent) return { ...concurrent, duplicate: true };

      const huntId = newId();
      const agentRunId = newId();
      const taskId = task?.id ?? newId();
      const approvalId = approvalRequired ? newId() : null;
      const agentStatus = approvalRequired
        ? "awaiting_approval"
        : "waiting_sources";
      if (!task) {
        await tx.insert(schema.tasks).values({
          id: taskId,
          organisationId: subject.organisationId,
          title: `Jessie hunt: ${input.question.slice(0, 180)}`,
          description: input.question,
          status: "in_progress",
          priority: "normal",
          assignedActorId: jessie.id,
          createdByActorId: subject.actorId,
          roomId: input.roomId,
          investigationId: input.investigationId ?? null,
          relatedCaseId: input.linkedCaseId ?? null,
          idempotencyKey: `jessie-hunt-task:${input.idempotencyKey}`,
          approvalRequired,
          agentRunId,
          agentRunStatus: agentStatus,
        });
      }
      await tx.insert(schema.agentRuns).values({
        id: agentRunId,
        agentId: jessie.id,
        organisationId: subject.organisationId,
        roomId: input.roomId,
        investigationId: input.investigationId ?? task?.investigationId ?? null,
        requestedByActorId: subject.actorId,
        trigger: input.sourceMessageId ? "mention" : "task",
        status: agentStatus,
        request: {
          kind: "jessie_hunt",
          huntId,
          humanRequest: input.question,
          traceId,
          huntPlan: plan,
        },
        progress: {
          stage: approvalRequired ? "awaiting_approval" : "querying",
          percent: approvalRequired ? 0 : 5,
        },
        deadlineAt: new Date(Date.now() + jessie.maximumRuntimeSeconds * 1_000),
        inputHash: sha256(JSON.stringify({ question: input.question, plan })),
        promptVersion: jessie.promptVersion,
        runtime: jessie.runtime,
        model: jessie.model,
        maximumRuntimeSeconds: jessie.maximumRuntimeSeconds,
        maximumTokenBudget: jessie.maximumTokenBudget,
        maximumCostCents: jessie.maximumCostCents,
        idempotencyKey: `jessie-agent-run:${input.idempotencyKey}`,
      });
      if (approvalId) {
        const policy = actionApprovalPolicy["hunt.execute-broad"];
        await tx.insert(schema.approvals).values({
          id: approvalId,
          organisationId: subject.organisationId,
          requestingActorId: subject.actorId,
          actionType: "hunt.execute-broad",
          target: { huntId, agentRunId },
          riskSummary: `Read-only hunt requires approval because ${approvalReasons.join("; ")}.`,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          requiredCapability: policy.capability,
          requiredApprovalCount: policy.approvalCount,
          idempotencyKey: `jessie-hunt-approval:${input.idempotencyKey}`,
        });
      }
      await tx.insert(schema.huntRuns).values({
        id: huntId,
        organisationId: subject.organisationId,
        agentRunId,
        taskId,
        sourceMessageId: input.sourceMessageId ?? null,
        roomId: input.roomId,
        linkedCaseId: input.linkedCaseId ?? task?.relatedCaseId ?? null,
        requestedByActorId: subject.actorId,
        question: input.question,
        trainingMode: input.trainingMode,
        plan,
        status: approvalRequired ? "awaiting_approval" : "querying",
        approvalId,
        idempotencyKey: input.idempotencyKey,
      });
      const queryRows = queries.map((query, sequence) => ({
        id: newId(),
        queryRunId: newId(),
        sequence,
        query,
      }));
      await tx.insert(schema.integrationQueryRuns).values(
        queryRows.map(({ queryRunId, query }) => ({
          id: queryRunId,
          organisationId: subject.organisationId,
          integrationId: query.integrationId,
          templateId: query.templateId,
          requestedByActorId: jessie.id,
          idempotencyKey: `jessie-query:${huntId}:${query.templateKey}:${query.integrationId}`,
          traceId,
          status: approvalRequired ? "planned" : "queued",
          input: {
            envelope: encryptConnectorPayload(query.input, encryptionKey()),
          },
          requestMetadata: {
            huntId,
            agentRunId,
            roomId: input.roomId,
            taskId,
            trust: "untrusted-evidence",
          },
        })),
      );
      await tx.insert(schema.huntQueries).values(
        queryRows.map(({ id, queryRunId, sequence, query }) => ({
          id,
          organisationId: subject.organisationId,
          huntId,
          integrationId: query.integrationId,
          templateId: query.templateId,
          queryRunId,
          sourceKey: `${query.product}:${query.templateKey}`,
          displayName: `${query.source} — ${query.displayName}`,
          sequence,
          rationale: query.rationale,
        })),
      );
      if (task) {
        await tx
          .update(schema.tasks)
          .set({
            status: "in_progress",
            approvalRequired,
            agentRunId,
            agentRunStatus: agentStatus,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.tasks.organisationId, subject.organisationId),
              eq(schema.tasks.id, task.id),
            ),
          );
      }
      await tx.insert(schema.agentRunEvents).values({
        id: newId(),
        organisationId: subject.organisationId,
        runId: agentRunId,
        eventType: approvalRequired ? "approval_requested" : "plan_started",
        message: approvalRequired
          ? "Bounded hunt plan awaits human approval"
          : "Bounded hunt plan started governed source queries",
        payload: {
          huntId,
          queryCount: queries.length,
          approvalId,
          limits: plan.limits,
        },
      });
      const planMessageId = newId();
      await tx.insert(schema.messages).values({
        id: planMessageId,
        organisationId: subject.organisationId,
        roomId: input.roomId,
        authorActorId: jessie.id,
        messageType: "query-result",
        document: {
          type: "jessie-hunt-plan",
          huntId,
          agentRunId,
          approvalId,
          plan,
          trust: "trusted-plan",
        },
        plainText: planText(plan),
        dataClassification: "internal",
        relatedInvestigationId:
          input.investigationId ?? task?.investigationId ?? null,
        relatedCaseId: input.linkedCaseId ?? task?.relatedCaseId ?? null,
        relatedAgentRunId: agentRunId,
        idempotencyKey: `jessie-hunt-plan-message:${huntId}`,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "room.message.created",
        aggregateType: "message",
        aggregateId: planMessageId,
        queueName: "muster-outbox",
        payload: { messageId: planMessageId, roomId: input.roomId },
        idempotencyKey: `room.message.created:jessie-hunt-plan:${huntId}`,
        traceId,
      });
      if (!approvalId) {
        for (const query of queryRows) {
          await writeOutbox(tx, {
            organisationId: subject.organisationId,
            eventType: "connector.query.queued",
            aggregateType: "integration_query",
            aggregateId: query.queryRunId,
            queueName: "muster-integrations",
            payload: { queryRunId: query.queryRunId, huntId },
            idempotencyKey: `connector.query:jessie-hunt:${query.queryRunId}`,
            traceId,
          });
        }
      }
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: approvalRequired
          ? "hunt.plan.approval_requested"
          : "hunt.plan.started",
        targetType: "hunt_run",
        targetId: huntId,
        metadata: {
          agentRunId,
          taskId,
          queryCount: queries.length,
          approvalId,
          planHash: sha256(JSON.stringify(plan)),
        },
        traceId,
      });
      return {
        id: huntId,
        agentRunId,
        taskId,
        status: approvalRequired ? "awaiting_approval" : "querying",
        approvalId,
        plan,
        duplicate: false,
      };
    });
    return result;
  }

  async get(subject: AuthorisationSubject, huntId: string) {
    requireCapability(subject, "agents.read");
    const [hunt] = await this.db
      .select()
      .from(schema.huntRuns)
      .where(
        and(
          eq(schema.huntRuns.organisationId, subject.organisationId),
          eq(schema.huntRuns.id, huntId),
        ),
      )
      .limit(1);
    if (!hunt)
      throw new ApiProblem(404, "Hunt not found", "Hunt does not exist.");
    const queries = await this.db
      .select({
        id: schema.huntQueries.id,
        displayName: schema.huntQueries.displayName,
        rationale: schema.huntQueries.rationale,
        sequence: schema.huntQueries.sequence,
        queryRunId: schema.huntQueries.queryRunId,
        status: schema.integrationQueryRuns.status,
        responseMetadata: schema.integrationQueryRuns.responseMetadata,
        errorCode: schema.integrationQueryRuns.errorCode,
        errorMessage: schema.integrationQueryRuns.errorMessage,
      })
      .from(schema.huntQueries)
      .innerJoin(
        schema.integrationQueryRuns,
        and(
          eq(
            schema.integrationQueryRuns.organisationId,
            schema.huntQueries.organisationId,
          ),
          eq(schema.integrationQueryRuns.id, schema.huntQueries.queryRunId),
        ),
      )
      .where(
        and(
          eq(schema.huntQueries.organisationId, subject.organisationId),
          eq(schema.huntQueries.huntId, huntId),
        ),
      )
      .orderBy(asc(schema.huntQueries.sequence));
    return { ...hunt, queries };
  }

  async maybeCreateFromMention(
    subject: AuthorisationSubject,
    input: {
      messageId: string;
      roomId: string;
      plainText: string;
      relatedInvestigationId?: string | null;
    },
    traceId: string,
  ) {
    if (!/(^|\s)@jessie\b/i.test(input.plainText)) return null;
    if (!subject.capabilities.has("agents.invoke")) return null;
    const question = input.plainText
      .replace(/(^|\s)@jessie\b[:,]?/i, " ")
      .trim();
    if (question.length < 3) return null;
    return this.create(
      subject,
      {
        question,
        roomId: input.roomId,
        sourceMessageId: input.messageId,
        investigationId: input.relatedInvestigationId ?? undefined,
        trainingMode: /\b(?:teach|training|explain|coach)\b/i.test(question),
        idempotencyKey: `jessie-mention:${input.messageId}`,
      },
      traceId,
    );
  }

  private async existing(
    organisationId: string,
    idempotencyKey: string,
    db: Pick<Db, "select"> | Tx = this.db,
  ) {
    const [hunt] = await db
      .select({
        id: schema.huntRuns.id,
        agentRunId: schema.huntRuns.agentRunId,
        taskId: schema.huntRuns.taskId,
        status: schema.huntRuns.status,
        approvalId: schema.huntRuns.approvalId,
        plan: schema.huntRuns.plan,
      })
      .from(schema.huntRuns)
      .where(
        and(
          eq(schema.huntRuns.organisationId, organisationId),
          eq(schema.huntRuns.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return hunt;
  }
}
