import { MemorySaver } from "@langchain/langgraph-checkpoint";
import type { AuthorisationSubject } from "@muster/authz";
import type { database } from "@muster/database";
import { describe, expect, it } from "vitest";
import { AgentRuntimeError } from "../errors.ts";
import { threadIdFor, type RuntimeScope } from "../identity.ts";
import { createModelRouter } from "../model/router.ts";
import { createScriptedProvider } from "../model/providers/scripted.ts";
import type { ModelRouter } from "../model/types.ts";
import { MusterAgentRuntime } from "../runtime.ts";
import {
  createFakePorts,
  fakeAgentRecord,
  fakeDescriptor,
  fakeScope,
  memoryCheckpointerFactory,
} from "../testing/index.ts";
import { buildAgentGraph } from "./build.ts";
import type { GraphDependencies } from "./nodes.ts";
import type { RuntimeState } from "./state.ts";

type Db = ReturnType<typeof database>;

/** A run should never touch the database in these fully offline tests. */
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

function fakeSubject(scope: RuntimeScope): AuthorisationSubject {
  return {
    actorId: scope.agentId,
    organisationId: scope.organisationId,
    capabilities: new Set(),
  };
}

function configFor(scope: RuntimeScope) {
  return { configurable: { thread_id: threadIdFor(scope), checkpoint_ns: "" } };
}

const validExecutiveUpdate = {
  headline: "Synthetic executive update",
  status: "monitoring" as const,
  impact: "Synthetic impact statement for a governed run.",
  actions: ["Synthetic follow-up action"],
  nextUpdateAt: null,
};
const validFinalContent = JSON.stringify(validExecutiveUpdate);

describe("buildAgentGraph — multi-step persistence", () => {
  it("checkpoints more than once across a tool round-trip (criterion a)", async () => {
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
    const executors = new Map([
      ["synthetic.tool", async () => ({ status: "ok" })],
    ]);
    const ports = createFakePorts({ agent, descriptor, decisions, executors });
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

    class CountingSaver extends MemorySaver {
      putCalls = 0;
      override async put(...args: Parameters<MemorySaver["put"]>) {
        this.putCalls += 1;
        return super.put(...args);
      }
    }
    const saver = new CountingSaver();

    const dependencies: GraphDependencies = {
      scope,
      subject: fakeSubject(scope),
      ports,
      router,
    };
    const graph = buildAgentGraph(dependencies, saver);
    const result = (await graph.invoke(
      { humanRequest: "Investigate the synthetic incident.", outputSchema: "ExecutiveUpdate" },
      configFor(scope),
    )) as RuntimeState;

    expect(result.settled).toBe(true);
    expect(ports.executions).toHaveLength(1);
    // This run crosses at least 12 graph supersteps (identity/scope, thread
    // state, memory, bounded context, plan, authorise, execute, validate,
    // bounded context again, plan again, propose memories, persist), each of
    // which durably checkpoints. >= 5 is a conservative floor that still
    // proves more than a single checkpoint was written across the tool
    // round-trip, without hard-coding the exact LangGraph superstep count.
    expect(saver.putCalls).toBeGreaterThanOrEqual(5);
  });
});

describe("buildAgentGraph — tool authorisation gates", () => {
  it("never invokes the tool executor when the policy denies the call", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const decisions = new Map([
      [
        "synthetic.tool",
        {
          outcome: "denied" as const,
          reason: "Synthetic policy denial.",
          code: "policy_denied",
        },
      ],
    ]);
    const ports = createFakePorts({ agent, descriptor, decisions });
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
    const dependencies: GraphDependencies = {
      scope,
      subject: fakeSubject(scope),
      ports,
      router,
    };
    const graph = buildAgentGraph(dependencies, new MemorySaver());
    const result = (await graph.invoke(
      { humanRequest: "Investigate.", outputSchema: "ExecutiveUpdate" },
      configFor(scope),
    )) as RuntimeState;

    expect(ports.executions).toHaveLength(0);
    expect(result.settled).toBe(true);
  });

  it("invokes the tool executor exactly once when the policy allows the call", async () => {
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
    const executors = new Map([
      ["synthetic.tool", async () => ({ status: "ok" })],
    ]);
    const ports = createFakePorts({ agent, descriptor, decisions, executors });
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
    const dependencies: GraphDependencies = {
      scope,
      subject: fakeSubject(scope),
      ports,
      router,
    };
    const graph = buildAgentGraph(dependencies, new MemorySaver());
    const config = configFor(scope);
    const result = (await graph.invoke(
      { humanRequest: "Investigate.", outputSchema: "ExecutiveUpdate" },
      config,
    )) as RuntimeState;

    expect(ports.executions).toHaveLength(1);
    expect(result.settled).toBe(true);

    // Untrusted framing: the tool result must enter context as data, never
    // as a system or trusted-instruction channel message.
    const snapshot = await graph.getState(config);
    const values = snapshot.values as RuntimeState;
    const toolResultMessage = values.messages.find(
      (message) => message.toolCallId === "call-1",
    );
    expect(toolResultMessage).toBeDefined();
    expect(toolResultMessage?.role).toBe("tool_result");
    expect(toolResultMessage?.role).not.toBe("system_policy");
    expect(toolResultMessage?.role).not.toBe("trusted_instruction");
  });
});

