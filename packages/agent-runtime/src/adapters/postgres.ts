import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  agentToolRegistry,
  redactSecrets,
  type ToolDefinition,
} from "@muster/agents";
import {
  actionApprovalPolicy,
  hasCapability,
  type ApprovalAction,
  type AuthorisationSubject,
} from "@muster/authz";
import { redactForObservation, redactObservationText } from "@muster/config";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { AgentRuntimeError } from "../errors.ts";
import {
  sanitiseRuntimeEvent,
  type AgentRuntimeEvent,
  type AgentRuntimeEventPayload,
  type AgentRuntimeEventType,
} from "../events.ts";
import type { RuntimeScope } from "../identity.ts";
import { defaultModelPolicy, ModelPolicySchema, type ModelPolicy } from "../model/types.ts";
import type {
  AgentDirectoryPort,
  AgentRuntimePorts,
  ApprovalPort,
  ApprovalRequest,
  ApprovalState,
  MemoryPort,
  ProposedMemory,
  RunRecordPort,
  RunTerminalState,
  RuntimeAgentRecord,
  RuntimeGuardPort,
  ToolAuthorisationDecision,
  ToolExecutionPort,
  ToolOutcome,
  ToolPolicyPort,
  ToolReservation,
} from "../ports.ts";

/**
 * PostgreSQL is the only authority for identity, enablement, capabilities,
 * approvals, tool permissions and run status. Every query in this file ANDs
 * an organisation predicate onto the row identifier so a cross-tenant id
 * resolves to nothing rather than leaking a row.
 */

type Db = ReturnType<typeof database>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Model/tool turns a run may take before the graph stops it. */
export const DEFAULT_MAXIMUM_STEPS = 12;

/**
 * A tool-call approval gates a single bounded action, not a multi-day
 * publication decision (compare the 7-day window `apps/web/lib/
 * agent-learning-domain.ts` uses for human-managed skill publication). Expire
 * quickly so a stale approval can't authorise an action long after the risk
 * that justified it changed.
 */
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * `agentDefinitions.model` has no dedicated policy column. Agents select a
 * capability class (or, for advanced configuration, a JSON-encoded
 * `ModelPolicy`) through this single text field, and this function is the
 * only place that reads it. It never throws: unknown or malformed content
 * always resolves to a usable policy.
 */
export function modelPolicyForAgent(
  agentModel: string,
  runtime: string,
): ModelPolicy {
  const trimmed = agentModel.trim();
  const runsLocally = runtime.trim().toLowerCase() === "local";
  if (trimmed.startsWith("{")) {
    try {
      const candidate: unknown = JSON.parse(trimmed);
      const parsed = ModelPolicySchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
    } catch {
      // Not valid JSON after all; treated as unusable below rather than
      // used literally as a model class name.
    }
    return defaultModelPolicy;
  }
  if (trimmed.length === 0) return defaultModelPolicy;
  const parsed = ModelPolicySchema.safeParse({
    preferred: trimmed,
    allowLocal: runsLocally,
  });
  return parsed.success ? parsed.data : defaultModelPolicy;
}

/**
 * Tools that reach outside the organisation's own records (fetching an
 * allowlisted external URL) hand back untrusted, non-internal evidence;
 * everything else reasons over data Muster already classified as internal.
 * `ToolDefinition` has no classification field of its own, so this is the
 * single, pure, total place that derives one.
 */
export function classificationForTool(tool: ToolDefinition): string {
  return tool.allowedUrlOrigins && tool.allowedUrlOrigins.length > 0
    ? "external"
    : "internal";
}

/** `agent-runtime.tool:{runId}:{toolCallId}` — stable across replays. */
export function toolCallIdempotencyKey(
  runId: string,
  toolCallId: string,
): string {
  return `agent-runtime.tool:${runId}:${toolCallId}`;
}

function isKnownApprovalAction(action: string): action is ApprovalAction {
  return Object.hasOwn(actionApprovalPolicy, action);
}

