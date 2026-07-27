import type { AuthorisationSubject } from "@muster/authz";
import { and, eq } from "drizzle-orm";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPostgresRuntimePorts,
  toolCallIdempotencyKey,
  type ToolExecutor,
} from "./adapters/postgres.ts";
import { threadIdFor, runtimeScope, type RuntimeScope } from "./identity.ts";
import { createModelRouter } from "./model/router.ts";
import { createScriptedProvider } from "./model/providers/scripted.ts";
import type { ScriptedTurn } from "./model/providers/scripted.ts";
import { MusterAgentRuntime } from "./runtime.ts";
import { AGENT_RUNTIME_GRAPH_VERSION } from "./version.ts";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

const EXECUTIVE_UPDATE_PAYLOAD = {
  headline: "Synthetic executive update",
  status: "monitoring",
  impact: "No customer impact observed in this synthetic fixture.",
  actions: ["Continue synthetic monitoring."],
  nextUpdateAt: null,
};

describeIntegration("MusterAgentRuntime (PostgreSQL end to end)", () => {
  const db = database();

  async function makeOrganisation(label: string) {
    const suffix = newId();
    const organisationId = newId();
    await db.insert(schema.organisations).values({
      id: organisationId,
      name: `Synthetic Runtime Org ${label} ${suffix}`,
      slug: `synthetic-runtime-${label.toLowerCase()}-${suffix}`,
    });
    const humanActorId = newId();
    await db.insert(schema.actors).values({
      id: humanActorId,
      organisationId,
      actorType: "human",
      displayName: `Synthetic Operator ${label}`,
    });
    return { organisationId, humanActorId, suffix };
  }

  async function makeAgent(
    organisationId: string,
    ownerActorId: string,
    allowedTools: readonly string[],
  ) {
    const agentId = newId();
    await db.insert(schema.actors).values({
      id: agentId,
      organisationId,
      actorType: "agent",
      displayName: "Synthetic Runtime Agent",
    });
    await db.insert(schema.agentDefinitions).values({
      id: agentId,
      organisationId,
      name: `Synthetic Runtime Agent ${newId()}`,
      description: "Synthetic fixture agent for agent-runtime integration tests.",
      // 'local' makes modelPolicyForAgent() set allowLocal:true, so the
      // offline scripted provider (which is local:true) is eligible.
      runtime: "local",
      model: "general-medium",
      ownerActorId,
      systemPromptVersion: "v1",
      allowedTools,
    });
    return agentId;
  }

  async function makeRun(
    organisationId: string,
    agentId: string,
    requestedByActorId: string,
  ) {
    const runId = newId();
    const idempotencyKey = `agent-runtime-integration:${newId()}`;
    await db.insert(schema.agentRuns).values({
      id: runId,
      agentId,
      organisationId,
      requestedByActorId,
      trigger: "integration_test",
      status: "queued",
      inputHash: `sha256:${idempotencyKey}`,
      promptVersion: "v1",
      runtime: "graph",
      model: "general-medium",
      idempotencyKey,
    });
    return runId;
  }

  function subjectFor(
    scope: RuntimeScope,
    capabilities: readonly (typeof schema.agentDefinitions.$inferSelect)["id"][],
  ): AuthorisationSubject {
    return {
      actorId: scope.agentId,
      organisationId: scope.organisationId,
      capabilities: new Set(capabilities) as AuthorisationSubject["capabilities"],
    };
  }

  function runtimeFor(
    organisationId: string,
    router: ReturnType<typeof createModelRouter>,
    executors: ReadonlyMap<string, ToolExecutor>,
  ) {
    return new MusterAgentRuntime({
      organisationId,
      db,
      ports: createPostgresRuntimePorts({ db, executors }),
      router,
    });
  }

  async function runRow(runId: string) {
    const [row] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, runId))
      .limit(1);
    if (!row) throw new Error(`Run ${runId} vanished`);
    return row;
  }

  async function toolCallRows(organisationId: string, runId: string) {
    return db
      .select()
      .from(schema.agentToolCalls)
      .where(
        and(
          eq(schema.agentToolCalls.organisationId, organisationId),
          eq(schema.agentToolCalls.runId, runId),
        ),
      );
  }

  async function runEventRows(organisationId: string, runId: string) {
    return db
      .select()
      .from(schema.agentRunEvents)
      .where(
        and(
          eq(schema.agentRunEvents.organisationId, organisationId),
          eq(schema.agentRunEvents.runId, runId),
        ),
      )
      .orderBy(schema.agentRunEvents.createdAt);
  }

  async function outboxRows(organisationId: string, runId: string) {
    return db
      .select()
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.organisationId, organisationId),
          eq(schema.outboxEvents.aggregateId, runId),
        ),
      );
  }

  afterAll(closeDatabase);

  it("persists more than one checkpoint and completes with an authoritative structured output", async () => {
    const { organisationId, humanActorId } = await makeOrganisation("multi-step");
    const agentId = await makeAgent(organisationId, humanActorId, ["alerts.read"]);
    const runId = await makeRun(organisationId, agentId, humanActorId);
    const scope = runtimeScope({
      organisationId,
      agentId,
      conversationId: `conversation-${runId}`,
      runId,
    });
    const subject = subjectFor(scope, ["alerts.read"]);
    let calls = 0;
    const executors = new Map<string, ToolExecutor>([
      [
        "alerts.read",
        async () => {
          calls += 1;
          return { alerts: [] };
        },
      ],
    ]);
    const toolCallId = `call-${newId()}`;
    const script: ScriptedTurn[] = [
      {
        toolCalls: [
          { name: "alerts.read", arguments: { investigationId: null, limit: 5 }, toolCallId },
        ],
      },
      { content: JSON.stringify(EXECUTIVE_UPDATE_PAYLOAD) },
    ];
    const router = createModelRouter({ providers: [createScriptedProvider(script)] });
    const runtime = runtimeFor(organisationId, router, executors);

    const handle = await runtime.startRun({
      scope,
      subject,
      humanRequest: "Synthetic alerts review request.",
      outputSchema: "ExecutiveUpdate",
    });

    expect(handle.status).toBe("completed");
    expect(calls).toBe(1);

    const checkpoints = await db
      .select()
      .from(schema.agentRuntimeCheckpoints)
      .where(
        and(
          eq(schema.agentRuntimeCheckpoints.organisationId, organisationId),
          eq(schema.agentRuntimeCheckpoints.runId, runId),
        ),
      );
    expect(checkpoints.length).toBeGreaterThan(1);

    const run = await runRow(runId);
    expect(run.status).toBe("completed");
    expect(run.structuredOutput).toMatchObject({ headline: EXECUTIVE_UPDATE_PAYLOAD.headline });
    expect(run.graphVersion).toBe(AGENT_RUNTIME_GRAPH_VERSION);
    expect(run.checkpointThreadId).toBe(threadIdFor(scope));
  });

  it("resumes a completed run on a fresh runtime without repeating the tool call (worker handoff)", async () => {
    const { organisationId, humanActorId } = await makeOrganisation("handoff");
    const agentId = await makeAgent(organisationId, humanActorId, ["alerts.read"]);
    const runId = await makeRun(organisationId, agentId, humanActorId);
    const scope = runtimeScope({
      organisationId,
      agentId,
      conversationId: `conversation-${runId}`,
      runId,
    });
    const subject = subjectFor(scope, ["alerts.read"]);
    let calls = 0;
    const executors = new Map<string, ToolExecutor>([
      [
        "alerts.read",
        async () => {
          calls += 1;
          return { alerts: [] };
        },
      ],
    ]);
    const toolCallId = `call-${newId()}`;
    const script: ScriptedTurn[] = [
      {
        toolCalls: [
          { name: "alerts.read", arguments: { investigationId: null, limit: 5 }, toolCallId },
        ],
      },
      { content: JSON.stringify(EXECUTIVE_UPDATE_PAYLOAD) },
    ];
    const firstRouter = createModelRouter({ providers: [createScriptedProvider(script)] });
    const firstRuntime = runtimeFor(organisationId, firstRouter, executors);
    const started = await firstRuntime.startRun({
      scope,
      subject,
      humanRequest: "Synthetic alerts review request.",
      outputSchema: "ExecutiveUpdate",
    });
    expect(started.status).toBe("completed");
    expect(calls).toBe(1);

    const toolCallsBefore = await toolCallRows(organisationId, runId);
    expect(toolCallsBefore).toHaveLength(1);

    // Simulate a worker restart: a completely fresh runtime instance (a new
    // ports set, a new checkpointer) reads the same PostgreSQL state.
    const secondRouter = createModelRouter({ providers: [createScriptedProvider([])] });
    const secondRuntime = runtimeFor(organisationId, secondRouter, executors);
    const resumed = await secondRuntime.resumeRun({ scope, subject });

    expect(resumed.status).toBe("completed");
    expect(calls).toBe(1);
    const toolCallsAfter = await toolCallRows(organisationId, runId);
    expect(toolCallsAfter).toHaveLength(1);
  });

  it("reserves a tool call idempotently and rejects a duplicate reservation", async () => {
    const { organisationId, humanActorId } = await makeOrganisation("idempotency");
    const agentId = await makeAgent(organisationId, humanActorId, ["alerts.read"]);
    const runId = await makeRun(organisationId, agentId, humanActorId);
    const scope = runtimeScope({
      organisationId,
      agentId,
      conversationId: `conversation-${runId}`,
      runId,
    });
    const ports = createPostgresRuntimePorts({ db });
    const toolCallId = `call-${newId()}`;
    const first = await ports.toolExecution.reserve(scope, {
      toolCallId,
      toolName: "alerts.read",
      capability: "alerts.read",
      classification: "internal",
      argumentsHash: "synthetic-hash",
      checkpointId: null,
      approvalId: null,
    });
    expect(first).toMatchObject({ status: "reserved", replayed: false });
    if (first.status !== "reserved") throw new Error("expected reserved");
    await ports.toolExecution.settle(scope, {
      toolCallRecordId: first.toolCallRecordId,
      outcome: { status: "completed", result: { ok: true } },
    });

    const second = await ports.toolExecution.reserve(scope, {
      toolCallId,
      toolName: "alerts.read",
      capability: "alerts.read",
      classification: "internal",
      argumentsHash: "synthetic-hash",
      checkpointId: null,
      approvalId: null,
    });
    expect(second).toMatchObject({ status: "already_completed" });

    const rows = await toolCallRows(organisationId, runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.idempotencyKey).toBe(toolCallIdempotencyKey(runId, toolCallId));
  });

  it("pauses for approval, then resumes on a fresh runtime and executes exactly once", async () => {
    const { organisationId, humanActorId } = await makeOrganisation("approval");
    const agentId = await makeAgent(organisationId, humanActorId, [
      "tawny.endpoint.isolate",
    ]);
    const runId = await makeRun(organisationId, agentId, humanActorId);
    const scope = runtimeScope({
      organisationId,
      agentId,
      conversationId: `conversation-${runId}`,
      runId,
    });
    const subject = subjectFor(scope, ["tawny.response.isolate_host"]);
    let isolateCalls = 0;
    const executors = new Map<string, ToolExecutor>([
      [
        "tawny.endpoint.isolate",
        async () => {
          isolateCalls += 1;
          return { isolated: true };
        },
      ],
    ]);
    const toolCallId = `call-${newId()}`;
    const script: ScriptedTurn[] = [
      {
        toolCalls: [
          {
            name: "tawny.endpoint.isolate",
            arguments: { endpointId: "synthetic-endpoint-1", reason: "Synthetic containment reason." },
            toolCallId,
          },
        ],
      },
      { content: JSON.stringify(EXECUTIVE_UPDATE_PAYLOAD) },
    ];
    const firstRouter = createModelRouter({ providers: [createScriptedProvider(script)] });
    const firstRuntime = runtimeFor(organisationId, firstRouter, executors);

    const paused = await firstRuntime.startRun({
      scope,
      subject,
      humanRequest: "Synthetic isolation request.",
      outputSchema: "ExecutiveUpdate",
    });

    expect(paused.status).toBe("awaiting_approval");
    expect(paused.pendingApprovalId).toBeTruthy();
    expect(isolateCalls).toBe(0);

    const approvalsBefore = await db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.organisationId, organisationId));
    expect(approvalsBefore).toHaveLength(1);

    const runAwaiting = await runRow(runId);
    expect(runAwaiting.status).toBe("awaiting_approval");
    expect(runAwaiting.pendingApprovalId).toBe(paused.pendingApprovalId);

    // Worker handoff: a second, independent runtime resumes the interrupt.
    // After the tool executes, the graph asks the model once more for a
    // final response, so this router still needs that turn scripted.
    const secondRouter = createModelRouter({
      providers: [createScriptedProvider([{ content: JSON.stringify(EXECUTIVE_UPDATE_PAYLOAD) }])],
    });
    const secondRuntime = runtimeFor(organisationId, secondRouter, executors);
    const resumed = await secondRuntime.resumeRun({
      scope,
      subject,
      approval: { approvalId: paused.pendingApprovalId ?? "", decision: "approved" },
    });

    expect(resumed.status).toBe("completed");
    expect(isolateCalls).toBe(1);

    const approvalsAfter = await db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.organisationId, organisationId));
    expect(approvalsAfter).toHaveLength(1);
  });

  it("does not execute a denied tool call and completes from the refusal", async () => {
    const { organisationId, humanActorId } = await makeOrganisation("rejected-approval");
    const agentId = await makeAgent(organisationId, humanActorId, [
      "tawny.endpoint.isolate",
    ]);
    const runId = await makeRun(organisationId, agentId, humanActorId);
    const scope = runtimeScope({
      organisationId,
      agentId,
      conversationId: `conversation-${runId}`,
      runId,
    });
    const subject = subjectFor(scope, ["tawny.response.isolate_host"]);
    let isolateCalls = 0;
    const executors = new Map<string, ToolExecutor>([
      [
        "tawny.endpoint.isolate",
        async () => {
          isolateCalls += 1;
          return { isolated: true };
        },
      ],
    ]);
    const toolCallId = `call-${newId()}`;
    const script: ScriptedTurn[] = [
      {
        toolCalls: [
          {
            name: "tawny.endpoint.isolate",
            arguments: { endpointId: "synthetic-endpoint-2", reason: "Synthetic containment reason." },
            toolCallId,
          },
        ],
      },
      { content: JSON.stringify(EXECUTIVE_UPDATE_PAYLOAD) },
    ];
    const firstRouter = createModelRouter({ providers: [createScriptedProvider(script)] });
    const firstRuntime = runtimeFor(organisationId, firstRouter, executors);
    const paused = await firstRuntime.startRun({
      scope,
      subject,
      humanRequest: "Synthetic isolation request.",
      outputSchema: "ExecutiveUpdate",
    });
    expect(paused.status).toBe("awaiting_approval");

    // A rejection still leaves the model one more turn to answer from the
    // refusal, so this router needs the final content turn too.
    const secondRouter = createModelRouter({
      providers: [createScriptedProvider([{ content: JSON.stringify(EXECUTIVE_UPDATE_PAYLOAD) }])],
    });
    const secondRuntime = runtimeFor(organisationId, secondRouter, executors);
    const resumed = await secondRuntime.resumeRun({
      scope,
      subject,
      approval: { approvalId: paused.pendingApprovalId ?? "", decision: "rejected" },
    });

    expect(resumed.status).toBe("completed");
    expect(isolateCalls).toBe(0);
  });

  it("fails a resumed run whose graph version was retired, without invoking the model", async () => {
    const { organisationId, humanActorId } = await makeOrganisation("version-mismatch");
    const agentId = await makeAgent(organisationId, humanActorId, ["alerts.read"]);
    const runId = await makeRun(organisationId, agentId, humanActorId);
    const scope = runtimeScope({
      organisationId,
      agentId,
      conversationId: `conversation-${runId}`,
      runId,
    });
    const subject = subjectFor(scope, ["alerts.read"]);

    await db
      .update(schema.agentRuns)
      .set({
        graphVersion: "muster.agent-runtime.graph/0",
        checkpointThreadId: threadIdFor(scope),
        outputSchema: "ExecutiveUpdate",
      })
      .where(eq(schema.agentRuns.id, runId));

    // An empty script throws immediately if the model is ever invoked.
    const router = createModelRouter({ providers: [createScriptedProvider([])] });
    const runtime = runtimeFor(organisationId, router, new Map());

    const handle = await runtime.resumeRun({ scope, subject });

    expect(handle.status).toBe("failed");
    expect(handle.failureCode).toBe("graph_version_mismatch");
    const run = await runRow(runId);
    expect(run.status).toBe("failed");
    expect(run.failureCode).toBe("graph_version_mismatch");
  });

  it("stops the run when the kill switch flips mid-execution and does not run further tool calls", async () => {
    const { organisationId, humanActorId } = await makeOrganisation("kill-switch");
    const agentId = await makeAgent(organisationId, humanActorId, ["alerts.read"]);
    const runId = await makeRun(organisationId, agentId, humanActorId);
    const scope = runtimeScope({
      organisationId,
      agentId,
      conversationId: `conversation-${runId}`,
      runId,
    });
    const subject = subjectFor(scope, ["alerts.read"]);
    let calls = 0;
    const executors = new Map<string, ToolExecutor>([
      [
        "alerts.read",
        async () => {
          calls += 1;
          // The side effect of this tool call is the kill switch flipping,
          // simulating an operator disabling the agent mid-run.
          await db
            .update(schema.agentDefinitions)
            .set({ killSwitch: true })
            .where(eq(schema.agentDefinitions.id, agentId));
          return { alerts: [] };
        },
      ],
    ]);
    const toolCallId = `call-${newId()}`;
    // The script would answer normally if the graph kept going; it must not
    // reach this second turn.
    const script: ScriptedTurn[] = [
      {
        toolCalls: [
          { name: "alerts.read", arguments: { investigationId: null, limit: 5 }, toolCallId },
        ],
      },
      { content: JSON.stringify(EXECUTIVE_UPDATE_PAYLOAD) },
    ];
    const router = createModelRouter({ providers: [createScriptedProvider(script)] });
    const runtime = runtimeFor(organisationId, router, executors);

    const handle = await runtime.startRun({
      scope,
      subject,
      humanRequest: "Synthetic alerts review request.",
      outputSchema: "ExecutiveUpdate",
    });

    expect(handle.status).toBe("failed");
    expect(handle.failureCode).toBe("agent_kill_switch");
    expect(calls).toBe(1);
    const run = await runRow(runId);
    expect(run.failureCode).toBe("agent_kill_switch");
    const toolCalls = await toolCallRows(organisationId, runId);
    expect(toolCalls).toHaveLength(1);
  });

  it("rejects cross-organisation access and never reveals another tenant's run", async () => {
    const a = await makeOrganisation("tenant-a");
    const agentAId = await makeAgent(a.organisationId, a.humanActorId, ["alerts.read"]);
    const runAId = await makeRun(a.organisationId, agentAId, a.humanActorId);
    const scopeA = runtimeScope({
      organisationId: a.organisationId,
      agentId: agentAId,
      conversationId: `conversation-${runAId}`,
      runId: runAId,
    });
    const subjectA = subjectFor(scopeA, ["alerts.read"]);
    const script: ScriptedTurn[] = [{ content: JSON.stringify(EXECUTIVE_UPDATE_PAYLOAD) }];
    const routerA = createModelRouter({ providers: [createScriptedProvider(script)] });
    const runtimeA = runtimeFor(a.organisationId, routerA, new Map());
    const handle = await runtimeA.startRun({
      scope: scopeA,
      subject: subjectA,
      humanRequest: "Synthetic tenant-A request.",
      outputSchema: "ExecutiveUpdate",
    });
    expect(handle.status).toBe("completed");

    const b = await makeOrganisation("tenant-b");
    const routerB = createModelRouter({ providers: [createScriptedProvider([])] });
    const runtimeB = runtimeFor(b.organisationId, routerB, new Map());

    await expect(runtimeB.inspectRun(runAId)).rejects.toMatchObject({
      code: "stale_run",
    });
    await expect(async () => {
      for await (const _event of runtimeB.streamRun(runAId)) {
        // draining is enough; the generator must throw before yielding
      }
    }).rejects.toMatchObject({ code: "stale_run" });

    // The scope's organisationId matches runtimeB's own org, but agentId/
    // runId still name tenant A's rows: the organisation-scoped row lookup
    // itself must fail closed (404-equivalent), not silently bind tenant A's
    // run into tenant B's ledger.
    const foreignScope: RuntimeScope = { ...scopeA, organisationId: b.organisationId };
    await expect(
      runtimeB.startRun({
        scope: foreignScope,
        subject: subjectFor(foreignScope, ["alerts.read"]),
        humanRequest: "Cross-tenant attempt.",
        outputSchema: "ExecutiveUpdate",
      }),
    ).rejects.toMatchObject({ code: "stale_run" });
  });

  it("writes durable run events and a matching outbox row per progress event, without leaking a canary from model content", async () => {
    const { organisationId, humanActorId } = await makeOrganisation("events");
    const agentId = await makeAgent(organisationId, humanActorId, ["alerts.read"]);
    const runId = await makeRun(organisationId, agentId, humanActorId);
    const scope = runtimeScope({
      organisationId,
      agentId,
      conversationId: `conversation-${runId}`,
      runId,
    });
    const subject = subjectFor(scope, ["alerts.read"]);
    const canary = `synthetic-reasoning-canary-${newId()}`;
    const toolCallId = `call-${newId()}`;
    const executors = new Map<string, ToolExecutor>([
      ["alerts.read", async () => ({ alerts: [], note: canary })],
    ]);
    const script: ScriptedTurn[] = [
      {
        toolCalls: [
          { name: "alerts.read", arguments: { investigationId: null, limit: 5 }, toolCallId },
        ],
      },
      { content: JSON.stringify(EXECUTIVE_UPDATE_PAYLOAD) },
    ];
    const router = createModelRouter({ providers: [createScriptedProvider(script)] });
    const runtime = runtimeFor(organisationId, router, executors);

    const handle = await runtime.startRun({
      scope,
      subject,
      humanRequest: "Synthetic alerts review request.",
      outputSchema: "ExecutiveUpdate",
    });
    expect(handle.status).toBe("completed");

    const events = await runEventRows(organisationId, runId);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => event.eventType === "run.completed")).toBe(true);
    for (const event of events) {
      expect(JSON.stringify(event.payload)).not.toContain(canary);
    }

    const outbox = await outboxRows(organisationId, runId);
    const progressOutbox = outbox.filter(
      (row) => row.eventType === "agent.run.progress",
    );
    expect(progressOutbox.length).toBeGreaterThan(0);
    for (const row of progressOutbox) {
      expect(row.queueName).toBe("muster-notifications");
    }
    expect(outbox.some((row) => row.eventType === "agent.run.settled")).toBe(true);
  });
});
