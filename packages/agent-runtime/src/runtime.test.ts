import type { AuthorisationSubject } from "@muster/authz";
import type { database } from "@muster/database";
import { describe, expect, it } from "vitest";
import { AgentRuntimeError } from "./errors.ts";
import { sanitiseRuntimeEvent, type AgentRuntimeEvent } from "./events.ts";
import { threadIdFor, type RuntimeScope } from "./identity.ts";
import { createModelRouter } from "./model/router.ts";
import { createScriptedProvider } from "./model/providers/scripted.ts";
import { MusterAgentRuntime } from "./runtime.ts";
import {
  createFakePorts,
  fakeAgentRecord,
  fakeDescriptor,
  fakeScope,
  memoryCheckpointerFactory,
} from "./testing/index.ts";
import { AGENT_RUNTIME_GRAPH_VERSION } from "./version.ts";

type Db = ReturnType<typeof database>;

/** These tests must never touch the database; only `inspectRun` legitimately does. */
function createUntouchableDb(): Db {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `Unexpected database access via property "${String(property)}" in an offline agent-runtime test.`,
        );
      },
    },
  ) as unknown as Db;
}

type DbCountStub = {
  select: (...args: unknown[]) => DbCountStub;
  from: (...args: unknown[]) => DbCountStub;
  where: (...args: unknown[]) => Promise<Array<{ value: number }>>;
};

/** `inspectRun` calls `countCheckpoints`, which resolves this exact chain. */
function createCountingDbStub(): Db {
  const stub: DbCountStub = {
    select: () => stub,
    from: () => stub,
    where: () => Promise.resolve([{ value: 0 }]),
  };
  return stub as unknown as Db;
}

function fakeSubject(scope: RuntimeScope): AuthorisationSubject {
  return {
    actorId: scope.agentId,
    organisationId: scope.organisationId,
    capabilities: new Set(),
  };
}

const validExecutiveUpdate = {
  headline: "Synthetic executive update",
  status: "monitoring" as const,
  impact: "Synthetic impact statement for a governed run.",
  actions: ["Synthetic follow-up action"],
  nextUpdateAt: null,
};
const validFinalContent = JSON.stringify(validExecutiveUpdate);

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("MusterAgentRuntime.startRun — graph version recorded (criterion f)", () => {
  it("binds the run to AGENT_RUNTIME_GRAPH_VERSION and the canonical thread id", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const ports = createFakePorts({ agent, descriptor });
    const router = createModelRouter({
      providers: [createScriptedProvider([{ content: validFinalContent }])],
    });
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });

    const handle = await runtime.startRun({
      scope,
      subject: fakeSubject(scope),
      humanRequest: "Investigate.",
      outputSchema: "ExecutiveUpdate",
    });

    expect(ports.boundGraphVersion).toBe(AGENT_RUNTIME_GRAPH_VERSION);
    expect(ports.boundThreadId).toBe(threadIdFor(scope));
    expect(handle.graphVersion).toBe(AGENT_RUNTIME_GRAPH_VERSION);
    expect(handle.threadId).toBe(threadIdFor(scope));
    expect(handle.status).toBe("completed");
  });
});

describe("MusterAgentRuntime.resumeRun — version mismatch (criterion f)", () => {
  it("fails with graph_version_mismatch without invoking the model", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, {
      outputSchema: "ExecutiveUpdate",
      graphVersion: "muster.agent-runtime.graph/0",
    });
    const ports = createFakePorts({ agent, descriptor });
    // An empty script: any model call would throw, proving it was never made.
    const router = createModelRouter({ providers: [createScriptedProvider([])] });
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });

    const handle = await runtime.resumeRun({
      scope,
      subject: fakeSubject(scope),
    });

    expect(handle.status).toBe("failed");
    expect(handle.failureCode).toBe("graph_version_mismatch");
  });
});