/**
 * The `approvals.status` enum carries operational states (`cancelled`,
 * `executed`, `failed`) the runtime's narrower `ApprovalState` does not need
 * to distinguish. `executed` folds into `approved` (the decision that
 * authorised it stands); anything else that isn't `pending`/`expired`/
 * `approved` collapses to `rejected`, which is the fail-closed choice.
 */
export function mapApprovalState(status: string): ApprovalState {
  switch (status) {
    case "pending":
      return "pending";
    case "approved":
    case "executed":
      return "approved";
    case "expired":
      return "expired";
    default:
      return "rejected";
  }
}

function runtimeEventMessage(type: AgentRuntimeEventType): string {
  switch (type) {
    case "run.queued":
      return "Agent run is queued.";
    case "run.started":
      return "Agent run started.";
    case "model.started":
      return "Model turn started.";
    case "model.completed":
      return "Model turn completed.";
    case "tool.proposed":
      return "The model proposed a tool call.";
    case "tool.approval_required":
      return "The proposed tool call requires human approval.";
    case "tool.started":
      return "Tool execution started.";
    case "tool.progress":
      return "Tool execution reported progress.";
    case "tool.completed":
      return "Tool execution completed.";
    case "tool.failed":
      return "Tool execution failed.";
    case "memory.proposed":
      return "The run proposed durable memories for review.";
    case "run.completed":
      return "Agent run completed.";
    case "run.failed":
      return "Agent run failed.";
    case "run.cancelled":
      return "Agent run was cancelled.";
  }
}

async function nextSequence(
  tx: Tx,
  scope: Pick<RuntimeScope, "organisationId" | "runId">,
): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.agentRunEvents)
    .where(
      and(
        eq(schema.agentRunEvents.organisationId, scope.organisationId),
        eq(schema.agentRunEvents.runId, scope.runId),
      ),
    );
  return (row?.total ?? 0) + 1;
}

async function insertRunEvent(
  tx: Tx,
  scope: Pick<RuntimeScope, "organisationId" | "runId">,
  candidate: Record<string, unknown>,
): Promise<{ sequence: number; occurredAt: string; sanitised: AgentRuntimeEvent }> {
  const sequence = await nextSequence(tx, scope);
  const occurredAt = new Date();
  const sanitised = sanitiseRuntimeEvent({
    ...candidate,
    runId: scope.runId,
    organisationId: scope.organisationId,
    sequence,
    occurredAt: occurredAt.toISOString(),
  });
  await tx.insert(schema.agentRunEvents).values({
    id: newId(),
    organisationId: scope.organisationId,
    runId: scope.runId,
    eventType: sanitised.type,
    message: runtimeEventMessage(sanitised.type),
    payload: sanitised,
    createdAt: occurredAt,
  });
  return { sequence, occurredAt: occurredAt.toISOString(), sanitised };
}

function terminalMetadata(terminal: RunTerminalState): Record<string, unknown> {
  if (terminal.status === "completed") {
    return {
      outputHash: terminal.outputHash,
      outputSchema: terminal.outputSchema,
      tokenUsage: terminal.usage,
      estimatedCostCents: terminal.estimatedCostCents,
    };
  }
  if (terminal.status === "failed") {
    return { failureCode: terminal.failureCode };
  }
  return { reason: terminal.reason };
}