describe("buildAgentGraph — step ceiling", () => {
  it("fails with step_ceiling once the agent's maximum steps are exceeded", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord({ maximumSteps: 2 });
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
    const executors = new Map([
      ["synthetic.tool", async () => ({ status: "ok" })],
    ]);
    const ports = createFakePorts({ agent, descriptor, decisions, executors });
    const router = createModelRouter({
      providers: [
        createScriptedProvider([
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-1" },
            ],
          },
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-2" },
            ],
          },
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

    expect(handle.status).toBe("failed");
    expect(handle.failureCode).toBe("step_ceiling");
  });
});

describe("buildAgentGraph — kill switch mid-run (criterion i)", () => {
  it("terminates with agent_kill_switch and stops further tool executions after the flip", async () => {
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
    const executors = new Map([
      ["synthetic.tool", async () => ({ status: "ok" })],
    ]);
    let guardCalls = 0;
    const ports = createFakePorts({
      agent,
      descriptor,
      decisions,
      executors,
      verdict: () => {
        guardCalls += 1;
        // Guard call order for this run: resolveIdentityAndScope(1),
        // planNextStep(2), authoriseTool(3), executeTool(4), validateResult(5),
        // then planNextStep again(6). Flip after the first tool call has fully
        // executed but before the model is asked to propose a second one.
        if (guardCalls <= 5) return { runnable: true };
        return {
          runnable: false,
          code: "agent_kill_switch",
          reason: "Synthetic kill switch engaged mid-run.",
        };
      },
    });
    const router = createModelRouter({
      providers: [
        createScriptedProvider([
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-1" },
            ],
          },
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-2" },
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

    expect(handle.status).toBe("failed");
    expect(handle.failureCode).toBe("agent_kill_switch");
    // Only the first tool call, proposed before the kill switch flipped, ran.
    expect(ports.executions).toHaveLength(1);
    expect(ports.executions[0]?.toolCallId).toBe("call-1");
    expect(ports.terminal?.status).toBe("failed");
  });
});

describe("buildAgentGraph — cancellation during model execution (criterion i)", () => {
  it("cancels immediately when the signal is already aborted", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const ports = createFakePorts({ agent, descriptor });
    const router = createModelRouter({
      providers: [createScriptedProvider([])],
    });
    const runtime = new MusterAgentRuntime({
      organisationId: scope.organisationId,
      db: createUntouchableDb(),
      ports,
      router,
      createCheckpointer: memoryCheckpointerFactory(),
    });
    const controller = new AbortController();
    controller.abort();

    const handle = await runtime.startRun({
      scope,
      subject: fakeSubject(scope),
      humanRequest: "Investigate.",
      outputSchema: "ExecutiveUpdate",
      signal: controller.signal,
    });

    expect(handle.status).toBe("cancelled");
    expect(ports.terminal?.status).toBe("cancelled");
  });

  it("cancels once the signal is aborted after the first guard passes", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const controller = new AbortController();
    let firstGuardCall = true;
    const ports = createFakePorts({
      agent,
      descriptor,
      verdict: () => {
        if (firstGuardCall) {
          firstGuardCall = false;
          controller.abort();
        }
        return { runnable: true };
      },
    });
    // An empty script: if the model were ever invoked past the abort, the
    // scripted provider would throw a different (non-cancelled) error.
    const router = createModelRouter({
      providers: [createScriptedProvider([])],
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
      signal: controller.signal,
    });

    expect(handle.status).toBe("cancelled");
    expect(ports.terminal?.status).toBe("cancelled");
  });

  it("cancels a run whose signal aborts during tool execution, without completing", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord({ allowedTools: ["alerts.read"] });
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const controller = new AbortController();
    const decisions = new Map([
      [
        "alerts.read",
        {
          outcome: "allowed" as const,
          capability: "alerts.read",
          classification: "internal",
        },
      ],
    ]);
    // The abort signal fires as a side effect of the tool call itself,
    // simulating cancellation arriving while the tool is in flight. The
    // scripted final-answer turn must never be reached.
    const executors = new Map([
      [
        "alerts.read",
        async () => {
          controller.abort();
          return { alerts: [] };
        },
      ],
    ]);
    const ports = createFakePorts({ agent, descriptor, decisions, executors });
    const router = createModelRouter({
      providers: [
        createScriptedProvider([
          {
            toolCalls: [
              { name: "alerts.read", arguments: { investigationId: null, limit: 5 }, toolCallId: "call-1" },
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
      signal: controller.signal,
    });

    expect(handle.status).toBe("cancelled");
    expect(ports.terminal?.status).toBe("cancelled");
    expect(ports.executions).toHaveLength(1);
  });
});

describe("buildAgentGraph — context compaction", () => {
  it("compacts old tool results into a bounded summary once the input ceiling is exceeded", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord({
      modelPolicy: {
        preferred: "general-medium",
        allowLocal: true,
        maxInputTokens: 900,
        maxOutputTokens: 8_000,
      },
    });
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
    const bulkResult = "x".repeat(3_000);
    const executors = new Map([
      ["synthetic.tool", async () => bulkResult],
    ]);
    const ports = createFakePorts({ agent, descriptor, decisions, executors });
    const router = createModelRouter({
      providers: [
        createScriptedProvider([
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-1" },
            ],
          },
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-2" },
            ],
          },
          {
            toolCalls: [
              { name: "synthetic.tool", arguments: {}, toolCallId: "call-3" },
            ],
          },
          { content: validFinalContent },
        ]),
      ],
    });
    const dependencies: GraphDependencies = {
      scope,
      subject: fakeSubject(scope),
      ports,
      router,
    };
    const graph = buildAgentGraph(dependencies, new MemorySaver());
    const result = (await graph.invoke(
      { humanRequest: "Investigate the incident.", outputSchema: "ExecutiveUpdate" },
      configFor(scope),
    )) as RuntimeState;

    expect(result.settled).toBe(true);
    expect(result.contextSummary).not.toBeNull();
    // Without compaction, three tool rounds plus the two trusted messages
    // would leave 5 messages in the window; compaction keeps it bounded.
    expect(result.messages.length).toBeLessThan(5);
    expect(result.messages.some((message) => message.role === "system_policy")).toBe(
      true,
    );
    expect(result.messages.some((message) => message.role === "human_request")).toBe(
      true,
    );
  });
});