describe("MusterAgentRuntime — organisation scoping (criterion e)", () => {
  it("throws checkpoint_scope_violation when startRun's scope organisation differs from the runtime's", async () => {
    const runtimeOrganisationId = "00000000-0000-4000-8000-000000000001";
    const foreignScope = fakeScope({
      organisationId: "00000000-0000-4000-8000-000000000099",
    });
    const agent = fakeAgentRecord({ organisationId: runtimeOrganisationId });
    const descriptor = fakeDescriptor(foreignScope, {
      organisationId: runtimeOrganisationId,
      outputSchema: "ExecutiveUpdate",
    });
    const ports = createFakePorts({ agent, descriptor });
    const router = createModelRouter({ providers: [createScriptedProvider([])] });
    const runtime = new MusterAgentRuntime({
      organisationId: runtimeOrganisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });

    const error = await captureError(
      runtime.startRun({
        scope: foreignScope,
        subject: fakeSubject(foreignScope),
        humanRequest: "Investigate.",
        outputSchema: "ExecutiveUpdate",
      }),
    );
    expect(error).toBeInstanceOf(AgentRuntimeError);
    expect((error as AgentRuntimeError).code).toBe("checkpoint_scope_violation");
  });

  it("throws stale_run and reveals nothing when inspectRun targets a run the ports do not own", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const ports = createFakePorts({ agent, descriptor });
    const router = createModelRouter({ providers: [createScriptedProvider([])] });
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });

    const otherRunId = "00000000-0000-4000-8000-00000000cccc";
    const inspectError = await captureError(runtime.inspectRun(otherRunId));
    expect(inspectError).toBeInstanceOf(AgentRuntimeError);
    expect((inspectError as AgentRuntimeError).code).toBe("stale_run");
    expect(JSON.stringify(inspectError)).not.toContain(scope.runId);

    const streamError = await captureError(
      (async () => {
        for await (const _event of runtime.streamRun(otherRunId)) {
          // no-op: draining the iterator to force the initial describe() call
        }
      })(),
    );
    expect(streamError).toBeInstanceOf(AgentRuntimeError);
    expect((streamError as AgentRuntimeError).code).toBe("stale_run");
  });
});