export function createPostgresGuardPort(
  options: { db?: Db } = {},
): RuntimeGuardPort {
  const db = options.db ?? database();
  return {
    async assertRunnable(scope) {
      // One joined, organisation-scoped read: this runs between every graph
      // step, so it stays a single cheap query rather than three round trips.
      const [row] = await db
        .select({
          runStatus: schema.agentRuns.status,
          cancellationRequestedAt: schema.agentRuns.cancellationRequestedAt,
          agentStatus: schema.agentDefinitions.status,
          killSwitch: schema.agentDefinitions.killSwitch,
          actorStatus: schema.actors.status,
        })
        .from(schema.agentRuns)
        .innerJoin(
          schema.agentDefinitions,
          and(
            eq(schema.agentDefinitions.id, schema.agentRuns.agentId),
            eq(
              schema.agentDefinitions.organisationId,
              schema.agentRuns.organisationId,
            ),
          ),
        )
        .leftJoin(
          schema.actors,
          and(
            eq(schema.actors.id, schema.agentDefinitions.id),
            eq(
              schema.actors.organisationId,
              schema.agentDefinitions.organisationId,
            ),
          ),
        )
        .where(
          and(
            eq(schema.agentRuns.id, scope.runId),
            eq(schema.agentRuns.organisationId, scope.organisationId),
            eq(schema.agentRuns.agentId, scope.agentId),
          ),
        )
        .limit(1);
      if (!row) {
        return {
          runnable: false,
          code: "stale_run",
          reason: "Run row is missing for this organisation and agent.",
        };
      }
      if (row.killSwitch) {
        return {
          runnable: false,
          code: "agent_kill_switch",
          reason: "Agent is disabled by its kill switch.",
        };
      }
      if (row.agentStatus !== "active" || row.actorStatus !== "active") {
        return {
          runnable: false,
          code: "agent_inactive",
          reason: "Agent is inactive.",
        };
      }
      if (
        row.runStatus === "cancelled" ||
        row.cancellationRequestedAt !== null
      ) {
        return {
          runnable: false,
          code: "cancelled",
          reason: "Run cancellation was requested.",
        };
      }
      return { runnable: true };
    },
  };
}

export function createPostgresAgentDirectoryPort(
  options: { db?: Db } = {},
): AgentDirectoryPort {
  const db = options.db ?? database();
  return {
    async load(scope): Promise<RuntimeAgentRecord | null> {
      const [row] = await db
        .select()
        .from(schema.agentDefinitions)
        .where(
          and(
            eq(schema.agentDefinitions.id, scope.agentId),
            eq(schema.agentDefinitions.organisationId, scope.organisationId),
          ),
        )
        .limit(1);
      if (!row) return null;
      const allowedTools = Array.isArray(row.allowedTools)
        ? row.allowedTools.filter(
            (tool): tool is string => typeof tool === "string",
          )
        : [];
      return {
        id: row.id,
        organisationId: row.organisationId,
        name: row.name,
        status: row.status,
        killSwitch: row.killSwitch,
        allowedTools,
        systemPromptVersion: row.systemPromptVersion,
        modelPolicy: modelPolicyForAgent(row.model, row.runtime),
        maximumTokenBudget: row.maximumTokenBudget,
        maximumCostCents: row.maximumCostCents,
        maximumSteps: DEFAULT_MAXIMUM_STEPS,
      };
    },
  };
}

export function createPostgresMemoryPort(
  options: { db?: Db } = {},
): MemoryPort {
  const db = options.db ?? database();
  return {
    async retrieve(scope, limit) {
      const now = new Date();
      const rows = await db
        .select()
        .from(schema.agentMemories)
        .where(
          and(
            eq(schema.agentMemories.organisationId, scope.organisationId),
            eq(schema.agentMemories.agentId, scope.agentId),
            eq(schema.agentMemories.status, "active"),
            or(
              isNull(schema.agentMemories.expiresAt),
              gt(schema.agentMemories.expiresAt, now),
            ),
          ),
        )
        .orderBy(
          desc(schema.agentMemories.confidence),
          desc(schema.agentMemories.createdAt),
        )
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        content: row.content,
        confidence: row.confidence,
        classification: row.classification,
      }));
    },
    async propose(scope, memories: readonly ProposedMemory[]) {
      if (memories.length === 0) return 0;
      const rows = memories.map((memory) => ({
        id: newId(),
        organisationId: scope.organisationId,
        agentId: scope.agentId,
        sourceRunId: scope.runId,
        kind: memory.kind,
        title: memory.title,
        content: redactObservationText(redactSecrets(memory.content)),
        confidence: memory.confidence,
        // `agent_memories_status_check` only allows ('active','superseded',
        // 'expired','rejected') — there is no distinct "awaiting review"
        // value. This mirrors the existing terminal-run note precedent in
        // apps/agent-gateway/src/runtime.ts (complete()/fail()): "active"
        // means retrievable-as-context, not trusted-instruction. Per ADR
        // 0003, durable learning notes are always supplied to later runs as
        // evidence a prompt cites, never as system policy or a trusted
        // instruction, so activating them here does not grant self-trust.
        status: "active" as const,
      }));
      const inserted = await db
        .insert(schema.agentMemories)
        .values(rows)
        .returning({ id: schema.agentMemories.id });
      return inserted.length;
    },
  };
}

