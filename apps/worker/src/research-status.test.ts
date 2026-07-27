import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, eq, inArray } from "drizzle-orm";
import {
  appendResearchTerminalMessage,
  researchTerminalMessageText,
  type ResearchTerminalMessageKind,
} from "./research-status.ts";

const describeIntegration =
  process.env.MUSTER_INTEGRATION_TESTS === "true"
    ? describe.sequential
    : describe.skip;

describe("research terminal status copy", () => {
  it("uses fixed redacted copy for terminal failure and no-change success", () => {
    expect(researchTerminalMessageText("failed")).toBe(
      "Alfie research could not complete after the final retry. No feed content was posted. Review the agent run before retrying.",
    );
    expect(researchTerminalMessageText("no_changes")).toBe(
      "Alfie research completed. No new or changed findings were found.",
    );
  });
});

describeIntegration("research terminal status persistence", () => {
  const db = database();
  const watchlistIds: string[] = [];
  const researchRunIds: string[] = [];
  const agentRunIds: string[] = [];
  let organisationId = "";
  let agentId = "";
  let roomId = "";
  let promptVersion = "";
  let runtime = "";
  let model = "";

  beforeAll(async () => {
    const [agent] = await db
      .select()
      .from(schema.agentDefinitions)
      .where(
        and(
          eq(schema.agentDefinitions.name, "Alfie"),
          eq(schema.agentDefinitions.status, "active"),
          eq(schema.agentDefinitions.killSwitch, false),
        ),
      )
      .limit(1);
    if (
      !agent ||
      !Array.isArray(agent.allowedRooms) ||
      typeof agent.allowedRooms[0] !== "string"
    ) {
      throw new Error("Bootstrap Alfie with an allowed room before tests");
    }
    organisationId = agent.organisationId;
    agentId = agent.id;
    roomId = agent.allowedRooms[0];
    promptVersion = agent.systemPromptVersion;
    runtime = agent.runtime;
    model = agent.model;
  });

  async function terminalRun(
    kind: ResearchTerminalMessageKind,
    canary: string,
    posted = 0,
  ) {
    const watchlistId = newId();
    const researchRunId = newId();
    const agentRunId = newId();
    watchlistIds.push(watchlistId);
    researchRunIds.push(researchRunId);
    agentRunIds.push(agentRunId);
    const terminalStatus = kind === "failed" ? "failed" : "completed";
    const sourceUrl = `https://secret.example/feed?token=${canary}`;

    await db.insert(schema.researchWatchlists).values({
      id: watchlistId,
      organisationId,
      roomId,
      createdByActorId: agentId,
      name: `Synthetic terminal visibility ${watchlistId}`,
      vendors: [],
      technologies: [],
      sources: [{ name: canary, url: sourceUrl }],
      cadenceMinutes: 240,
      enabled: false,
      nextRunAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(schema.agentRuns).values({
      id: agentRunId,
      agentId,
      organisationId,
      roomId,
      requestedByActorId: agentId,
      trigger: "schedule",
      status: terminalStatus,
      request: { researchRunId, watchlistId, secret: canary },
      progress: { stage: terminalStatus, percent: 100 },
      inputHash: "0".repeat(64),
      promptVersion,
      runtime,
      model,
      structuredOutput:
        kind === "no_changes" ? { posted, sources: 1, briefHashes: [] } : null,
      error: kind === "failed" ? `Bearer ${canary} from ${sourceUrl}` : null,
      failureCode: kind === "failed" ? "research_feed_failed" : null,
      completedAt: new Date(),
      idempotencyKey: `test:research-terminal-agent:${agentRunId}`,
    });
    await db.insert(schema.researchRuns).values({
      id: researchRunId,
      organisationId,
      watchlistId,
      agentRunId,
      status: terminalStatus,
      sourceLimit: 5,
      tokenBudget: 1_000,
      costLimitCents: 10,
      timeLimitSeconds: 60,
      idempotencyKey: `test:research-terminal:${researchRunId}`,
      completedAt: new Date(),
      error: kind === "failed" ? `Bearer ${canary} from ${sourceUrl}` : null,
    });
    return { researchRunId, agentRunId, sourceUrl };
  }

  async function append(
    researchRunId: string,
    kind: ResearchTerminalMessageKind,
    scopedOrganisationId = organisationId,
  ) {
    return db.transaction((tx) =>
      appendResearchTerminalMessage(tx, {
        organisationId: scopedOrganisationId,
        researchRunId,
        kind,
        traceId: `test:research-terminal:${researchRunId}`,
      }),
    );
  }

  it("appends one scoped redacted failure message and remains replay safe", async () => {
    const canary = `synthetic-research-secret-${newId()}`;
    const run = await terminalRun("failed", canary);

    expect(await append(run.researchRunId, "failed", newId())).toBeNull();
    const firstMessageId = await append(run.researchRunId, "failed");
    expect(firstMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await append(run.researchRunId, "failed")).toBeNull();

    const messages = await db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.organisationId, organisationId),
          eq(
            schema.messages.idempotencyKey,
            `research.status.message:${run.researchRunId}`,
          ),
        ),
      );
    const outbox = await db
      .select()
      .from(schema.outboxEvents)
      .where(
        eq(
          schema.outboxEvents.idempotencyKey,
          `room.message.created:research-status:${run.researchRunId}`,
        ),
      );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: firstMessageId,
      organisationId,
      roomId,
      authorActorId: agentId,
      messageType: "agent-status",
      relatedAgentRunId: run.agentRunId,
    });
    expect(messages[0]?.document).toMatchObject({
      type: "research-run-status",
      researchRunId: run.researchRunId,
      agentRunId: run.agentRunId,
      status: "failed",
      failureCode: "research_feed_failed",
      trust: "agent-status",
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      organisationId,
      eventType: "room.message.created",
      aggregateType: "message",
      aggregateId: firstMessageId,
      payload: { messageId: firstMessageId, roomId },
    });
    const visibleRecord = JSON.stringify({ messages, outbox });
    expect(visibleRecord).not.toContain(canary);
    expect(visibleRecord).not.toContain(run.sourceUrl);
    expect(visibleRecord).not.toContain("secret.example");
  });

  it("appends one no-change success message and refuses a run with findings", async () => {
    const noChanges = await terminalRun(
      "no_changes",
      `synthetic-no-change-${newId()}`,
    );
    const withFinding = await terminalRun(
      "no_changes",
      `synthetic-finding-${newId()}`,
      1,
    );

    const firstMessageId = await append(noChanges.researchRunId, "no_changes");
    expect(firstMessageId).toBeTruthy();
    expect(await append(noChanges.researchRunId, "no_changes")).toBeNull();
    expect(await append(withFinding.researchRunId, "no_changes")).toBeNull();

    const messages = await db
      .select()
      .from(schema.messages)
      .where(
        eq(
          schema.messages.idempotencyKey,
          `research.status.message:${noChanges.researchRunId}`,
        ),
      );
    const withFindingMessages = await db
      .select()
      .from(schema.messages)
      .where(
        eq(
          schema.messages.idempotencyKey,
          `research.status.message:${withFinding.researchRunId}`,
        ),
      );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      plainText:
        "Alfie research completed. No new or changed findings were found.",
      relatedAgentRunId: noChanges.agentRunId,
    });
    expect(messages[0]?.document).toMatchObject({
      status: "completed_no_changes",
      researchRunId: noChanges.researchRunId,
    });
    expect(withFindingMessages).toHaveLength(0);
  });

  afterAll(async () => {
    for (const researchRunId of researchRunIds) {
      await db
        .delete(schema.outboxEvents)
        .where(
          eq(
            schema.outboxEvents.idempotencyKey,
            `room.message.created:research-status:${researchRunId}`,
          ),
        );
      await db
        .delete(schema.messages)
        .where(
          eq(
            schema.messages.idempotencyKey,
            `research.status.message:${researchRunId}`,
          ),
        );
    }
    if (researchRunIds.length > 0) {
      await db
        .delete(schema.researchRuns)
        .where(
          and(
            eq(schema.researchRuns.organisationId, organisationId),
            inArray(schema.researchRuns.id, researchRunIds),
          ),
        );
    }
    for (const agentRunId of agentRunIds) {
      await db
        .delete(schema.agentRuns)
        .where(
          and(
            eq(schema.agentRuns.organisationId, organisationId),
            eq(schema.agentRuns.id, agentRunId),
          ),
        );
    }
    for (const watchlistId of watchlistIds) {
      await db
        .delete(schema.researchWatchlists)
        .where(
          and(
            eq(schema.researchWatchlists.organisationId, organisationId),
            eq(schema.researchWatchlists.id, watchlistId),
          ),
        );
    }
    await closeDatabase();
  });
});