describe("MusterAgentRuntime — approval interrupt and resume (criterion c)", () => {
  function approvalDecisions() {
    return new Map([
      [
        "synthetic.tool",
        {
          outcome: "approval_required" as const,
          capability: "synthetic.write",
          approvalAction: "synthetic.tool.write",
          classification: "restricted",
        },
      ],
    ]);
  }

  it("returns awaiting_approval, never invokes the executor, and emits tool.approval_required", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const executors = new Map([["synthetic.tool", async () => ({ status: "ok" })]]);
    const ports = createFakePorts({
      agent,
      descriptor,
      decisions: approvalDecisions(),
      executors,
    });
    const router = createModelRouter({
      providers: [
        createScriptedProvider([
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-1" },
            ],
          },
          { content: validFinalContent },
        ]),
      ],
    });
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });

    const handle = await runtime.startRun({
      scope,
      subject: fakeSubject(scope),
      humanRequest: "Investigate.",
      outputSchema: "ExecutiveUpdate",
    });

    expect(handle.status).toBe("awaiting_approval");
    expect(handle.pendingApprovalId).toBeTruthy();
    expect(ports.executions).toHaveLength(0);
    expect(ports.events.some((event) => event.type === "tool.approval_required")).toBe(
      true,
    );
  });

  it("cancels a run parked in awaiting_approval (criterion i: cancellation while approval waiting)", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const executors = new Map([["synthetic.tool", async () => ({ status: "ok" })]]);
    // Mirrors the real Postgres guard port: once the terminal state is
    // cancelled, `assertRunnable` must observe that and refuse further steps,
    // exactly as `agent_runs.status = 'cancelled'` does in production.
    let terminalStatus: string | undefined;
    const ports = createFakePorts({
      agent,
      descriptor,
      decisions: approvalDecisions(),
      executors,
      verdict: () =>
        terminalStatus === "cancelled"
          ? { runnable: false, code: "cancelled", reason: "Run was cancelled." }
          : { runnable: true },
    });
    const router = createModelRouter({
      providers: [
        createScriptedProvider([
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-1" },
            ],
          },
          { content: validFinalContent },
        ]),
      ],
    });
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });

    const started = await runtime.startRun({
      scope,
      subject: fakeSubject(scope),
      humanRequest: "Investigate.",
      outputSchema: "ExecutiveUpdate",
    });
    expect(started.status).toBe("awaiting_approval");

    // The run has no in-flight process while it waits on a human decision;
    // cancellation here is a pure, authoritative database transition, not an
    // abort signal reaching a live graph step.
    await runtime.cancelRun({ scope, reason: "Synthetic operator cancellation." });
    terminalStatus = ports.terminal?.status;

    expect(ports.terminal?.status).toBe("cancelled");
    expect(ports.executions).toHaveLength(0);

    // A late approval decision must not resurrect a cancelled run's tool call.
    const resumed = await runtime.resumeRun({
      scope,
      subject: fakeSubject(scope),
      approval: { approvalId: started.pendingApprovalId ?? "", decision: "approved" },
    });
    expect(resumed.status).toBe("cancelled");
    expect(resumed.failureCode).toBe("cancelled");
    expect(ports.executions).toHaveLength(0);
  });

  it("resuming with an approved decision runs the tool exactly once and creates exactly one approval record", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const executors = new Map([["synthetic.tool", async () => ({ status: "ok" })]]);
    const ports = createFakePorts({
      agent,
      descriptor,
      decisions: approvalDecisions(),
      executors,
    });
    const router = createModelRouter({
      providers: [
        createScriptedProvider([
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-1" },
            ],
          },
          { content: validFinalContent },
        ]),
      ],
    });
    // Sharing the same runtime instance means sharing the same ports and the
    // same checkpointer factory, so the resume continues the same checkpoint.
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });

    const started = await runtime.startRun({
      scope,
      subject: fakeSubject(scope),
      humanRequest: "Investigate.",
      outputSchema: "ExecutiveUpdate",
    });
    expect(started.status).toBe("awaiting_approval");
    const approvalId = started.pendingApprovalId;
    expect(approvalId).toBeTruthy();

    const resumed = await runtime.resumeRun({
      scope,
      subject: fakeSubject(scope),
      approval: { approvalId: approvalId ?? "", decision: "approved" },
    });

    expect(ports.executions).toHaveLength(1);
    expect(ports.approvals_).toHaveLength(1);
    expect(resumed.status).toBe("completed");
  });

  it("resuming with a rejected decision never invokes the executor and the run still completes", async () => {
    const scope = fakeScope({ runId: "00000000-0000-4000-8000-00000000d002" });
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const executors = new Map([["synthetic.tool", async () => ({ status: "ok" })]]);
    const ports = createFakePorts({
      agent,
      descriptor,
      decisions: approvalDecisions(),
      executors,
    });
    const router = createModelRouter({
      providers: [
        createScriptedProvider([
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-1" },
            ],
          },
          { content: validFinalContent },
        ]),
      ],
    });
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });

    const started = await runtime.startRun({
      scope,
      subject: fakeSubject(scope),
      humanRequest: "Investigate.",
      outputSchema: "ExecutiveUpdate",
    });
    expect(started.status).toBe("awaiting_approval");
    const approvalId = started.pendingApprovalId;

    const resumed = await runtime.resumeRun({
      scope,
      subject: fakeSubject(scope),
      approval: { approvalId: approvalId ?? "", decision: "rejected" },
    });

    expect(ports.executions).toHaveLength(0);
    expect(resumed.status).toBe("completed");
  });
});

describe("MusterAgentRuntime — completed external actions are not repeated after restart (criterion d)", () => {
  it("does not re-invoke the executor when a second runtime resumes over the same ports and checkpointer", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const decisions = new Map([
      [
        "synthetic.tool",
        {
          outcome: "allowed" as const,
          capability: "synthetic.read",
          classification: "internal",
        },
      ],
    ]);
    const executors = new Map([["synthetic.tool", async () => ({ status: "ok" })]]);
    const ports = createFakePorts({ agent, descriptor, decisions, executors });
    const sharedCheckpointerFactory = memoryCheckpointerFactory();
    const router = createModelRouter({
      providers: [
        createScriptedProvider([
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-1" },
            ],
          },
          { content: validFinalContent },
        ]),
      ],
    });

    const firstRuntime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: sharedCheckpointerFactory,
    });
    const completed = await firstRuntime.startRun({
      scope,
      subject: fakeSubject(scope),
      humanRequest: "Investigate.",
      outputSchema: "ExecutiveUpdate",
    });
    expect(completed.status).toBe("completed");
    expect(ports.executions).toHaveLength(1);

    // An empty script for the restarted worker: resuming a completed thread
    // must not ask the model for another turn either.
    const restartRouter = createModelRouter({
      providers: [createScriptedProvider([])],
    });
    const secondRuntime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router: restartRouter,
      createCheckpointer: sharedCheckpointerFactory,
    });
    const resumed = await secondRuntime.resumeRun({
      scope,
      subject: fakeSubject(scope),
    });

    expect(ports.executions).toHaveLength(1);
    expect(resumed.status).toBe("completed");
  });
});