describe("buildAgentGraph — invalid model output", () => {
  it("gets exactly one corrective turn before failing with invalid_json", async () => {
    const scope = fakeScope();
    const agent = fakeAgentRecord();
    const descriptor = fakeDescriptor(scope, { outputSchema: "ExecutiveUpdate" });
    const ports = createFakePorts({ agent, descriptor });
    const baseRouter = createModelRouter({
      providers: [
        createScriptedProvider([
          { content: "this is not json" },
          { content: "still not json" },
        ]),
      ],
    });
    let modelCalls = 0;
    const router: ModelRouter = {
      resolve: baseRouter.resolve,
      generate: async (request) => {
        modelCalls += 1;
        return baseRouter.generate(request);
      },
    };
    const dependencies: GraphDependencies = {
      scope,
      subject: fakeSubject(scope),
      ports,
      router,
    };
    const graph = buildAgentGraph(dependencies, new MemorySaver());

    let caught: unknown;
    try {
      await graph.invoke(
        { humanRequest: "Investigate.", outputSchema: "ExecutiveUpdate" },
        configFor(scope),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AgentRuntimeError);
    expect((caught as AgentRuntimeError).code).toBe("invalid_json");
    // Exactly the initial attempt plus one corrective turn — a third call
    // would exhaust the two-turn script and throw a different error instead.
    expect(modelCalls).toBe(2);
  });
});
