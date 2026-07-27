import {
  emptyCheckpoint,
  uuid6,
  type Checkpoint,
  type CheckpointMetadata,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { and, eq } from "drizzle-orm";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CheckpointScopeViolationError } from "../identity.ts";
import { countCheckpoints, latestCheckpointId, MusterPostgresCheckpointSaver } from "./postgres.ts";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("MusterPostgresCheckpointSaver", () => {
  const db = database();

  let organisationAId = "";
  let organisationBId = "";
  let actorAId = "";
  let actorBId = "";
  let agentAId = "";
  let agentBId = "";
  let runAId = "";
  let runBId = "";

  beforeAll(async () => {
    const suffix = newId();
    async function makeTenant(label: string) {
      const organisationId = newId();
      await db.insert(schema.organisations).values({
        id: organisationId,
        name: `Synthetic Checkpointer Org ${label} ${suffix}`,
        slug: `synthetic-checkpointer-${label.toLowerCase()}-${suffix}`,
      });
      const actorId = newId();
      await db.insert(schema.actors).values({
        id: actorId,
        organisationId,
        actorType: "agent",
        displayName: `Synthetic Runtime Agent ${label}`,
      });
      const agentId = newId();
      await db.insert(schema.agentDefinitions).values({
        id: agentId,
        organisationId,
        name: `Synthetic Runtime Agent ${label}`,
        description: "Synthetic fixture agent for checkpointer integration tests.",
        runtime: "graph",
        model: "general-medium",
        ownerActorId: actorId,
        systemPromptVersion: "v1",
      });
      const runId = newId();
      await db.insert(schema.agentRuns).values({
        id: runId,
        agentId,
        organisationId,
        requestedByActorId: actorId,
        trigger: "integration_test",
        status: "queued",
        inputHash: `sha256:${suffix}`,
        promptVersion: "v1",
        runtime: "graph",
        model: "general-medium",
        idempotencyKey: `checkpointer-integration:${label}:${suffix}`,
      });
      return { organisationId, actorId, agentId, runId };
    }
    const a = await makeTenant("A");
    const b = await makeTenant("B");
    organisationAId = a.organisationId;
    actorAId = a.actorId;
    agentAId = a.agentId;
    runAId = a.runId;
    organisationBId = b.organisationId;
    actorBId = b.actorId;
    agentBId = b.agentId;
    runBId = b.runId;
  });

  afterAll(closeDatabase);

  function saverFor(
    organisationId: string,
    agentId: string,
    runId: string,
    conversationId = "synthetic-conversation",
  ) {
    return new MusterPostgresCheckpointSaver({
      db,
      organisationId,
      agentId,
      conversationId,
      runId,
      graphVersion: "muster.agent-runtime.graph/1",
    });
  }

  function configFor(saver: MusterPostgresCheckpointSaver, checkpointId?: string) {
    return {
      configurable: {
        thread_id: saver.threadId,
        checkpoint_ns: "",
        ...(checkpointId ? { checkpoint_id: checkpointId } : {}),
      },
    };
  }

  function checkpointWith(overrides: Partial<Checkpoint> = {}): Checkpoint {
    return {
      ...emptyCheckpoint(),
      id: uuid6(0),
      channel_values: { messages: ["synthetic-value"] },
      ...overrides,
    };
  }

  const metadata: CheckpointMetadata = { source: "loop", step: 0, parents: {} };

  it("round-trips a checkpoint through the jsonb envelope", async () => {
    const saver = saverFor(organisationAId, agentAId, runAId, `rt-${newId()}`);
    const checkpoint = checkpointWith();
    const resultConfig = await saver.put(configFor(saver), checkpoint, metadata);
    const tuple = await saver.getTuple(resultConfig);
    expect(tuple).toBeDefined();
    expect(tuple?.checkpoint.channel_values).toEqual({
      messages: ["synthetic-value"],
    });
    expect(tuple?.metadata).toEqual(metadata);
  });

  it("is upsert-safe when the same checkpoint id is written twice", async () => {
    const saver = saverFor(organisationAId, agentAId, runAId, `upsert-${newId()}`);
    const checkpoint = checkpointWith();
    await saver.put(configFor(saver), checkpoint, metadata);
    await expect(
      saver.put(configFor(saver), checkpointWith({ id: checkpoint.id, channel_values: { messages: ["updated"] } }), metadata),
    ).resolves.toBeDefined();
    const [rows] = await db
      .select({ value: schema.agentRuntimeCheckpoints.checkpointId })
      .from(schema.agentRuntimeCheckpoints)
      .where(
        and(
          eq(schema.agentRuntimeCheckpoints.organisationId, organisationAId),
          eq(schema.agentRuntimeCheckpoints.threadId, saver.threadId),
          eq(schema.agentRuntimeCheckpoints.checkpointId, checkpoint.id),
        ),
      );
    expect(rows).toBeDefined();
    const tuple = await saver.getTuple(configFor(saver, checkpoint.id));
    expect(tuple?.checkpoint.channel_values).toEqual({ messages: ["updated"] });
  });

  it("persists pending writes and is idempotent for the same (taskId, index)", async () => {
    const saver = saverFor(organisationAId, agentAId, runAId, `writes-${newId()}`);
    const checkpoint = checkpointWith();
    const config = await saver.put(configFor(saver), checkpoint, metadata);
    await saver.putWrites(config, [["messages", "first-write"]], "task-1");
    await expect(
      saver.putWrites(config, [["messages", "first-write"]], "task-1"),
    ).resolves.toBeUndefined();
    const tuple = await saver.getTuple(config);
    expect(tuple?.pendingWrites).toEqual([["task-1", "messages", "first-write"]]);
  });

  it("honours limit and before, returning newest first", async () => {
    const saver = saverFor(organisationAId, agentAId, runAId, `list-${newId()}`);
    const ids: string[] = [];
    let config: RunnableConfig = configFor(saver);
    for (let index = 0; index < 3; index += 1) {
      const checkpoint = checkpointWith({ id: uuid6(index) });
      ids.push(checkpoint.id);
      config = await saver.put(config, checkpoint, {
        ...metadata,
        step: index,
      });
    }
    const all: string[] = [];
    for await (const tuple of saver.list(configFor(saver))) {
      all.push(tuple.checkpoint.id);
    }
    expect(all).toEqual([...ids].reverse());

    const limited: string[] = [];
    for await (const tuple of saver.list(configFor(saver), { limit: 1 })) {
      limited.push(tuple.checkpoint.id);
    }
    expect(limited).toEqual([ids[2]]);

    const before: string[] = [];
    for await (const tuple of saver.list(configFor(saver), {
      before: configFor(saver, ids[2]),
    })) {
      before.push(tuple.checkpoint.id);
    }
    expect(before).toEqual([ids[1], ids[0]]);
  });

  it("rejects cross-organisation reads and never leaks another tenant's rows", async () => {
    const conversationId = `cross-tenant-${newId()}`;
    const saverA = saverFor(organisationAId, agentAId, runAId, conversationId);
    const checkpoint = checkpointWith();
    await saverA.put(configFor(saverA), checkpoint, metadata);

    // Organisation B's own saver, addressing A's exact thread id.
    const saverB = saverFor(organisationBId, agentBId, runBId, "unrelated");
    const foreignConfig = {
      configurable: { thread_id: saverA.threadId, checkpoint_ns: "" },
    };
    await expect(saverB.getTuple(foreignConfig)).rejects.toThrow(
      CheckpointScopeViolationError,
    );
    await expect(async () => {
      for await (const _tuple of saverB.list(foreignConfig)) {
        // draining is enough to prove it throws before yielding anything
      }
    }).rejects.toThrow(CheckpointScopeViolationError);

    // Direct SQL: every row this saver wrote carries A's full tenant scope.
    const [row] = await db
      .select()
      .from(schema.agentRuntimeCheckpoints)
      .where(
        and(
          eq(schema.agentRuntimeCheckpoints.organisationId, organisationAId),
          eq(schema.agentRuntimeCheckpoints.threadId, saverA.threadId),
          eq(schema.agentRuntimeCheckpoints.checkpointId, checkpoint.id),
        ),
      );
    expect(row).toMatchObject({
      organisationId: organisationAId,
      agentId: agentAId,
      conversationId,
      runId: runAId,
      graphVersion: "muster.agent-runtime.graph/1",
    });

    const [leaked] = await db
      .select()
      .from(schema.agentRuntimeCheckpoints)
      .where(
        and(
          eq(schema.agentRuntimeCheckpoints.organisationId, organisationBId),
          eq(schema.agentRuntimeCheckpoints.threadId, saverA.threadId),
        ),
      );
    expect(leaked).toBeUndefined();
  });

  it("deletes only the addressed organisation's rows for a thread", async () => {
    const conversationId = `delete-${newId()}`;
    const saverA = saverFor(organisationAId, agentAId, runAId, conversationId);
    const checkpoint = checkpointWith();
    await saverA.put(configFor(saverA), checkpoint, metadata);
    await saverA.deleteThread(saverA.threadId);
    const tuple = await saverA.getTuple(configFor(saverA));
    expect(tuple).toBeUndefined();

    // A foreign thread id addressed by the wrong saver still throws instead
    // of silently deleting nothing.
    const saverB = saverFor(organisationBId, agentBId, runBId, "unrelated-delete");
    await expect(saverB.deleteThread(saverA.threadId)).rejects.toThrow(
      CheckpointScopeViolationError,
    );
  });

  it("scopes countCheckpoints and latestCheckpointId by organisation", async () => {
    const conversationId = `count-${newId()}`;
    const saverA = saverFor(organisationAId, agentAId, runAId, conversationId);
    await saverA.put(configFor(saverA), checkpointWith({ id: uuid6(0) }), metadata);
    await saverA.put(configFor(saverA), checkpointWith({ id: uuid6(1) }), metadata);

    expect(await countCheckpoints(db, organisationAId, runAId)).toBeGreaterThanOrEqual(2);
    expect(await countCheckpoints(db, organisationBId, runAId)).toBe(0);
    expect(await latestCheckpointId(db, organisationBId, runAId)).toBeUndefined();
    expect(await latestCheckpointId(db, organisationAId, runAId)).toBeTypeOf("string");
  });
});
