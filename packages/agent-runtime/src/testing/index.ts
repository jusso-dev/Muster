import { MemorySaver } from "@langchain/langgraph-checkpoint";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { AgentRuntimeEventPayload } from "../events.ts";
import { threadIdFor, type RuntimeScope } from "../identity.ts";
import { defaultModelPolicy } from "../model/types.ts";
import type {
  AgentRuntimePorts,
  ApprovalState,
  MemoryRecord,
  ProposedMemory,
  RunDescriptor,
  RunTerminalState,
  RuntimeAgentRecord,
  RunnableVerdict,
  ToolAuthorisationDecision,
  ToolOutcome,
  ToolReservation,
} from "../ports.ts";

/**
 * In-memory ports for offline tests. They implement the same contracts as the
 * PostgreSQL adapters, including organisation scoping and single-reservation
 * tool execution, so a test that passes here is exercising the same gates.
 */

export type RecordedToolCall = {
  toolCallId: string;
  toolName: string;
  arguments: unknown;
};

export type FakeApproval = {
  approvalId: string;
  state: ApprovalState;
  idempotencyKey: string;
};

export type FakePortsOptions = {
  agent: RuntimeAgentRecord;
  descriptor: RunDescriptor;
  /** Authorisation decisions keyed by tool name. Unknown names are denied. */
  decisions?: ReadonlyMap<string, ToolAuthorisationDecision>;
  /** Executors keyed by tool name. */
  executors?: ReadonlyMap<string, (input: RecordedToolCall) => Promise<unknown>>;
  memories?: readonly MemoryRecord[];
  verdict?: () => RunnableVerdict;
};

export type FakePorts = AgentRuntimePorts & {
  events: AgentRuntimeEventPayload[];
  approvals_: FakeApproval[];
  reservations: Map<
    string,
    { status: "running" | "completed" | "failed"; result?: unknown; error?: string }
  >;
  executions: RecordedToolCall[];
  terminal: RunTerminalState | null;
  proposedMemories: ProposedMemory[];
  boundGraphVersion: string | null;
  boundThreadId: string | null;
};

