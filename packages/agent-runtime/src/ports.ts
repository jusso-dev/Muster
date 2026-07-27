import type { AuthorisationSubject } from "@muster/authz";
import type { AgentRuntimeEventPayload } from "./events.ts";
import type { RuntimeScope } from "./identity.ts";
import type { ModelPolicy } from "./model/types.ts";

/**
 * Ports are the only way the graph reaches authoritative state. PostgreSQL
 * stays the source of truth for identity, enablement, capabilities, approvals,
 * tool permissions and the final run status; the graph owns nothing but its
 * checkpoint. Tests substitute in-memory ports without weakening any gate.
 */

export type RuntimeAgentRecord = {
  id: string;
  organisationId: string;
  name: string;
  status: string;
  killSwitch: boolean;
  allowedTools: readonly string[];
  systemPromptVersion: string;
  modelPolicy: ModelPolicy;
  maximumTokenBudget: number;
  maximumCostCents: number;
  /** Maximum model/tool turns before the graph stops. */
  maximumSteps: number;
};

export type RunnableVerdict =
  | { runnable: true }
  | {
      runnable: false;
      code: "agent_kill_switch" | "agent_inactive" | "cancelled" | "stale_run";
      reason: string;
    };

export interface RuntimeGuardPort {
  /**
   * Re-evaluated at every graph step boundary. The kill switch must stop new
   * model and tool steps immediately, not merely at claim time.
   */
  assertRunnable(scope: RuntimeScope): Promise<RunnableVerdict>;
}

export interface AgentDirectoryPort {
  load(scope: RuntimeScope): Promise<RuntimeAgentRecord | null>;
}

export type MemoryRecord = {
  id: string;
  kind: string;
  title: string;
  content: string;
  confidence: number;
  classification: string;
};

export type ProposedMemory = {
  kind: string;
  title: string;
  content: string;
  confidence: number;
};

export interface MemoryPort {
  /** Organisation- and agent-scoped retrieval. Never crosses a tenant. */
  retrieve(scope: RuntimeScope, limit: number): Promise<readonly MemoryRecord[]>;
  /** Proposals only; nothing a run proposes becomes a trusted instruction. */
  propose(
    scope: RuntimeScope,
    memories: readonly ProposedMemory[],
  ): Promise<number>;
}

export type ApprovalState = "pending" | "approved" | "rejected" | "expired";

export type ApprovalRequest = {
  toolName: string;
  approvalAction: string;
  argumentsHash: string;
  riskSummary: string;
  /** Stable across resumes so an interrupt never creates a second approval. */
  idempotencyKey: string;
};

export interface ApprovalPort {
  /**
   * Create or return the authoritative approval record for a tool call. The
   * runtime never approves itself and never alters approval requirements.
   */
  require(
    scope: RuntimeScope,
    request: ApprovalRequest,
  ): Promise<{ approvalId: string; state: ApprovalState }>;
  read(
    scope: RuntimeScope,
    approvalId: string,
  ): Promise<{ approvalId: string; state: ApprovalState } | null>;
}

export type ToolAuthorisationDecision =
  | { outcome: "allowed"; capability: string; classification: string }
  | { outcome: "approval_required"; capability: string; approvalAction: string; classification: string }
  | { outcome: "denied"; reason: string; code: string };

export interface ToolPolicyPort {
  /**
   * Server-side authorisation for a tool the model proposed. Implementations
   * must reject unregistered names, names outside the agent allowlist, missing
   * capabilities and prohibited actions before any argument is trusted.
   */
  authorise(
    scope: RuntimeScope,
    subject: AuthorisationSubject,
    agent: RuntimeAgentRecord,
    toolName: string,
    rawArguments: unknown,
  ): Promise<
    ToolAuthorisationDecision & { validatedArguments?: unknown }
  >;
}

export type ToolReservation =
  | {
      status: "reserved";
      toolCallRecordId: string;
      /**
       * True when the reservation already existed and was still running — a
       * previous attempt died mid-flight. The external action may or may not
       * have landed, so the graph refuses to repeat it rather than guess.
       */
      replayed: boolean;
    }
  | { status: "already_completed"; result: unknown; resultHash: string }
  | { status: "already_failed"; error: string };

export type ToolOutcome =
  | { status: "completed"; result: unknown }
  | { status: "failed"; error: string };

export interface ToolExecutionPort {
  /**
   * Reserve the external action before it runs. A resumed run that finds a
   * completed reservation replays the recorded outcome instead of repeating
   * the action.
   */
  reserve(
    scope: RuntimeScope,
    input: {
      toolCallId: string;
      toolName: string;
      capability: string;
      classification: string;
      argumentsHash: string;
      checkpointId: string | null;
      approvalId: string | null;
    },
  ): Promise<ToolReservation>;
  execute(
    scope: RuntimeScope,
    subject: AuthorisationSubject,
    input: {
      toolCallRecordId: string;
      toolCallId: string;
      toolName: string;
      arguments: unknown;
      signal?: AbortSignal;
    },
  ): Promise<ToolOutcome>;
  settle(
    scope: RuntimeScope,
    input: { toolCallRecordId: string; outcome: ToolOutcome },
  ): Promise<void>;
}

export type RunTerminalState =
  | {
      status: "completed";
      output: unknown;
      outputHash: string;
      outputSchema: string;
      usage: { inputTokens: number; outputTokens: number };
      estimatedCostCents: number;
    }
  | { status: "failed"; failureCode: string; error: string }
  | { status: "cancelled"; reason: string };

export type RunDescriptor = {
  runId: string;
  organisationId: string;
  agentId: string;
  conversationId: string;
  threadId: string | null;
  graphVersion: string | null;
  pendingApprovalId: string | null;
  status: string;
  outputSchema: string | null;
};

export interface RunRecordPort {
  /**
   * Resolve a run inside one organisation. Returns null for a run belonging to
   * another tenant so inspection and streaming cannot confirm its existence.
   */
  describe(
    organisationId: string,
    runId: string,
  ): Promise<RunDescriptor | null>;
  /**
   * Append a runtime event. Implementations write the sanitised event and the
   * outbox row in one transaction so Slack and SSE observe the same ordering.
   */
  emit(
    scope: RuntimeScope,
    event: AgentRuntimeEventPayload,
  ): Promise<{ sequence: number; occurredAt: string }>;
  /** Record the graph version and thread identity on the authoritative run. */
  bindRun(
    scope: RuntimeScope,
    input: { graphVersion: string; threadId: string },
  ): Promise<void>;
  markAwaitingApproval(
    scope: RuntimeScope,
    approvalId: string,
  ): Promise<void>;
  persistResult(scope: RuntimeScope, terminal: RunTerminalState): Promise<void>;
  list(
    scope: Pick<RuntimeScope, "organisationId" | "runId">,
    afterSequence: number,
  ): Promise<
    readonly (AgentRuntimeEventPayload & {
      sequence: number;
      occurredAt: string;
    })[]
  >;
}

export type AgentRuntimePorts = {
  guards: RuntimeGuardPort;
  agents: AgentDirectoryPort;
  memories: MemoryPort;
  approvals: ApprovalPort;
  toolPolicy: ToolPolicyPort;
  toolExecution: ToolExecutionPort;
  runRecords: RunRecordPort;
};
