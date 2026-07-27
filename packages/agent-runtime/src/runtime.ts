import { Command, isGraphInterrupt } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { database } from "@muster/database";
import {
  countCheckpoints,
  MusterPostgresCheckpointSaver,
} from "./checkpointer/index.ts";
import { AgentRuntimeError } from "./errors.ts";
import {
  isTerminalRuntimeEvent,
  sanitiseRuntimeEvent,
  type AgentRuntimeEvent,
} from "./events.ts";
import { runtimeScope, threadIdFor, type RuntimeScope } from "./identity.ts";
import { buildAgentGraph } from "./graph/build.ts";
import type { GraphDependencies } from "./graph/nodes.ts";
import type { RuntimeState } from "./graph/state.ts";
import type { ModelRouter } from "./model/types.ts";
import type { AgentRuntimePorts, RunDescriptor } from "./ports.ts";
import type {
  AgentRunHandle,
  AgentRuntime,
  AgentRuntimeSnapshot,
  CancelAgentRunInput,
  ResumeAgentRunInput,
  StartAgentRunInput,
} from "./types.ts";
import { AGENT_RUNTIME_GRAPH_VERSION, checkGraphVersion } from "./version.ts";

type Db = ReturnType<typeof database>;

export type MusterAgentRuntimeOptions = {
  /**
   * The runtime is constructed for exactly one organisation. Every checkpoint,
   * event and run lookup it performs is scoped to it, so there is no code path
   * that can address another tenant's execution state.
   */
  organisationId: string;
  db: Db;
  ports: AgentRuntimePorts;
  router: ModelRouter;
  /** Overrides the Postgres checkpoint saver; used by offline tests. */
  createCheckpointer?: (scope: RuntimeScope) => BaseCheckpointSaver;
  maximumToolResultCharacters?: number;
  memoryProposer?: GraphDependencies["memoryProposer"];
  /** Poll interval for `streamRun`, which follows durable run events. */
  streamPollMs?: number;
  streamTimeoutMs?: number;
};

export class MusterAgentRuntime implements AgentRuntime {
  private readonly organisationId: string;

  constructor(private readonly options: MusterAgentRuntimeOptions) {
    this.organisationId = options.organisationId;
  }