export function createFakePorts(options: FakePortsOptions): FakePorts {
  const events: AgentRuntimeEventPayload[] = [];
  const approvalRecords: FakeApproval[] = [];
  const reservations = new Map<
    string,
    { status: "running" | "completed" | "failed"; result?: unknown; error?: string }
  >();
  const executions: RecordedToolCall[] = [];
  const proposedMemories: ProposedMemory[] = [];
  const state = {
    terminal: null as RunTerminalState | null,
    boundGraphVersion: null as string | null,
    boundThreadId: null as string | null,
    pendingApprovalId: null as string | null,
  };
  const decisions = options.decisions ?? new Map();
  const executors = options.executors ?? new Map();

  function assertScope(scope: Pick<RuntimeScope, "organisationId">): void {
    if (scope.organisationId !== options.descriptor.organisationId) {
      throw new Error("Cross-organisation access rejected");
    }
  }

  const ports: FakePorts = {
    events,
    approvals_: approvalRecords,
    reservations,
    executions,
    proposedMemories,
    get terminal() {
      return state.terminal;
    },
    get boundGraphVersion() {
      return state.boundGraphVersion;
    },
    get boundThreadId() {
      return state.boundThreadId;
    },
    guards: {
      async assertRunnable(scope) {
        assertScope(scope);
        return options.verdict ? options.verdict() : { runnable: true };
      },
    },
    agents: {
      async load(scope) {
        assertScope(scope);
        return options.agent;
      },
    },
    memories: {
      async retrieve(scope, limit) {
        assertScope(scope);
        return (options.memories ?? []).slice(0, limit);
      },
      async propose(scope, memories) {
        assertScope(scope);
        proposedMemories.push(...memories);
        return memories.length;
      },
    },
    approvals: {
      async require(scope, request) {
        assertScope(scope);
        const existing = approvalRecords.find(
          (record) => record.idempotencyKey === request.idempotencyKey,
        );
        if (existing) return { approvalId: existing.approvalId, state: existing.state };
        const record: FakeApproval = {
          approvalId: `approval-${approvalRecords.length + 1}`,
          state: "pending",
          idempotencyKey: request.idempotencyKey,
        };
        approvalRecords.push(record);
        return { approvalId: record.approvalId, state: record.state };
      },
      async read(scope, approvalId) {
        assertScope(scope);
        const record = approvalRecords.find(
          (candidate) => candidate.approvalId === approvalId,
        );
        return record ? { approvalId: record.approvalId, state: record.state } : null;
      },
    },
    toolPolicy: {
      async authorise(scope, _subject, _agent, toolName) {
        assertScope(scope);
        const decision = decisions.get(toolName);
        if (!decision) {
          return {
            outcome: "denied",
            reason: `Tool ${toolName} is not registered`,
            code: "tool_not_registered",
          };
        }
        return decision;
      },
    },
    toolExecution: {
      async reserve(scope, input): Promise<ToolReservation> {
        assertScope(scope);
        const key = `${scope.runId}:${input.toolCallId}`;
        const existing = reservations.get(key);
        if (!existing) {
          reservations.set(key, { status: "running" });
          return { status: "reserved", toolCallRecordId: key, replayed: false };
        }
        if (existing.status === "completed") {
          return {
            status: "already_completed",
            result: existing.result,
            resultHash: "",
          };
        }
        if (existing.status === "failed") {
          return { status: "already_failed", error: existing.error ?? "failed" };
        }
        return { status: "reserved", toolCallRecordId: key, replayed: true };
      },
      async execute(scope, _subject, input): Promise<ToolOutcome> {
        assertScope(scope);
        const executor = executors.get(input.toolName);
        if (!executor) {
          return { status: "failed", error: "Tool has no registered executor" };
        }
        const call: RecordedToolCall = {
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          arguments: input.arguments,
        };
        executions.push(call);
        try {
          return { status: "completed", result: await executor(call) };
        } catch (error) {
          return {
            status: "failed",
            error: error instanceof Error ? error.message : "failed",
          };
        }
      },
      async settle(scope, input) {
        assertScope(scope);
        const existing = reservations.get(input.toolCallRecordId);
        if (!existing) return;
        reservations.set(
          input.toolCallRecordId,
          input.outcome.status === "completed"
            ? { status: "completed", result: input.outcome.result }
            : { status: "failed", error: input.outcome.error },
        );
      },
    },
    runRecords: {
      async describe(organisationId, runId) {
        if (
          organisationId !== options.descriptor.organisationId ||
          runId !== options.descriptor.runId
        ) {
          return null;
        }
        return {
          ...options.descriptor,
          pendingApprovalId: state.pendingApprovalId,
          ...(state.boundGraphVersion
            ? { graphVersion: state.boundGraphVersion }
            : {}),
        };
      },
      async emit(scope, event) {
        assertScope(scope);
        events.push(event);
        return {
          sequence: events.length,
          occurredAt: new Date(events.length).toISOString(),
        };
      },
      async bindRun(scope, input) {
        assertScope(scope);
        if (
          state.boundGraphVersion &&
          state.boundGraphVersion !== input.graphVersion
        ) {
          throw new Error("Graph version mismatch");
        }
        state.boundGraphVersion = input.graphVersion;
        state.boundThreadId = input.threadId;
      },
      async markAwaitingApproval(scope, approvalId) {
        assertScope(scope);
        state.pendingApprovalId = approvalId;
      },
      async persistResult(scope, terminal) {
        assertScope(scope);
        state.terminal = terminal;
      },
      async list(scope, afterSequence) {
        assertScope(scope);
        return events
          .map((event, index) => ({
            ...event,
            sequence: index + 1,
            occurredAt: new Date(index + 1).toISOString(),
          }))
          .filter((event) => event.sequence > afterSequence);
      },
    },
  };
  return ports;
}

export function fakeAgentRecord(
  overrides: Partial<RuntimeAgentRecord> = {},
): RuntimeAgentRecord {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    organisationId: "00000000-0000-4000-8000-000000000001",
    name: "Synthetic Agent",
    status: "active",
    killSwitch: false,
    allowedTools: [],
    systemPromptVersion: "v1",
    modelPolicy: defaultModelPolicy,
    maximumTokenBudget: 20_000,
    maximumCostCents: 500,
    maximumSteps: 6,
    ...overrides,
  };
}

export function fakeScope(overrides: Partial<RuntimeScope> = {}): RuntimeScope {
  return {
    organisationId: "00000000-0000-4000-8000-000000000001",
    agentId: "00000000-0000-4000-8000-00000000a001",
    conversationId: "conversation-1",
    runId: "00000000-0000-4000-8000-00000000b001",
    ...overrides,
  };
}

export function fakeDescriptor(
  scope: RuntimeScope,
  overrides: Partial<RunDescriptor> = {},
): RunDescriptor {
  return {
    runId: scope.runId,
    organisationId: scope.organisationId,
    agentId: scope.agentId,
    conversationId: scope.conversationId,
    threadId: threadIdFor(scope),
    graphVersion: null,
    pendingApprovalId: null,
    status: "queued",
    // A real `AgentStructuredOutputSchemas` key, so the default fixture drives
    // the same validation path a production run does.
    outputSchema: "ExecutiveUpdate",
    ...overrides,
  };
}

/** Shared in-memory checkpointer factory for graph tests. */
export function memoryCheckpointerFactory(): (
  scope: RuntimeScope,
) => BaseCheckpointSaver {
  const savers = new Map<string, BaseCheckpointSaver>();
  return (scope) => {
    const key = threadIdFor(scope);
    const existing = savers.get(key);
    if (existing) return existing;
    const saver = new MemorySaver();
    savers.set(key, saver);
    return saver;
  };
}
