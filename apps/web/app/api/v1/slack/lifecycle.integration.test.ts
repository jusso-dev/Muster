import { createHash, createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  decryptConnectorPayload,
  processSlackNotificationJob,
  requiredSlackBotScopes,
  SlackGovernanceAdapter,
} from "@muster/agent-harness";
import { FakeSlackServer } from "@muster/agent-harness/testing/fake-slack-server";
import {
  closeDatabase,
  database,
  markOutboxDispatched,
  schema,
  writeOutbox,
} from "@muster/database";
import { and, eq, inArray, like } from "drizzle-orm";
import { POST as commandRoute } from "./commands/route";
import { POST as eventRoute } from "./events/route";
import { POST as interactionRoute } from "./interactions/route";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

class SlackIngressServer {
  private server: Server | undefined;
  private origin: string | undefined;

  async start() {
    this.server = createServer(async (request, response) => {
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8")),
        );
        request.on("error", reject);
      });
      if (
        request.url !== "/api/v1/slack/events" &&
        request.url !== "/api/v1/slack/commands" &&
        request.url !== "/api/v1/slack/interactions"
      ) {
        response.writeHead(404).end();
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) headers.append(name, item);
        } else if (value !== undefined) {
          headers.set(name, value);
        }
      }
      const routedRequest = new Request(
        `http://muster.synthetic${request.url}`,
        {
          method: "POST",
          headers,
          body,
        },
      );
      const routed =
        request.url === "/api/v1/slack/events"
          ? await eventRoute(routedRequest)
          : request.url === "/api/v1/slack/commands"
            ? await commandRoute(routedRequest)
            : await interactionRoute(routedRequest);
      response.statusCode = routed.status;
      routed.headers.forEach((value, name) => response.setHeader(name, value));
      response.end(await routed.text());
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Synthetic Muster ingress did not bind an HTTP port");
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async stop() {
    const server = this.server;
    this.server = undefined;
    this.origin = undefined;
    if (!server) return;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  async signedPost(path: string, body: string, contentType: string) {
    if (!this.origin)
      throw new Error("Synthetic Muster ingress is not running");
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = `v0=${createHmac(
      "sha256",
      process.env.SLACK_SIGNING_SECRET!,
    )
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`;
    return fetch(`${this.origin}${path}`, {
      method: "POST",
      headers: {
        "content-type": contentType,
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      body,
    });
  }
}

describeIntegration("hermetic Slack HTTP lifecycle", () => {
  const db = database();
  const suffix = crypto.randomUUID();
  const teamId = `T-e2e-${suffix}`;
  const slackUserId = `U-e2e-${suffix}`;
  const botUserId = `B-e2e-${suffix}`;
  const channelId = `C-e2e-${suffix}`;
  const fakeSlack = new FakeSlackServer({
    teamId,
    teamName: "Synthetic E2E Slack",
    botUserId,
    requiredScopes: requiredSlackBotScopes,
  });
  const ingress = new SlackIngressServer();
  const originalEnvironment = {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    connectorKey: process.env.CONNECTOR_ENCRYPTION_KEY,
    apiBaseUrl: process.env.MUSTER_TEST_SLACK_API_BASE_URL,
  };
  let organisationId = "";
  let actorId = "";
  let agentId = "";
  let agentName = "";
  let installationId = "";

  beforeAll(async () => {
    process.env.SLACK_CLIENT_ID = "synthetic-client";
    process.env.SLACK_CLIENT_SECRET = "synthetic-client-secret";
    process.env.SLACK_SIGNING_SECRET = "synthetic-signing-secret";
    process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString(
      "base64",
    );
    process.env.MUSTER_TEST_SLACK_API_BASE_URL = await fakeSlack.start();
    await ingress.start();

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
        candidate.capabilities.includes("administration.manage") &&
        candidate.capabilities.includes("agents.invoke"),
    );
    if (!actor)
      throw new Error("Bootstrap a synthetic Muster administrator first");
    actorId = actor.id;
    organisationId = actor.organisationId;
    const [agent] = await db
      .select({
        id: schema.agentDefinitions.id,
        name: schema.agentDefinitions.name,
      })
      .from(schema.agentDefinitions)
      .where(
        and(
          eq(schema.agentDefinitions.organisationId, organisationId),
          eq(schema.agentDefinitions.status, "active"),
          eq(schema.agentDefinitions.killSwitch, false),
        ),
      )
      .limit(1);
    if (!agent) throw new Error("Bootstrap a synthetic active agent first");
    agentId = agent.id;
    agentName = agent.name;
  });

  afterAll(async () => {
    await ingress.stop();
    await fakeSlack.stop();
    if (agentId)
      await db
        .update(schema.agentDefinitions)
        .set({ killSwitch: false })
        .where(eq(schema.agentDefinitions.id, agentId));
    if (installationId) {
      const runs = await db
        .select({ id: schema.agentRuns.id })
        .from(schema.agentRuns)
        .where(
          like(schema.agentRuns.idempotencyKey, `slack:${installationId}:%`),
        );
      const runIds = runs.map((run) => run.id);
      const inbox = await db
        .select({ id: schema.slackInboxEvents.id })
        .from(schema.slackInboxEvents)
        .where(eq(schema.slackInboxEvents.installationId, installationId));
      const aggregateIds = [...runIds, ...inbox.map((event) => event.id)];
      if (aggregateIds.length)
        await db
          .delete(schema.outboxEvents)
          .where(inArray(schema.outboxEvents.aggregateId, aggregateIds));
      await db
        .delete(schema.slackRunDeliveries)
        .where(eq(schema.slackRunDeliveries.installationId, installationId));
      await db
        .delete(schema.slackInboxEvents)
        .where(eq(schema.slackInboxEvents.installationId, installationId));
      if (runIds.length) {
        await db
          .delete(schema.agentRunEvents)
          .where(inArray(schema.agentRunEvents.runId, runIds));
        await db
          .delete(schema.agentRuns)
          .where(inArray(schema.agentRuns.id, runIds));
      }
      await db
        .delete(schema.slackAgentExposures)
        .where(eq(schema.slackAgentExposures.installationId, installationId));
      await db
        .delete(schema.slackIdentityMappings)
        .where(eq(schema.slackIdentityMappings.installationId, installationId));
      await db
        .delete(schema.slackInstallations)
        .where(eq(schema.slackInstallations.id, installationId));
    }
    await closeDatabase();
    for (const [name, value] of Object.entries({
      SLACK_CLIENT_ID: originalEnvironment.clientId,
      SLACK_CLIENT_SECRET: originalEnvironment.clientSecret,
      SLACK_SIGNING_SECRET: originalEnvironment.signingSecret,
      CONNECTOR_ENCRYPTION_KEY: originalEnvironment.connectorKey,
      MUSTER_TEST_SLACK_API_BASE_URL: originalEnvironment.apiBaseUrl,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("runs OAuth, signed ingress, worker delivery, replay, throttling, and revocation over HTTP", async () => {
    const adapter = new SlackGovernanceAdapter(db);
    const administrator = {
      actorId,
      organisationId,
      capabilities: new Set([
        "administration.manage",
        "agents.invoke",
      ] as const),
    };
    await expect(
      adapter.install(
        administrator,
        "missing-scopes",
        "http://muster.synthetic/api/v1/slack/oauth/callback",
      ),
    ).rejects.toThrow("missing required bot scopes: commands");
    expect(fakeSlack.requestsFor("oauth.v2.access")).toHaveLength(1);

    const installation = await adapter.install(
      administrator,
      "valid-install",
      "http://muster.synthetic/api/v1/slack/oauth/callback",
    );
    installationId = installation.id;
    expect(installation.scopes).toEqual(
      expect.arrayContaining([...requiredSlackBotScopes]),
    );
    await adapter.mapIdentity(administrator, {
      installationId,
      slackUserId,
      actorId,
    });
    await adapter.configureExposure(administrator, {
      installationId,
      agentId,
      enabled: true,
      isDefault: true,
      allowedChannelIds: [channelId],
    });

    const verificationBody = JSON.stringify({
      type: "url_verification",
      challenge: "synthetic-challenge",
    });
    const verification = await ingress.signedPost(
      "/api/v1/slack/events",
      verificationBody,
      "application/json",
    );
    await expect(verification.json()).resolves.toEqual({
      challenge: "synthetic-challenge",
    });

    const mentionEventId = `Ev-mention-${suffix}`;
    const mentionBody = JSON.stringify({
      type: "event_callback",
      team_id: teamId,
      event_id: mentionEventId,
      event: {
        type: "app_mention",
        user: slackUserId,
        channel: channelId,
        ts: "1710000000.000100",
        text: "Run the bounded synthetic review",
      },
    });
    expect(
      (
        await ingress.signedPost(
          "/api/v1/slack/events",
          mentionBody,
          "application/json",
        )
      ).status,
    ).toBe(200);
    await ingress.stop();
    await ingress.start();
    expect(
      (
        await ingress.signedPost(
          "/api/v1/slack/events",
          mentionBody,
          "application/json",
        )
      ).status,
    ).toBe(200);

    const mentionInboxes = await db
      .select()
      .from(schema.slackInboxEvents)
      .where(
        and(
          eq(schema.slackInboxEvents.installationId, installationId),
          eq(schema.slackInboxEvents.eventId, mentionEventId),
        ),
      );
    expect(mentionInboxes).toHaveLength(1);
    const mentionInbox = mentionInboxes[0]!;
    const mentionOutbox = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.aggregateId, mentionInbox.id));
    expect(mentionOutbox).toHaveLength(1);
    expect(mentionOutbox[0]?.eventType).toBe("slack.event.received");
    await markOutboxDispatched(db, mentionOutbox[0]!.id);
    expect(
      await processSlackNotificationJob(
        "slack.event.received",
        mentionInbox.id,
      ),
    ).toBe(true);
    expect(fakeSlack.requestsFor("chat.postMessage")).toHaveLength(1);

    const slashTriggerId = `trigger-${suffix}`;
    const slashBody = new URLSearchParams({
      team_id: teamId,
      user_id: slackUserId,
      channel_id: channelId,
      channel_name: "synthetic",
      trigger_id: slashTriggerId,
      text: agentName,
    }).toString();
    expect(
      (
        await ingress.signedPost(
          "/api/v1/slack/commands",
          slashBody,
          "application/x-www-form-urlencoded",
        )
      ).status,
    ).toBe(200);
    const [slashInbox] = await db
      .select()
      .from(schema.slackInboxEvents)
      .where(eq(schema.slackInboxEvents.eventId, slashTriggerId));
    await processSlackNotificationJob("slack.event.received", slashInbox!.id);
    const [processedSlash] = await db
      .select({
        status: schema.slackInboxEvents.status,
        error: schema.slackInboxEvents.error,
      })
      .from(schema.slackInboxEvents)
      .where(eq(schema.slackInboxEvents.id, slashInbox!.id));
    expect(processedSlash).toEqual({ status: "processed", error: null });

    const shortcutPayload = {
      type: "message_action",
      callback_id: "muster.review",
      team: { id: teamId },
      user: { id: slackUserId },
      channel: { id: channelId },
      message: {
        ts: "1710000001.000100",
        text: "Treat this synthetic message as bounded evidence only",
      },
    };
    const shortcutBody = new URLSearchParams({
      payload: JSON.stringify(shortcutPayload),
    }).toString();
    expect(
      (
        await ingress.signedPost(
          "/api/v1/slack/interactions",
          shortcutBody,
          "application/x-www-form-urlencoded",
        )
      ).status,
    ).toBe(200);
    const shortcutEventId = createHash("sha256")
      .update(shortcutBody)
      .digest("hex");
    const [shortcutInbox] = await db
      .select()
      .from(schema.slackInboxEvents)
      .where(eq(schema.slackInboxEvents.eventId, shortcutEventId));
    await processSlackNotificationJob(
      "slack.event.received",
      shortcutInbox!.id,
    );
    const [processedShortcut] = await db
      .select({
        status: schema.slackInboxEvents.status,
        error: schema.slackInboxEvents.error,
      })
      .from(schema.slackInboxEvents)
      .where(eq(schema.slackInboxEvents.id, shortcutInbox!.id));
    expect(processedShortcut).toEqual({ status: "processed", error: null });
    expect(fakeSlack.requestsFor("chat.postMessage")).toHaveLength(3);

    const mentionRuns = await db
      .select()
      .from(schema.agentRuns)
      .where(
        eq(
          schema.agentRuns.idempotencyKey,
          `slack:${installationId}:${mentionEventId}`,
        ),
      );
    expect(mentionRuns).toHaveLength(1);
    const mentionRun = mentionRuns[0]!;
    const firstCiphertext = installation.encryptedBotToken;
    const rotated = await adapter.install(
      administrator,
      "rotate-install",
      "http://muster.synthetic/api/v1/slack/oauth/callback",
    );
    expect(rotated.id).toBe(installationId);
    expect(rotated.encryptedBotToken).not.toBe(firstCiphertext);
    const rotatedToken = (
      decryptConnectorPayload(
        rotated.encryptedBotToken,
        process.env.CONNECTOR_ENCRYPTION_KEY!,
      ) as { token: string }
    ).token;

    await db.transaction(async (tx) => {
      await tx
        .update(schema.agentRuns)
        .set({
          status: "completed",
          progress: { stage: "completed", percent: 100 },
          structuredOutput: {
            summary: "Hermetic Slack lifecycle completed",
            confidence: 1,
            gaps: [],
          },
        })
        .where(eq(schema.agentRuns.id, mentionRun.id));
      await writeOutbox(tx, {
        organisationId,
        eventType: "agent.run.settled",
        aggregateType: "agent_run",
        aggregateId: mentionRun.id,
        queueName: "muster-notifications",
        payload: { runId: mentionRun.id },
        idempotencyKey: `synthetic.slack.settled:${mentionRun.id}`,
        traceId: mentionEventId,
      });
    });
    const settledOutbox = await db
      .select()
      .from(schema.outboxEvents)
      .where(
        eq(
          schema.outboxEvents.idempotencyKey,
          `synthetic.slack.settled:${mentionRun.id}`,
        ),
      );
    expect(settledOutbox).toHaveLength(1);
    await markOutboxDispatched(db, settledOutbox[0]!.id);
    fakeSlack.rateLimitOnce("chat.update");
    await processSlackNotificationJob("agent.run.settled", mentionRun.id);
    expect(fakeSlack.requestsFor("chat.update")).toHaveLength(2);
    expect(fakeSlack.requestsFor("chat.update").at(-1)?.authorization).toBe(
      `Bearer ${rotatedToken}`,
    );
    const [deliveredMention] = await db
      .select({
        status: schema.slackRunDeliveries.status,
        attemptCount: schema.slackRunDeliveries.attemptCount,
      })
      .from(schema.slackRunDeliveries)
      .where(eq(schema.slackRunDeliveries.runId, mentionRun.id));
    expect(deliveredMention).toEqual({
      status: "delivered",
      attemptCount: 0,
    });

    const callsBeforeKillSwitch = fakeSlack.requests.length;
    await db
      .update(schema.agentDefinitions)
      .set({ killSwitch: true })
      .where(eq(schema.agentDefinitions.id, agentId));
    const killedEventId = `Ev-killed-${suffix}`;
    const killedBody = JSON.stringify({
      type: "event_callback",
      team_id: teamId,
      event_id: killedEventId,
      event: {
        type: "app_mention",
        user: slackUserId,
        channel: channelId,
        text: "This must remain blocked",
      },
    });
    await ingress.signedPost(
      "/api/v1/slack/events",
      killedBody,
      "application/json",
    );
    const [killedInbox] = await db
      .select()
      .from(schema.slackInboxEvents)
      .where(eq(schema.slackInboxEvents.eventId, killedEventId));
    await processSlackNotificationJob("slack.event.received", killedInbox!.id);
    expect(fakeSlack.requests).toHaveLength(callsBeforeKillSwitch);
    const [processedKilled] = await db
      .select({
        status: schema.slackInboxEvents.status,
        error: schema.slackInboxEvents.error,
      })
      .from(schema.slackInboxEvents)
      .where(eq(schema.slackInboxEvents.id, killedInbox!.id));
    expect(processedKilled).toEqual({
      status: "ignored",
      error: "agent_not_exposed",
    });
    await db
      .update(schema.agentDefinitions)
      .set({ killSwitch: false })
      .where(eq(schema.agentDefinitions.id, agentId));

    const revokedBody = JSON.stringify({
      type: "event_callback",
      team_id: teamId,
      event_id: `Ev-tokens-revoked-${suffix}`,
      event: {
        type: "tokens_revoked",
        tokens: { oauth: [], bot: [botUserId] },
      },
    });
    await ingress.signedPost(
      "/api/v1/slack/events",
      revokedBody,
      "application/json",
    );
    const [revokedInbox] = await db
      .select()
      .from(schema.slackInboxEvents)
      .where(
        eq(schema.slackInboxEvents.eventId, `Ev-tokens-revoked-${suffix}`),
      );
    await processSlackNotificationJob("slack.event.received", revokedInbox!.id);
    const callsBeforeBlockedDelivery = fakeSlack.requests.length;
    const [shortcutRun] = await db
      .select()
      .from(schema.agentRuns)
      .where(
        eq(
          schema.agentRuns.idempotencyKey,
          `slack:${installationId}:${shortcutEventId}`,
        ),
      );
    await db
      .update(schema.agentRuns)
      .set({ status: "completed" })
      .where(eq(schema.agentRuns.id, shortcutRun!.id));
    await processSlackNotificationJob("agent.run.settled", shortcutRun!.id);
    expect(fakeSlack.requests).toHaveLength(callsBeforeBlockedDelivery);
    const [blockedShortcutDelivery] = await db
      .select({ status: schema.slackRunDeliveries.status })
      .from(schema.slackRunDeliveries)
      .where(eq(schema.slackRunDeliveries.runId, shortcutRun!.id));
    expect(blockedShortcutDelivery?.status).toBe("blocked");

    await adapter.install(
      administrator,
      "reinstall-after-revoke",
      "http://muster.synthetic/api/v1/slack/oauth/callback",
    );
    const uninstallBody = JSON.stringify({
      type: "event_callback",
      team_id: teamId,
      event_id: `Ev-app-uninstalled-${suffix}`,
      event: { type: "app_uninstalled" },
    });
    await ingress.signedPost(
      "/api/v1/slack/events",
      uninstallBody,
      "application/json",
    );
    const [uninstallInbox] = await db
      .select()
      .from(schema.slackInboxEvents)
      .where(
        eq(schema.slackInboxEvents.eventId, `Ev-app-uninstalled-${suffix}`),
      );
    await processSlackNotificationJob(
      "slack.event.received",
      uninstallInbox!.id,
    );
    const [finalInstallation] = await db
      .select({
        status: schema.slackInstallations.status,
        encryptedBotToken: schema.slackInstallations.encryptedBotToken,
      })
      .from(schema.slackInstallations)
      .where(eq(schema.slackInstallations.id, installationId));
    expect(finalInstallation?.status).toBe("revoked");
    expect(
      decryptConnectorPayload(
        finalInstallation!.encryptedBotToken,
        process.env.CONNECTOR_ENCRYPTION_KEY!,
      ),
    ).toEqual({ revoked: true });
    const [slashRun] = await db
      .select()
      .from(schema.agentRuns)
      .where(
        eq(
          schema.agentRuns.idempotencyKey,
          `slack:${installationId}:${slashTriggerId}`,
        ),
      );
    const callsBeforeUninstalledDelivery = fakeSlack.requests.length;
    await db
      .update(schema.agentRuns)
      .set({ status: "completed" })
      .where(eq(schema.agentRuns.id, slashRun!.id));
    await processSlackNotificationJob("agent.run.settled", slashRun!.id);
    expect(fakeSlack.requests).toHaveLength(callsBeforeUninstalledDelivery);
    const [blockedSlashDelivery] = await db
      .select({ status: schema.slackRunDeliveries.status })
      .from(schema.slackRunDeliveries)
      .where(eq(schema.slackRunDeliveries.runId, slashRun!.id));
    expect(blockedSlashDelivery?.status).toBe("blocked");
    const inboxCountBefore = await db
      .select({ id: schema.slackInboxEvents.id })
      .from(schema.slackInboxEvents)
      .where(eq(schema.slackInboxEvents.installationId, installationId));
    await ingress.signedPost(
      "/api/v1/slack/events",
      JSON.stringify({
        type: "event_callback",
        team_id: teamId,
        event_id: `Ev-after-uninstall-${suffix}`,
        event: {
          type: "app_mention",
          user: slackUserId,
          channel: channelId,
          text: "Must not enter the durable inbox",
        },
      }),
      "application/json",
    );
    const inboxCountAfter = await db
      .select({ id: schema.slackInboxEvents.id })
      .from(schema.slackInboxEvents)
      .where(eq(schema.slackInboxEvents.installationId, installationId));
    expect(inboxCountAfter).toHaveLength(inboxCountBefore.length);
  }, 30_000);
});
