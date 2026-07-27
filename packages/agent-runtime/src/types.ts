import type { AuthorisationSubject } from "@muster/authz";
import type { AgentRuntimeEvent } from "./events.ts";
import type { RuntimeScope } from "./identity.ts";

/**
 * The internal runtime API. `@muster/agent-harness` remains the only public
 * invocation boundary; this interface is what the gateway calls once a run row
 * already exists and has passed every harness gate.
 */

export type StartAgentRunInput = {
  scope: RuntimeScope;
  subject: AuthorisationSubject;
  /** Human request text. Treated as a request, never as a system instruction. */
  humanRequest: string;
  /** Structured output contract the final response must satisfy. */
  outputSchema: string;
  signal?: AbortSignal;
};

export type ResumeAgentRunInput = {
  scope: RuntimeScope;
  subject: AuthorisationSubject;
  /**
   * Present when the run is resuming from an approval interrupt. Omitted when
   * resuming after a worker restart, where the checkpoint alone is sufficient.
   */
  approval?: { approvalId: string; decision: "approved" | "rejected" };
  signal?: AbortSignal;
};

export type CancelAgentRunInput = {
  scope: RuntimeScope;
  reason: string;
};

export type AgentRunHandleStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval";

export type AgentRunHandle = {
  runId: string;
  organisationId: string;
  status: AgentRunHandleStatus;
  graphVersion: string;
  threadId: string;
  /** Set when the graph stopped on an approval interrupt. */
  pendingApprovalId?: string;
  output?: unknown;
  outputHash?: string;
  failureCode?: string;
  error?: string;
  usage: { inputTokens: number; outputTokens: number };
  estimatedCostCents: number;
  stepCount: number;
};

export type AgentRuntimeSnapshot = {
  runId: string;
  organisationId: string;
  agentId: string;
  conversationId: string;
  threadId: string;
  graphVersion: string | null;
  /** Node the graph will execute next, or null when the run is terminal. */
  nextNodes: readonly string[];
  checkpointId: string | null;
  checkpointCount: number;
  pendingApprovalId: string | null;
  stepCount: number;
  events: readonly AgentRuntimeEvent[];
};

export interface AgentRuntime {
  startRun(input: StartAgentRunInput): Promise<AgentRunHandle>;
  resumeRun(input: ResumeAgentRunInput): Promise<AgentRunHandle>;
  cancelRun(input: CancelAgentRunInput): Promise<void>;
  streamRun(runId: string): AsyncIterable<AgentRuntimeEvent>;
  inspectRun(runId: string): Promise<AgentRuntimeSnapshot>;
}
