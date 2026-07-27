import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  deliverSlackRun,
  encryptConnectorPayload,
  processSlackInboxEvent,
  SlackGovernanceAdapter,
} from "./index";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("synthetic Slack governed-agent delivery", () => {
  const db = database();
  const suffix = newId();
  const eventId = `Ev-synthetic-${suffix}`;
  const teamId = `T-synthetic-${suffix}`;
  const slackUserId = `U-synthetic-${suffix}`;
  let organisationId = "";
  let actorId = "";
  let agentId = "";
  let installationId = "";
  let runId = "";
  let approvalId = "";
  const posted: Array<{ method: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64");
    const actors = await db
      .select({
        id: schema.actors.id,
        organisationId: schema.actors.organisationId,
        capabilities: schema.actors.capabilityAssignments,
      })
      .from(schema.actors)
      .where(eq(schema.actors.actorType, "human"));
    const actor = actors.find(
      (candidate) =>
        Array.isArray(candidate.capabilities) &&
        candidate.capabilities.includes("agents.invoke") &&
        candidate.capabilities.includes("agents.cancel") &&
        candidate.capabilities.includes("workflows.approve"),
    );
    if (!actor) throw new Error("Bootstrap a synthetic Muster workspace before integration tests");
    organisationId = actor.organisationId;
    actorId = actor.id;
    const [agent] = await db
      .select({ id: schema.agentDefinitions.id })
      .from(schema.agentDefinitions)
      .where(
        and(
          eq(schema.agentDefinitions.organisationId, organisationId),
          eq(schema.agentDefinitions.status, "active"),
          eq(schema.agentDefinitions.killSwitch, false),
        ),
      )
      .limit(1);
    if (!agent) throw new Error("Bootstrap an active synthetic agent before integration tests");
    agentId = agent.id;
    installationId = newId();
    await db.insert(schema.slackInstallations).values({
      id: installationId,
      organisationId,
      teamId,
      teamName: "Synthetic Slack",
      encryptedBotToken: encryptConnectorPayload(
        { token: "xoxb-synthetic" },
        process.env.CONNECTOR_ENCRYPTION_KEY,
      ),
      installedByActorId: actorId,
    });
    await db.insert(schema.slackIdentityMappings).values({
      id: newId(),
      organisationId,
      installationId,
      slackUserId,
      actorId,
      createdByActorId: actorId,
    });
    await db.insert(schema.slackAgentExposures).values({
      id: newId(),
      organisationId,
      installationId,
      agentId,
      isDefault: true,
      allowedChannelIds: ["C-synthetic"],
      allowDirectMessages: true,
      allowThreadContext: true,
      updatedByActorId: actorId,
    });
    approvalId = newId();
    await db.insert(schema.approvals).values({
      id: approvalId,
      organisationId,
      requestingActorId: actorId,
      actionType: "synthetic.slack.review",
      target: { synthetic: true },
      riskSummary: "Synthetic Slack approval review fixture",
      expiresAt: new Date(Date.now() + 60_000),
      requiredCapability: "workflows.approve",
      idempotencyKey: `synthetic-slack-approval:${suffix}`,
    });
    globalThis.fetch = vi.fn(async (input, init) => {
      const method = new URL(String(input)).pathname.split("/").pop() ?? "unknown";
      posted.push({
        method,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return Response.json({ ok: true, ts: `1710000000.${posted.length}` });
    }) as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    const runs = await db
      .select({ id: schema.agentRuns.id })
      .from(schema.agentRuns)
      .where(like(schema.agentRuns.idempotencyKey, `slack:${installationId}:%`));
    const runIds = runs.map((run) => run.id);
    await db.delete(schema.slackRunDeliveries).where(eq(schema.slackRunDeliveries.installationId, installationId));
    await db.delete(schema.slackInboxEvents).where(eq(schema.slackInboxEvents.installationId, installationId));
    if (runIds.length) {
      await db.delete(schema.agentRunEvents).where(inArray(schema.agentRunEvents.runId, runIds));
      await db.delete(schema.agentRuns).where(inArray(schema.agentRuns.id, runIds));
    }
    await db.delete(schema.slackAgentExposures).where(eq(schema.slackAgentExposures.installationId, installationId));
    await db.delete(schema.slackIdentityMappings).where(eq(schema.slackIdentityMappings.installationId, installationId));
    await db.delete(schema.slackInstallations).where(eq(schema.slackInstallations.id, installationId));
    await db.delete(schema.approvals).where(eq(schema.approvals.id, approvalId));
    await closeDatabase();
  });

  it("persists a signed event once, invokes once, and updates bounded progress then terminal result", async () => {
    const adapter = new SlackGovernanceAdapter(db);
    const payload = {
      type: "event_callback",
      team_id: teamId,
      event_id: eventId,
      event: {
        type: "app_mention",
        user: slackUserId,
        channel: "C-synthetic",
        ts: "1710000000.000100",
        text: "use default synthetic agent",
      },
    };
    const raw = JSON.stringify(payload);
    const first = await adapter.recordEvent(raw, payload);
    const replay = await adapter.recordEvent(raw, payload);
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(first.inboxEvent?.id).toBeTruthy();

    await processSlackInboxEvent(first.inboxEvent!.id);
    await processSlackInboxEvent(first.inboxEvent!.id);
    const [run] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.idempotencyKey, `slack:${installationId}:${eventId}`))
      .limit(1);
    expect(run).toBeTruthy();
    runId = run!.id;
    expect(posted.filter((call) => call.method === "chat.postMessage")).toHaveLength(1);

    await db
      .update(schema.agentRuns)
      .set({ status: "running", progress: { stage: "executing", percent: 50 } })
      .where(eq(schema.agentRuns.id, runId));
    await deliverSlackRun(runId);
    await db
      .update(schema.agentRuns)
      .set({
        status: "completed",
        progress: { stage: "completed", percent: 100 },
        structuredOutput: {
          summary: "Synthetic typed completion",
          confidence: 0.9,
          gaps: ["Synthetic fixture only"],
          approvalId,
        },
      })
      .where(eq(schema.agentRuns.id, runId));
    await deliverSlackRun(runId);
    const updates = posted.filter((call) => call.method === "chat.update");
    expect(updates).toHaveLength(2);
    expect(JSON.stringify(updates.at(-1)?.body.blocks)).toContain("Synthetic typed completion");
    await deliverSlackRun(runId);
    expect(posted.filter((call) => call.method === "chat.update")).toHaveLength(2);
  });

  it("handles cancel/retry actions and Assistant lifecycle out of order without leaking tenants", async () => {
    const adapter = new SlackGovernanceAdapter(db);
    const cancelPayload = {
      type: "block_actions",
      team: { id: teamId },
      user: { id: slackUserId },
      channel: { id: "C-synthetic" },
      message: { ts: "1710000000.000100" },
      actions: [{ action_id: "muster.cancel", value: runId }],
    };
    const cancel = await adapter.recordEvent(JSON.stringify(cancelPayload), cancelPayload);
    await processSlackInboxEvent(cancel.inboxEvent!.id);
    expect(posted.some((call) => call.method === "cancel")).toBe(true);

    const approvalPayload = {
      ...cancelPayload,
      actions: [{ action_id: "muster.approval.view", value: approvalId }],
    };
    const approval = await adapter.recordEvent(
      `${JSON.stringify(approvalPayload)}-approval`,
      approvalPayload,
    );
    await processSlackInboxEvent(approval.inboxEvent!.id);
    const [approvalInbox] = await db
      .select({ status: schema.slackInboxEvents.status })
      .from(schema.slackInboxEvents)
      .where(eq(schema.slackInboxEvents.id, approval.inboxEvent!.id));
    expect(approvalInbox?.status).toBe("processed");

    const retryPayload = {
      ...cancelPayload,
      actions: [{ action_id: "muster.retry", value: runId }],
    };
    const retry = await adapter.recordEvent(`${JSON.stringify(retryPayload)}-retry`, retryPayload);
    await processSlackInboxEvent(retry.inboxEvent!.id);
    const retryRuns = await db
      .select({ id: schema.agentRuns.id })
      .from(schema.agentRuns)
      .where(like(schema.agentRuns.idempotencyKey, `slack:${installationId}:%:retry`));
    expect(retryRuns).toHaveLength(1);

    const assistantPayload = {
      type: "event_callback",
      team_id: teamId,
      event_id: `Ev-assistant-${suffix}`,
      event: {
        type: "assistant_thread_started",
        assistant_thread: {
          user_id: slackUserId,
          channel_id: "D-synthetic",
          thread_ts: "1710000001.000100",
          context: { channel_id: "C-synthetic", team_id: teamId },
        },
      },
    };
    const assistant = await adapter.recordEvent(JSON.stringify(assistantPayload), assistantPayload);
    await processSlackInboxEvent(assistant.inboxEvent!.id);
    expect(posted.some((call) => call.method === "assistant.threads.setStatus")).toBe(true);
  });
});
