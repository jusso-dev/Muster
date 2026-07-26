import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, eq } from "drizzle-orm";
import { DurableAgentRuntime } from "./runtime.ts";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("durable agent runtime", () => {
  let organisationId = "";
  let agentId = "";
  let requestedByActorId = "";

  beforeAll(async () => {
    const [definition] = await database()
      .select()
      .from(schema.agentDefinitions)
      .limit(1);
    if (!definition) throw new Error("Seeded agent definition required");
    organisationId = definition.organisationId;
    agentId = definition.id;
    requestedByActorId = definition.ownerActorId;
  });

  afterAll(closeDatabase);

  async function insertRun(
    suffix: string,
    overrides: Partial<typeof schema.agentRuns.$inferInsert> = {},
  ) {
    const [definition] = await database()
      .select()
      .from(schema.agentDefinitions)
      .where(
        and(
          eq(schema.agentDefinitions.organisationId, organisationId),
          eq(schema.agentDefinitions.id, agentId),
        ),
      )
      .limit(1);
    if (!definition) throw new Error("Agent definition missing");
    const id = newId();
    const [run] = await database()
      .insert(schema.agentRuns)
      .values({
        id,
        organisationId,
        agentId,
        requestedByActorId,
        investigationId: null,
        trigger: "integration_test",
        status: "queued",
        request: {
          humanRequest: `Synthetic durable runtime test ${suffix}`,
          traceId: `integration-${suffix}-${id}`,
        },
        progress: { stage: "queued", percent: 0 },
        deadlineAt: new Date(Date.now() + 10_000),
        inputHash: createHash("sha256").update(suffix).digest("hex"),
        promptVersion: definition.systemPromptVersion,
        runtime: "mock",
        model: definition.model,
        maximumRuntimeSeconds: 10,
        maximumTokenBudget: 1_000,
        maximumCostCents: 10,
        idempotencyKey: `integration:${suffix}:${id}`,
        ...overrides,
      })
      .returning();
    if (!run) throw new Error("Run insert failed");
    return run;
  }

  async function waitFor(runId: string, status: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [run] = await database()
        .select()
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.id, runId))
        .limit(1);
      if (run?.status === status) return run;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Run ${runId} did not reach ${status}`);
  }

  it("recovers an expired lease without duplicating the run", async () => {
    const run = await insertRun("restart");
    const duplicateId = newId();
    const duplicate = await database()
      .insert(schema.agentRuns)
      .values({
        ...run,
        id: duplicateId,
      })
      .onConflictDoNothing()
      .returning();
    expect(duplicate).toHaveLength(0);

    const firstRuntime = new DurableAgentRuntime({
      executionRuntime: "mock",
      codexHome: "/tmp/muster-runtime-integration",
      leaseMs: 100,
      pollMs: 50,
      mockDelayMs: 500,
    });
    await firstRuntime.dispatch();
    await waitFor(run.id, "running");
    firstRuntime.stop();
    await new Promise((resolve) => setTimeout(resolve, 125));

    const recoveredRuntime = new DurableAgentRuntime({
      executionRuntime: "mock",
      codexHome: "/tmp/muster-runtime-integration",
      leaseMs: 500,
      pollMs: 50,
      mockDelayMs: 25,
    });
    await recoveredRuntime.dispatch();
    const completed = await waitFor(run.id, "completed");
    recoveredRuntime.stop();

    expect(completed.attemptCount).toBe(2);
    expect(completed.outputHash).toMatch(/^[a-f0-9]{64}$/);
    const [count] = await database()
      .select({ count: schema.agentRuns.id })
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.organisationId, organisationId),
          eq(schema.agentRuns.idempotencyKey, run.idempotencyKey),
        ),
      );
    expect(count?.count).toBe(run.id);
  });

  it("persists cancellation before execution", async () => {
    const run = await insertRun("cancel");
    const runtime = new DurableAgentRuntime({
      executionRuntime: "mock",
      codexHome: "/tmp/muster-runtime-integration",
    });
    expect(
      await runtime.cancel(run.id, "Synthetic operator cancellation"),
    ).toBe(true);
    const cancelled = await waitFor(run.id, "cancelled");
    expect(cancelled.cancellationRequestedAt).not.toBeNull();
    expect(cancelled.cancellationReason).toBe(
      "Synthetic operator cancellation",
    );
  });

  it("enforces the persisted deadline and records diagnostics", async () => {
    const run = await insertRun("timeout", {
      deadlineAt: new Date(Date.now() + 75),
      maximumRuntimeSeconds: 1,
    });
    const runtime = new DurableAgentRuntime({
      executionRuntime: "mock",
      codexHome: "/tmp/muster-runtime-integration",
      leaseMs: 500,
      mockDelayMs: 500,
    });
    await runtime.dispatch();
    const failed = await waitFor(run.id, "failed");
    runtime.stop();
    expect(failed.failureCode).toBe("timeout");
    expect(failed.diagnostics).toMatchObject({
      validation: "failed",
      failureCode: "timeout",
    });
  });

  it("enforces token and cost ceilings from the durable run", async () => {
    const tokenRun = await insertRun("token-ceiling", {
      maximumTokenBudget: 100,
    });
    const tokenRuntime = new DurableAgentRuntime({
      executionRuntime: "mock",
      codexHome: "/tmp/muster-runtime-integration",
      mockDelayMs: 10,
    });
    await tokenRuntime.dispatch();
    expect((await waitFor(tokenRun.id, "failed")).failureCode).toBe(
      "token_ceiling",
    );
    tokenRuntime.stop();

    const costRun = await insertRun("cost-ceiling", {
      maximumCostCents: 0,
    });
    const costRuntime = new DurableAgentRuntime({
      executionRuntime: "mock",
      codexHome: "/tmp/muster-runtime-integration",
      mockDelayMs: 10,
      mockEstimatedCostCents: 1,
    });
    await costRuntime.dispatch();
    expect((await waitFor(costRun.id, "failed")).failureCode).toBe(
      "cost_ceiling",
    );
    costRuntime.stop();
  });
});