describe("MusterAgentRuntime — in-flight action is not repeated automatically", () => {
  it("refuses to repeat a reservation that was left running by a previous attempt", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const decisions = new Map([
      [
        "synthetic.tool",
        {
          outcome: "allowed" as const,
          capability: "synthetic.read",
          classification: "internal",
        },
      ],
    ]);
    const executors = new Map([["synthetic.tool", async () => ({ status: "ok" })]]);
    const ports = createFakePorts({ agent, descriptor, decisions, executors });
    // Pre-seed a running reservation for the exact tool call id the script proposes.
    ports.reservations.set(`${scope.runId}:call-1`, { status: "running" });
    const router = createModelRouter({
      providers: [
        createScriptedProvider([
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-1" },
            ],
          },
          { content: validFinalContent },
        ]),
      ],
    });
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });

    const handle = await runtime.startRun({
      scope,
      subject: fakeSubject(scope),
      humanRequest: "Investigate.",
      outputSchema: "ExecutiveUpdate",
    });

    expect(ports.executions).toHaveLength(0);
    expect(handle.status).toBe("completed");
    expect(
      ports.events.some(
        (event) => event.type === "tool.failed" && event.toolCallId === "call-1",
      ),
    ).toBe(true);
  });
});

describe("MusterAgentRuntime.streamRun", () => {
  it("yields durable events in sequence order and stops at the first terminal event", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const ports = createFakePorts({ agent, descriptor });
    const router = createModelRouter({
      providers: [createScriptedProvider([{ content: validFinalContent }])],
    });
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
      streamPollMs: 1,
      streamTimeoutMs: 1_000,
    });

    const handle = await runtime.startRun({
      scope,
      subject: fakeSubject(scope),
      humanRequest: "Investigate.",
      outputSchema: "ExecutiveUpdate",
    });
    expect(handle.status).toBe("completed");

    const recordedTypes = ports.events.map((event) => event.type);
    expect(recordedTypes[recordedTypes.length - 1]).toBe("run.completed");

    const streamed: AgentRuntimeEvent[] = [];
    for await (const event of runtime.streamRun(scope.runId)) {
      streamed.push(event);
    }

    expect(streamed.map((event) => event.type)).toEqual(recordedTypes);
    expect(streamed[streamed.length - 1]?.type).toBe("run.completed");
    // Nothing follows the terminal event.
    expect(
      streamed.filter((event) => event.type === "run.completed"),
    ).toHaveLength(1);
  });
});

describe("MusterAgentRuntime.inspectRun", () => {
  it("returns the scope, thread id, graph version, step count and a sanitised event list", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const ports = createFakePorts({ agent, descriptor });
    const router = createModelRouter({
      providers: [createScriptedProvider([{ content: validFinalContent }])],
    });
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createCountingDbStub(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });

    const handle = await runtime.startRun({
      scope,
      subject: fakeSubject(scope),
      humanRequest: "Investigate.",
      outputSchema: "ExecutiveUpdate",
    });
    expect(handle.status).toBe("completed");

    const snapshot = await runtime.inspectRun(scope.runId);

    expect(snapshot.organisationId).toBe(scope.organisationId);
    expect(snapshot.agentId).toBe(scope.agentId);
    expect(snapshot.conversationId).toBe(scope.conversationId);
    expect(snapshot.threadId).toBe(threadIdFor(scope));
    expect(snapshot.graphVersion).toBe(AGENT_RUNTIME_GRAPH_VERSION);
    expect(snapshot.stepCount).toBeGreaterThan(0);
    expect(snapshot.checkpointCount).toBe(0);
    expect(snapshot.events.length).toBeGreaterThan(0);
    for (const event of snapshot.events) {
      // Re-sanitising an already-sanitised event must be a no-op: proves no
      // key outside the allowed vocabulary is present.
      expect(sanitiseRuntimeEvent(event)).toEqual(event);
    }
  });
});