export function createPostgresApprovalPort(
  options: { db?: Db } = {},
): ApprovalPort {
  const db = options.db ?? database();
  return {
    async require(scope, request: ApprovalRequest) {
      if (!isKnownApprovalAction(request.approvalAction)) {
        throw new AgentRuntimeError(
          `Unknown approval action: ${request.approvalAction}`,
          "policy_denied",
        );
      }
      const policy = actionApprovalPolicy[request.approvalAction];
      if ("prohibited" in policy) {
        throw new AgentRuntimeError(
          `Approval action is prohibited: ${request.approvalAction}`,
          "policy_denied",
        );
      }
      const requiredCapability = policy.capability;
      const requiredApprovalCount = policy.approvalCount;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);
      const id = newId();
      return db.transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.approvals)
          .values({
            id,
            organisationId: scope.organisationId,
            requestingActorId: scope.agentId,
            actionType: request.approvalAction,
            target: {
              runId: scope.runId,
              toolName: request.toolName,
              argumentsHash: request.argumentsHash,
            },
            riskSummary: request.riskSummary,
            expiresAt,
            requiredCapability,
            requiredApprovalCount,
            idempotencyKey: request.idempotencyKey,
          })
          .onConflictDoNothing({
            target: [
              schema.approvals.organisationId,
              schema.approvals.idempotencyKey,
            ],
          })
          .returning();
        const row =
          inserted[0] ??
          (
            await tx
              .select()
              .from(schema.approvals)
              .where(
                and(
                  eq(schema.approvals.organisationId, scope.organisationId),
                  eq(
                    schema.approvals.idempotencyKey,
                    request.idempotencyKey,
                  ),
                ),
              )
              .limit(1)
          )[0];
        if (!row) {
          throw new AgentRuntimeError(
            "Approval record vanished after an insert conflict",
            "runtime_error",
          );
        }
        // Only the transaction that actually created the row writes the
        // audit event; a replayed interrupt reads the existing decision
        // without ever appending a second entry to the tenant hash chain.
        if (inserted[0]) {
          await appendAuditEvent(tx, {
            organisationId: scope.organisationId,
            actorId: scope.agentId,
            actorType: "agent",
            action: "agent.approval.required",
            targetType: "approval",
            targetId: row.id,
            metadata: {
              toolName: request.toolName,
              approvalAction: request.approvalAction,
            },
            traceId: `agent-run-${scope.runId}`,
          });
        }
        return { approvalId: row.id, state: mapApprovalState(row.status) };
      });
    },
    async read(scope, approvalId) {
      const [row] = await db
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.organisationId, scope.organisationId),
            eq(schema.approvals.id, approvalId),
          ),
        )
        .limit(1);
      if (!row) return null;
      return { approvalId: row.id, state: mapApprovalState(row.status) };
    },
  };
}