  async startRun(input: StartAgentRunInput): Promise<AgentRunHandle> {
    const scope = this.scopeFor(input.scope);
    await this.options.ports.runRecords.bindRun(scope, {
      graphVersion: AGENT_RUNTIME_GRAPH_VERSION,
      threadId: threadIdFor(scope),
    });
    await this.options.ports.runRecords.emit(scope, { type: "run.queued" });
    return this.drive(scope, input.subject, {
      humanRequest: input.humanRequest,
      outputSchema: input.outputSchema,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  async resumeRun(input: ResumeAgentRunInput): Promise<AgentRunHandle> {
    const scope = this.scopeFor(input.scope);
    const descriptor = await this.describe(scope.runId);
    const compatibility = checkGraphVersion(descriptor.graphVersion);
    if (!compatibility.compatible) {
      // Fail explicitly rather than replay a run against a graph it never
      // executed. The operator gets a named migration requirement.
      await this.fail(
        scope,
        new AgentRuntimeError(compatibility.reason, "graph_version_mismatch"),
      );
      return this.handleFor(scope, {
        status: "failed",
        failureCode: "graph_version_mismatch",
        error: compatibility.reason,
      });
    }
    return this.drive(scope, input.subject, {
      ...(input.approval ? { approval: input.approval } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(descriptor.outputSchema
        ? { outputSchema: descriptor.outputSchema }
        : {}),
    });
  }

  async cancelRun(input: CancelAgentRunInput): Promise<void> {
    const scope = this.scopeFor(input.scope);
    await this.options.ports.runRecords.persistResult(scope, {
      status: "cancelled",
      reason: input.reason,
    });
    await this.options.ports.runRecords.emit(scope, { type: "run.cancelled" });
  }

  /**
   * Progress follows the durable run-event log rather than an in-process
   * emitter, so a caller can stream a run that another worker is executing and
   * can rejoin after a restart.
   */
  async *streamRun(runId: string): AsyncIterable<AgentRuntimeEvent> {
    const descriptor = await this.describe(runId);
    const scope: RuntimeScope = runtimeScope({
      organisationId: this.organisationId,
      agentId: descriptor.agentId,
      conversationId: descriptor.conversationId,
      runId: descriptor.runId,
    });
    const pollMs = this.options.streamPollMs ?? 250;
    const timeoutMs = this.options.streamTimeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;
    let cursor = 0;
    for (;;) {
      const events = await this.options.ports.runRecords.list(
        { organisationId: scope.organisationId, runId: scope.runId },
        cursor,
      );
      for (const event of events) {
        cursor = Math.max(cursor, event.sequence);
        const sanitised = sanitiseRuntimeEvent({
          ...event,
          runId: scope.runId,
          organisationId: scope.organisationId,
        });
        yield sanitised;
        if (isTerminalRuntimeEvent(sanitised)) return;
      }
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  async inspectRun(runId: string): Promise<AgentRuntimeSnapshot> {
    const descriptor = await this.describe(runId);
    const scope: RuntimeScope = runtimeScope({
      organisationId: this.organisationId,
      agentId: descriptor.agentId,
      conversationId: descriptor.conversationId,
      runId: descriptor.runId,
    });
    const checkpointer = this.checkpointer(scope);
    const graph = this.graph(scope, checkpointer, {
      actorId: descriptor.agentId,
      organisationId: scope.organisationId,
      capabilities: new Set(),
    });
    const snapshot = await graph.getState(this.config(scope));
    const values = snapshot.values as Partial<RuntimeState> | undefined;
    const events = await this.options.ports.runRecords.list(
      { organisationId: scope.organisationId, runId: scope.runId },
      0,
    );
    return {
      runId: scope.runId,
      organisationId: scope.organisationId,
      agentId: scope.agentId,
      conversationId: scope.conversationId,
      threadId: threadIdFor(scope),
      graphVersion: descriptor.graphVersion,
      nextNodes: [...snapshot.next],
      checkpointId:
        (snapshot.config.configurable?.["checkpoint_id"] as string | undefined) ??
        null,
      checkpointCount: await countCheckpoints(
        this.options.db,
        scope.organisationId,
        scope.runId,
      ),
      pendingApprovalId: descriptor.pendingApprovalId,
      stepCount: values?.stepCount ?? 0,
      events: events.map((event) =>
        sanitiseRuntimeEvent({
          ...event,
          runId: scope.runId,
          organisationId: scope.organisationId,
        }),
      ),
    };
  }

  private scopeFor(scope: RuntimeScope): RuntimeScope {
    const parsed = runtimeScope(scope);
    if (parsed.organisationId !== this.organisationId) {
      throw new AgentRuntimeError(
        "Runtime scope belongs to a different organisation",
        "checkpoint_scope_violation",
      );
    }
    return parsed;
  }

  private async describe(runId: string): Promise<RunDescriptor> {
    const descriptor = await this.options.ports.runRecords.describe(
      this.organisationId,
      runId,
    );
    if (!descriptor) {
      throw new AgentRuntimeError(
        "Agent run is not available in this organisation",
        "stale_run",
      );
    }
    return descriptor;
  }

  private checkpointer(scope: RuntimeScope): BaseCheckpointSaver {
    if (this.options.createCheckpointer) {
      return this.options.createCheckpointer(scope);
    }
    return new MusterPostgresCheckpointSaver({
      db: this.options.db,
      graphVersion: AGENT_RUNTIME_GRAPH_VERSION,
      ...scope,
    });
  }

  private config(scope: RuntimeScope) {
    return {
      configurable: { thread_id: threadIdFor(scope), checkpoint_ns: "" },
    };
  }

  private graph(
    scope: RuntimeScope,
    checkpointer: BaseCheckpointSaver,
    subject: StartAgentRunInput["subject"],
    signal?: AbortSignal,
  ) {
    const dependencies: GraphDependencies = {
      scope,
      subject,
      ports: this.options.ports,
      router: this.options.router,
      ...(this.options.maximumToolResultCharacters
        ? {
            maximumToolResultCharacters:
              this.options.maximumToolResultCharacters,
          }
        : {}),
      ...(this.options.memoryProposer
        ? { memoryProposer: this.options.memoryProposer }
        : {}),
      ...(signal ? { signal } : {}),
    };
    return buildAgentGraph(dependencies, checkpointer);
  }

  private async drive(
    scope: RuntimeScope,
    subject: StartAgentRunInput["subject"],
    options: {
      humanRequest?: string;
      outputSchema?: string;
      approval?: { approvalId: string; decision: "approved" | "rejected" };
      signal?: AbortSignal;
    },
  ): Promise<AgentRunHandle> {
    const checkpointer = this.checkpointer(scope);
    const graph = this.graph(scope, checkpointer, subject, options.signal);
    const config = this.config(scope);
    type GraphInput = Parameters<typeof graph.invoke>[0];
    // A resume carries the approval decision; a fresh run carries the request;
    // a restart carries nothing and continues from the stored checkpoint.
    const input: GraphInput =
      options.approval !== undefined
        ? (new Command({ resume: options.approval }) as GraphInput)
        : options.humanRequest !== undefined
          ? {
              humanRequest: options.humanRequest,
              outputSchema: options.outputSchema ?? "",
            }
          : null;
    try {
      const result = (await graph.invoke(input, config)) as RuntimeState;
      if (!result.settled) {
        // The graph stopped without settling: the only non-error way that
        // happens is an interrupt awaiting a human decision.
        const snapshot = await graph.getState(config);
        if (snapshot.next.length > 0) {
          return this.handleFor(scope, {
            status: "awaiting_approval",
            ...(result.pendingApprovalId
              ? { pendingApprovalId: result.pendingApprovalId }
              : {}),
            usage: result.usage,
            estimatedCostCents: result.estimatedCostCents,
            stepCount: result.stepCount,
          });
        }
      }
      return this.handleFor(scope, {
        status: "completed",
        usage: result.usage,
        estimatedCostCents: result.estimatedCostCents,
        stepCount: result.stepCount,
      });
    } catch (error) {
      if (isGraphInterrupt(error)) {
        const snapshot = await graph.getState(config);
        const values = snapshot.values as Partial<RuntimeState> | undefined;
        const descriptor = await this.describe(scope.runId);
        return this.handleFor(scope, {
          status: "awaiting_approval",
          ...(descriptor.pendingApprovalId
            ? { pendingApprovalId: descriptor.pendingApprovalId }
            : {}),
          usage: values?.usage ?? { inputTokens: 0, outputTokens: 0 },
          estimatedCostCents: values?.estimatedCostCents ?? 0,
          stepCount: values?.stepCount ?? 0,
        });
      }
      const runtimeError = toRuntimeError(error);
      if (runtimeError.code === "cancelled") {
        await this.cancelRun({ scope, reason: runtimeError.message });
        return this.handleFor(scope, {
          status: "cancelled",
          failureCode: "cancelled",
          error: runtimeError.message,
        });
      }
      await this.fail(scope, runtimeError);
      return this.handleFor(scope, {
        status: "failed",
        failureCode: runtimeError.code,
        error: runtimeError.message,
      });
    }
  }

  private async fail(
    scope: RuntimeScope,
    error: AgentRuntimeError,
  ): Promise<void> {
    await this.options.ports.runRecords.persistResult(scope, {
      status: "failed",
      failureCode: error.code,
      error: error.message,
    });
    await this.options.ports.runRecords.emit(scope, { type: "run.failed" });
  }

  private handleFor(
    scope: RuntimeScope,
    input: {
      status: AgentRunHandle["status"];
      pendingApprovalId?: string;
      failureCode?: string;
      error?: string;
      usage?: { inputTokens: number; outputTokens: number };
      estimatedCostCents?: number;
      stepCount?: number;
    },
  ): AgentRunHandle {
    return {
      runId: scope.runId,
      organisationId: scope.organisationId,
      status: input.status,
      graphVersion: AGENT_RUNTIME_GRAPH_VERSION,
      threadId: threadIdFor(scope),
      ...(input.pendingApprovalId
        ? { pendingApprovalId: input.pendingApprovalId }
        : {}),
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(input.error ? { error: input.error } : {}),
      usage: input.usage ?? { inputTokens: 0, outputTokens: 0 },
      estimatedCostCents: input.estimatedCostCents ?? 0,
      stepCount: input.stepCount ?? 0,
    };
  }
}

function toRuntimeError(error: unknown): AgentRuntimeError {
  if (error instanceof AgentRuntimeError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new AgentRuntimeError("Agent run was cancelled", "cancelled");
  }
  return new AgentRuntimeError(
    error instanceof Error ? error.message : "Unknown agent runtime error",
    "runtime_error",
  );
}

export function createAgentRuntime(
  options: MusterAgentRuntimeOptions,
): AgentRuntime {
  return new MusterAgentRuntime(options);
}