export function createPostgresToolPolicyPort(
  _options: { db?: Db } = {},
): ToolPolicyPort {
  return {
    async authorise(
      _scope,
      subject: AuthorisationSubject,
      agent,
      toolName,
      rawArguments,
    ): Promise<ToolAuthorisationDecision & { validatedArguments?: unknown }> {
      // Dispatch never goes beyond this Map lookup: the model-supplied
      // string only ever selects a pre-registered definition, never code,
      // and no query runs before every gate below has been decided.
      const tool = agentToolRegistry.get(toolName);
      if (!tool) {
        return {
          outcome: "denied",
          reason: "Tool is not registered",
          code: "tool_not_registered",
        };
      }
      if (!agent.allowedTools.includes(toolName)) {
        return {
          outcome: "denied",
          reason: "Tool is not allowlisted for this agent",
          code: "policy_denied",
        };
      }
      if (!hasCapability(subject, tool.capability)) {
        return {
          outcome: "denied",
          reason: `Missing capability: ${tool.capability}`,
          code: "policy_denied",
        };
      }
      const classification = classificationForTool(tool);
      if (tool.mutation) {
        if (!tool.approvalAction) {
          return {
            outcome: "denied",
            reason: "Mutating tool has no approval policy",
            code: "policy_denied",
          };
        }
        const policy = actionApprovalPolicy[tool.approvalAction];
        if ("prohibited" in policy) {
          return {
            outcome: "denied",
            reason: `Tool action is prohibited: ${tool.approvalAction}`,
            code: "policy_denied",
          };
        }
        const parsed = tool.argumentSchema.safeParse(rawArguments);
        if (!parsed.success) {
          return {
            outcome: "denied",
            reason: "Tool arguments failed validation",
            code: "invalid_tool_arguments",
          };
        }
        return {
          outcome: "approval_required",
          capability: tool.capability,
          approvalAction: tool.approvalAction,
          classification,
          validatedArguments: parsed.data,
        };
      }
      const parsed = tool.argumentSchema.safeParse(rawArguments);
      if (!parsed.success) {
        return {
          outcome: "denied",
          reason: "Tool arguments failed validation",
          code: "invalid_tool_arguments",
        };
      }
      return {
        outcome: "allowed",
        capability: tool.capability,
        classification,
        validatedArguments: parsed.data,
      };
    },
  };
}

/**
 * A registered tool's server-side implementation. Issue #72 owns the governed
 * connector and MCP executors; this runtime only guarantees that whatever is
 * registered here runs at most once per reservation.
 */
export type ToolExecutor = (input: {
  scope: RuntimeScope;
  subject: AuthorisationSubject;
  toolCallId: string;
  arguments: unknown;
  signal?: AbortSignal;
}) => Promise<unknown>;

export type ToolExecutionPortOptions = {
  db?: Db;
  /** Keyed by registered tool name. Empty until the governed executor lands. */
  executors?: ReadonlyMap<string, ToolExecutor>;
};

export function createPostgresToolExecutionPort(
  options: ToolExecutionPortOptions = {},
): ToolExecutionPort {
  const db = options.db ?? database();
  const executors = options.executors ?? new Map<string, ToolExecutor>();
  return {
    async reserve(scope, input): Promise<ToolReservation> {
      const idempotencyKey = toolCallIdempotencyKey(
        scope.runId,
        input.toolCallId,
      );
      const inserted = await db
        .insert(schema.agentToolCalls)
        .values({
          id: newId(),
          organisationId: scope.organisationId,
          runId: scope.runId,
          toolName: input.toolName,
          capability: input.capability,
          classification: input.classification,
          argumentsHash: input.argumentsHash,
          approvalId: input.approvalId,
          status: "running",
          toolCallId: input.toolCallId,
          idempotencyKey,
          checkpointId: input.checkpointId,
        })
        .onConflictDoNothing({
          target: [
            schema.agentToolCalls.organisationId,
            schema.agentToolCalls.idempotencyKey,
          ],
        })
        .returning({ id: schema.agentToolCalls.id });
      if (inserted[0]) {
        return {
          status: "reserved",
          toolCallRecordId: inserted[0].id,
          replayed: false,
        };
      }
      const [existing] = await db
        .select()
        .from(schema.agentToolCalls)
        .where(
          and(
            eq(schema.agentToolCalls.organisationId, scope.organisationId),
            eq(schema.agentToolCalls.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new AgentRuntimeError(
          "Tool call reservation vanished after an insert conflict",
          "runtime_error",
        );
      }
      if (existing.status === "completed") {
        return {
          status: "already_completed",
          result: existing.result,
          resultHash: existing.resultHash ?? "",
        };
      }
      if (existing.status === "failed") {
        return {
          status: "already_failed",
          error: existing.error ?? "Tool call failed",
        };
      }
      // Still running: a previous attempt reserved this call and did not
      // settle it. The caller decides whether that is safe to repeat.
      return {
        status: "reserved",
        toolCallRecordId: existing.id,
        replayed: true,
      };
    },
    // Dispatch is a closed map lookup on the already-authorised tool name, so
    // a model-supplied string can never reach anything unregistered. Issue #72
    // supplies the governed connector and MCP executors; until then an
    // unregistered tool fails safely rather than inventing a side effect.
    async execute(scope, subject, input): Promise<ToolOutcome> {
      const executor = executors.get(input.toolName);
      if (!executor) {
        return { status: "failed", error: "Tool has no registered executor" };
      }
      try {
        const result = await executor({
          scope,
          subject,
          toolCallId: input.toolCallId,
          arguments: input.arguments,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        return { status: "completed", result };
      } catch (error) {
        return {
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "Tool execution failed for an unknown reason",
        };
      }
    },
    async settle(scope, input): Promise<void> {
      const now = new Date();
      await db.transaction(async (tx) => {
        if (input.outcome.status === "completed") {
          const redacted = redactForObservation(input.outcome.result);
          const resultHash = sha256(JSON.stringify(redacted));
          const [updated] = await tx
            .update(schema.agentToolCalls)
            .set({
              status: "completed",
              completedAt: now,
              resultHash,
              result: redacted,
              error: null,
            })
            .where(
              and(
                eq(
                  schema.agentToolCalls.organisationId,
                  scope.organisationId,
                ),
                eq(schema.agentToolCalls.id, input.toolCallRecordId),
              ),
            )
            .returning({
              id: schema.agentToolCalls.id,
              toolName: schema.agentToolCalls.toolName,
            });
          if (!updated) return;
          await appendAuditEvent(tx, {
            organisationId: scope.organisationId,
            actorId: scope.agentId,
            actorType: "agent",
            action: "agent.tool_call.completed",
            targetType: "agent_tool_call",
            targetId: updated.id,
            metadata: { toolName: updated.toolName, resultHash },
            traceId: `agent-run-${scope.runId}`,
          });
        } else {
          const message = redactObservationText(input.outcome.error, {
            maxStringLength: 2_000,
          });
          const [updated] = await tx
            .update(schema.agentToolCalls)
            .set({
              status: "failed",
              completedAt: now,
              error: message,
            })
            .where(
              and(
                eq(
                  schema.agentToolCalls.organisationId,
                  scope.organisationId,
                ),
                eq(schema.agentToolCalls.id, input.toolCallRecordId),
              ),
            )
            .returning({
              id: schema.agentToolCalls.id,
              toolName: schema.agentToolCalls.toolName,
            });
          if (!updated) return;
          await appendAuditEvent(tx, {
            organisationId: scope.organisationId,
            actorId: scope.agentId,
            actorType: "agent",
            action: "agent.tool_call.failed",
            targetType: "agent_tool_call",
            targetId: updated.id,
            metadata: { toolName: updated.toolName },
            traceId: `agent-run-${scope.runId}`,
          });
        }
      });
    },
  };
}

export function createPostgresRunRecordPort(
  options: { db?: Db } = {},
): RunRecordPort {
  const db = options.db ?? database();
  return {
    async describe(organisationId, runId) {
      const [row] = await db
        .select({
          id: schema.agentRuns.id,
          organisationId: schema.agentRuns.organisationId,
          agentId: schema.agentRuns.agentId,
          conversationId: schema.agentRuns.conversationId,
          roomId: schema.agentRuns.roomId,
          threadId: schema.agentRuns.checkpointThreadId,
          graphVersion: schema.agentRuns.graphVersion,
          pendingApprovalId: schema.agentRuns.pendingApprovalId,
          status: schema.agentRuns.status,
          outputSchema: schema.agentRuns.outputSchema,
        })
        .from(schema.agentRuns)
        .where(
          and(
            eq(schema.agentRuns.organisationId, organisationId),
            eq(schema.agentRuns.id, runId),
          ),
        )
        .limit(1);
      if (!row) return null;
      return {
        runId: row.id,
        organisationId: row.organisationId,
        agentId: row.agentId,
        // Runs created before the stateful runtime have no conversation of
        // their own; the room, then the run itself, is the durable thread.
        conversationId: row.conversationId ?? row.roomId ?? row.id,
        threadId: row.threadId,
        graphVersion: row.graphVersion,
        pendingApprovalId: row.pendingApprovalId,
        status: row.status,
        outputSchema: row.outputSchema,
      };
    },
    async emit(scope, event: AgentRuntimeEventPayload) {
      return db.transaction(async (tx) => {
        const { sequence, occurredAt } = await insertRunEvent(
          tx,
          scope,
          event as unknown as Record<string, unknown>,
        );
        await writeOutbox(tx, {
          organisationId: scope.organisationId,
          eventType: "agent.run.progress",
          aggregateType: "agent_run",
          aggregateId: scope.runId,
          queueName: "muster-notifications",
          payload: { runId: scope.runId, sequence, type: event.type },
          idempotencyKey: `agent.run.progress:${scope.runId}:${sequence}`,
          traceId: `agent-run-${scope.runId}`,
        });
        return { sequence, occurredAt };
      });
    },
    async bindRun(scope, input) {
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ graphVersion: schema.agentRuns.graphVersion })
          .from(schema.agentRuns)
          .where(
            and(
              eq(schema.agentRuns.id, scope.runId),
              eq(schema.agentRuns.organisationId, scope.organisationId),
            ),
          )
          .limit(1);
        if (!row) {
          throw new AgentRuntimeError(
            "Run not found while binding graph version",
            "stale_run",
          );
        }
        if (row.graphVersion !== null && row.graphVersion !== input.graphVersion) {
          throw new AgentRuntimeError(
            `Run was started on graph version ${row.graphVersion} and cannot resume on ${input.graphVersion}`,
            "graph_version_mismatch",
            {
              recordedGraphVersion: row.graphVersion,
              requestedGraphVersion: input.graphVersion,
            },
          );
        }
        await tx
          .update(schema.agentRuns)
          .set({
            graphVersion: input.graphVersion,
            checkpointThreadId: input.threadId,
            conversationId: scope.conversationId,
          })
          .where(
            and(
              eq(schema.agentRuns.id, scope.runId),
              eq(schema.agentRuns.organisationId, scope.organisationId),
            ),
          );
      });
    },
    async markAwaitingApproval(scope, approvalId) {
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.agentRuns)
          .set({ status: "awaiting_approval", pendingApprovalId: approvalId })
          .where(
            and(
              eq(schema.agentRuns.id, scope.runId),
              eq(schema.agentRuns.organisationId, scope.organisationId),
            ),
          )
          .returning({
            id: schema.agentRuns.id,
            agentId: schema.agentRuns.agentId,
          });
        if (!updated) {
          throw new AgentRuntimeError(
            "Run not found while recording an approval hold",
            "stale_run",
          );
        }
        await appendAuditEvent(tx, {
          organisationId: scope.organisationId,
          actorId: updated.agentId,
          actorType: "agent",
          action: "agent.run.awaiting_approval",
          targetType: "agent_run",
          targetId: updated.id,
          metadata: { approvalId },
          traceId: `agent-run-${scope.runId}`,
        });
      });
    },
    async persistResult(scope, terminal: RunTerminalState) {
      const now = new Date();
      await db.transaction(async (tx) => {
        const where = and(
          eq(schema.agentRuns.id, scope.runId),
          eq(schema.agentRuns.organisationId, scope.organisationId),
        );
        const updated =
          terminal.status === "completed"
            ? (
                await tx
                  .update(schema.agentRuns)
                  .set({
                    status: "completed",
                    completedAt: now,
                    leaseExpiresAt: null,
                    structuredOutput: terminal.output,
                    outputHash: terminal.outputHash,
                    outputSchema: terminal.outputSchema,
                    tokenUsage: terminal.usage,
                    estimatedCostCents: terminal.estimatedCostCents,
                    failureCode: null,
                    error: null,
                    cancellationReason: null,
                  })
                  .where(where)
                  .returning({
                    id: schema.agentRuns.id,
                    agentId: schema.agentRuns.agentId,
                  })
              )[0]
            : terminal.status === "failed"
              ? (
                  await tx
                    .update(schema.agentRuns)
                    .set({
                      status: "failed",
                      completedAt: now,
                      leaseExpiresAt: null,
                      failureCode: terminal.failureCode,
                      error: terminal.error.slice(0, 2_000),
                      cancellationReason: null,
                    })
                    .where(where)
                    .returning({
                      id: schema.agentRuns.id,
                      agentId: schema.agentRuns.agentId,
                    })
                )[0]
              : (
                  await tx
                    .update(schema.agentRuns)
                    .set({
                      status: "cancelled",
                      completedAt: now,
                      leaseExpiresAt: null,
                      cancellationReason: terminal.reason,
                      failureCode: null,
                      error: null,
                    })
                    .where(where)
                    .returning({
                      id: schema.agentRuns.id,
                      agentId: schema.agentRuns.agentId,
                    })
                )[0];
        if (!updated) {
          throw new AgentRuntimeError(
            "Run not found while persisting its terminal state",
            "stale_run",
          );
        }
        const eventType: AgentRuntimeEventType =
          terminal.status === "completed"
            ? "run.completed"
            : terminal.status === "failed"
              ? "run.failed"
              : "run.cancelled";
        await insertRunEvent(tx, scope, { type: eventType });
        await writeOutbox(tx, {
          organisationId: scope.organisationId,
          eventType: "agent.run.settled",
          aggregateType: "agent_run",
          aggregateId: scope.runId,
          queueName: "muster-notifications",
          payload: { runId: scope.runId, status: terminal.status },
          idempotencyKey: `agent.run.settled:${scope.runId}`,
          traceId: `agent-run-${scope.runId}`,
        });
        await appendAuditEvent(tx, {
          organisationId: scope.organisationId,
          actorId: updated.agentId,
          actorType: "agent",
          action: `agent.run.${terminal.status}`,
          targetType: "agent_run",
          targetId: updated.id,
          metadata: redactForObservation(
            terminalMetadata(terminal),
          ) as Record<string, unknown>,
          traceId: `agent-run-${scope.runId}`,
        });
      });
    },
    async list(scope, afterSequence) {
      const rows = await db
        .select({ payload: schema.agentRunEvents.payload })
        .from(schema.agentRunEvents)
        .where(
          and(
            eq(schema.agentRunEvents.organisationId, scope.organisationId),
            eq(schema.agentRunEvents.runId, scope.runId),
          ),
        )
        .orderBy(asc(schema.agentRunEvents.createdAt));
      return rows
        .map((row) => sanitiseRuntimeEvent(row.payload))
        .filter((event) => event.sequence > afterSequence);
    },
  };
}

export function createPostgresRuntimePorts(
  options: { db?: Db; executors?: ReadonlyMap<string, ToolExecutor> } = {},
): AgentRuntimePorts {
  const db = options.db ?? database();
  return {
    guards: createPostgresGuardPort({ db }),
    agents: createPostgresAgentDirectoryPort({ db }),
    memories: createPostgresMemoryPort({ db }),
    approvals: createPostgresApprovalPort({ db }),
    toolPolicy: createPostgresToolPolicyPort({ db }),
    toolExecution: createPostgresToolExecutionPort({
      db,
      ...(options.executors ? { executors: options.executors } : {}),
    }),
    runRecords: createPostgresRunRecordPort({ db }),
  };
}
