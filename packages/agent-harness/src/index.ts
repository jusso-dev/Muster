import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { redactObservationText } from "@muster/config";
import {
  AgentHarnessInvokeSchema,
  AgentHarnessManifestSchema,
  AgentHarnessRunSchema,
  type AgentHarnessInvoke,
  type AgentHarnessInvocationMode,
  type AgentHarnessManifest,
  type AgentHarnessRun,
} from "@muster/contracts";
import {
  type AuthorisationSubject,
  capabilities,
  requireCapability,
  type Capability,
} from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import {
  decryptConnectorPayload,
  encryptConnectorPayload,
} from "@muster/integrations";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const protocolVersion = "muster.agent-harness/v1" as const;
const supportedModes: AgentHarnessInvocationMode[] = [
  "slack",
  "hermes",
  "mcp",
  "cli",
  "http",
];

function asCapabilities(value: unknown): Capability[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Capability =>
      typeof item === "string" && capabilities.includes(item as Capability),
  );
}

function agentRequirements(value: unknown): Capability[] {
  return asCapabilities(value);
}

function encryptionKey() {
  const key = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!key) throw new Error("Connector encryption is not configured");
  return key;
}

function traceId(value: string | undefined) {
  return redactObservationText(value ?? crypto.randomUUID(), {
    maxStringLength: 160,
  });
}

export class GovernedAgentHarness {
  constructor(private readonly db = database()) {}

  async manifest(subject: AuthorisationSubject): Promise<AgentHarnessManifest[]> {
    requireCapability(subject, "agents.read");
    const definitions = await this.db
      .select()
      .from(schema.agentDefinitions)
      .where(
        and(
          eq(schema.agentDefinitions.organisationId, subject.organisationId),
          eq(schema.agentDefinitions.status, "active"),
          eq(schema.agentDefinitions.killSwitch, false),
        ),
      );
    return definitions
      .filter((definition) =>
        agentRequirements(definition.capabilityRequirements).every((capability) =>
          subject.capabilities.has(capability),
        ),
      )
      .map((definition) =>
        AgentHarnessManifestSchema.parse({
          protocolVersion,
          key: definition.name,
          version: definition.systemPromptVersion,
          name: definition.name,
          description: definition.description,
          invocationModes: supportedModes,
          inputSchema: "muster.agent-harness.input/v1",
          outputSchema: "muster.agent.structured/v1",
          requiredCapabilities: agentRequirements(
            definition.capabilityRequirements,
          ),
          approvalBehavior:
            definition.requestedPermissionMode === "approval_gated"
              ? "governed_actions"
              : "none",
          lifecycle: "active",
        }),
      );
  }

  async invoke(
    subject: AuthorisationSubject,
    rawInput: AgentHarnessInvoke,
    idempotencyKey: string,
  ): Promise<AgentHarnessRun> {
    requireCapability(subject, "agents.invoke");
    const input = AgentHarnessInvokeSchema.parse(rawInput);
    const correlationId = traceId(input.correlationId);
    const [definition] = await this.db
      .select()
      .from(schema.agentDefinitions)
      .where(
        and(
          eq(schema.agentDefinitions.organisationId, subject.organisationId),
          eq(schema.agentDefinitions.name, input.agentKey),
          eq(schema.agentDefinitions.status, "active"),
          eq(schema.agentDefinitions.killSwitch, false),
        ),
      )
      .limit(1);
    if (!definition) throw new Error("Active agent is not exposed");
    for (const capability of agentRequirements(
      definition.capabilityRequirements,
    ))
      requireCapability(subject, capability);
    if (input.input.roomId) {
      const [membership] = await this.db
        .select({ roomId: schema.roomMemberships.roomId })
        .from(schema.roomMemberships)
        .innerJoin(
          schema.rooms,
          and(
            eq(schema.rooms.id, schema.roomMemberships.roomId),
            eq(schema.rooms.organisationId, subject.organisationId),
          ),
        )
        .where(
          and(
            eq(schema.roomMemberships.roomId, input.input.roomId),
            eq(schema.roomMemberships.actorId, subject.actorId),
          ),
        )
        .limit(1);
      if (!membership) throw new Error("Room membership required");
    }
    if (input.input.investigationId) {
      const [investigation] = await this.db
        .select({ id: schema.investigations.id })
        .from(schema.investigations)
        .where(
          and(
            eq(schema.investigations.id, input.input.investigationId),
            eq(schema.investigations.organisationId, subject.organisationId),
          ),
        )
        .limit(1);
      if (!investigation) throw new Error("Investigation not found");
    }
    const prompt = redactObservationText(input.input.prompt, {
      maxStringLength: 4_000,
    });
    const inputHash = createHash("sha256").update(prompt).digest("hex");
    const deadlineAt = new Date(
      Date.now() + definition.maximumRuntimeSeconds * 1_000,
    );
    const accepted = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(schema.agentRuns)
        .values({
          id: newId(),
          agentId: definition.id,
          organisationId: subject.organisationId,
          roomId: input.input.roomId,
          investigationId: input.input.investigationId,
          requestedByActorId: subject.actorId,
          trigger: `harness:${input.mode}`,
          status: "queued",
          request: {
            humanRequest: prompt,
            traceId: correlationId,
            harness: {
              protocolVersion,
              mode: input.mode,
              taskId: input.input.taskId,
              caseId: input.input.caseId,
            },
          },
          progress: { stage: "queued", percent: 0 },
          deadlineAt,
          inputHash,
          promptVersion: definition.systemPromptVersion,
          runtime: definition.runtime,
          model: definition.model,
          maximumRuntimeSeconds: definition.maximumRuntimeSeconds,
          maximumTokenBudget: definition.maximumTokenBudget,
          maximumCostCents: definition.maximumCostCents,
          idempotencyKey,
        })
        .onConflictDoNothing()
        .returning();
      const run =
        inserted ??
        (
          await tx
            .select()
            .from(schema.agentRuns)
            .where(
              and(
                eq(schema.agentRuns.organisationId, subject.organisationId),
                eq(schema.agentRuns.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1)
        )[0];
      if (!run) throw new Error("Could not accept harness invocation");
      if (inserted) {
        await tx.insert(schema.agentRunEvents).values({
          id: newId(),
          organisationId: subject.organisationId,
          runId: run.id,
          eventType: "queued",
          message: "Portable governed harness invocation accepted",
          payload: { mode: input.mode, correlationId },
        });
        await writeOutbox(tx, {
          organisationId: subject.organisationId,
          eventType: "agent.run.queued",
          aggregateType: "agent_run",
          aggregateId: run.id,
          queueName: "muster-agents",
          payload: { runId: run.id },
          idempotencyKey: `agent.run.queued:${run.id}`,
          traceId: correlationId,
        });
        await appendAuditEvent(tx, {
          organisationId: subject.organisationId,
          actorId: subject.actorId,
          actorType: "human",
          action: "agent.harness.invoked",
          targetType: "agent_run",
          targetId: run.id,
          metadata: {
            agentKey: definition.name,
            mode: input.mode,
            inputHash,
            idempotencyKey,
          },
          traceId: correlationId,
        });
      }
      return { run, duplicate: !inserted };
    });
    return AgentHarnessRunSchema.parse({
      protocolVersion,
      runId: accepted.run.id,
      status: accepted.run.status,
      agentKey: definition.name,
      correlationId,
      duplicate: accepted.duplicate,
      result: accepted.run.structuredOutput ?? null,
    });
  }

  async read(subject: AuthorisationSubject, runId: string): Promise<AgentHarnessRun> {
    requireCapability(subject, "agents.read");
    const [row] = await this.db
      .select({ run: schema.agentRuns, agentKey: schema.agentDefinitions.name })
      .from(schema.agentRuns)
      .innerJoin(
        schema.agentDefinitions,
        and(
          eq(schema.agentDefinitions.id, schema.agentRuns.agentId),
          eq(
            schema.agentDefinitions.organisationId,
            schema.agentRuns.organisationId,
          ),
        ),
      )
      .where(
        and(
          eq(schema.agentRuns.id, runId),
          eq(schema.agentRuns.organisationId, subject.organisationId),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Agent run not found");
    const request = row.run.request as { traceId?: unknown };
    return AgentHarnessRunSchema.parse({
      protocolVersion,
      runId: row.run.id,
      status: row.run.status,
      agentKey: row.agentKey,
      correlationId:
        typeof request.traceId === "string" ? request.traceId : row.run.id,
      duplicate: false,
      result: row.run.structuredOutput ?? null,
    });
  }
}

const SlackOAuthResponseSchema = z.object({
  ok: z.literal(true),
  access_token: z.string().min(1),
  app_id: z.string().optional(),
  bot_user_id: z.string().optional(),
  team: z.object({ id: z.string().min(1), name: z.string().optional() }),
  enterprise: z.object({ id: z.string().optional() }).optional(),
  scope: z.string().optional(),
});

export function verifySlackRequest(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  signingSecret: string,
  now = Date.now(),
) {
  if (!timestamp || !signature || !/^v0=[a-f0-9]{64}$/i.test(signature))
    return false;
  const age = Math.abs(now - Number(timestamp) * 1_000);
  if (!Number.isFinite(age) || age > 300_000) return false;
  const expected = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function signSlackOAuthState(input: {
  organisationId: string;
  actorId: string;
  expiresAt: number;
}) {
  const secret = process.env.SLACK_OAUTH_STATE_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Slack OAuth state secret is not configured");
  const payload = Buffer.from(JSON.stringify(input)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySlackOAuthState(value: string) {
  const [payload, signature] = value.split(".");
  const secret = process.env.SLACK_OAUTH_STATE_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!payload || !signature || !secret) throw new Error("Invalid Slack OAuth state");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (
    expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  )
    throw new Error("Invalid Slack OAuth state");
  const input = z
    .object({
      organisationId: z.string().uuid(),
      actorId: z.string().uuid(),
      expiresAt: z.number(),
    })
    .parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (input.expiresAt < Date.now()) throw new Error("Expired Slack OAuth state");
  return input;
}

export class SlackGovernanceAdapter {
  constructor(private readonly db = database()) {}

  async install(subject: AuthorisationSubject, code: string, redirectUri: string) {
    requireCapability(subject, "administration.manage");
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Slack OAuth is not configured");
    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = SlackOAuthResponseSchema.parse(await response.json());
    const scopes = payload.scope?.split(",").filter(Boolean) ?? [];
    const encryptedBotToken = encryptConnectorPayload(
      { token: payload.access_token },
      encryptionKey(),
    );
    return this.db.transaction(async (tx) => {
      const [installation] = await tx
        .insert(schema.slackInstallations)
        .values({
          id: newId(),
          organisationId: subject.organisationId,
          teamId: payload.team.id,
          teamName: payload.team.name,
          enterpriseId: payload.enterprise?.id,
          botUserId: payload.bot_user_id,
          scopes,
          encryptedBotToken,
          installedByActorId: subject.actorId,
          status: "active",
        })
        .onConflictDoUpdate({
          target: schema.slackInstallations.teamId,
          set: {
            organisationId: subject.organisationId,
            teamName: payload.team.name,
            enterpriseId: payload.enterprise?.id,
            botUserId: payload.bot_user_id,
            scopes,
            encryptedBotToken,
            installedByActorId: subject.actorId,
            status: "active",
            revokedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!installation) throw new Error("Slack installation was not persisted");
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "slack.installation.connected",
        targetType: "slack_installation",
        targetId: installation.id,
        metadata: { teamId: payload.team.id, scopes },
        traceId: crypto.randomUUID(),
      });
      return installation;
    });
  }

  async recordEvent(rawBody: string, payload: Record<string, unknown>) {
    const teamId =
      typeof payload.team_id === "string"
        ? payload.team_id
        : typeof payload.team === "object" && payload.team && "id" in payload.team
          ? String((payload.team as { id: unknown }).id)
          : undefined;
    if (!teamId) throw new Error("Slack workspace is missing");
    const [installation] = await this.db
      .select()
      .from(schema.slackInstallations)
      .where(
        and(
          eq(schema.slackInstallations.teamId, teamId),
          eq(schema.slackInstallations.status, "active"),
        ),
      )
      .limit(1);
    if (!installation) throw new Error("Slack workspace is not connected");
    const eventId =
      typeof payload.event_id === "string"
        ? payload.event_id
        : createHash("sha256").update(rawBody).digest("hex");
    const eventType =
      typeof payload.type === "string" ? payload.type : "event_callback";
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(schema.slackInboxEvents)
        .values({
          id: newId(),
          organisationId: installation.organisationId,
          installationId: installation.id,
          eventId,
          eventType,
          payloadHash,
          encryptedPayload: encryptConnectorPayload(payload, encryptionKey()),
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        await writeOutbox(tx, {
          organisationId: installation.organisationId,
          eventType: "slack.event.received",
          aggregateType: "slack_inbox_event",
          aggregateId: inserted.id,
          queueName: "muster-notifications",
          payload: { inboxEventId: inserted.id },
          idempotencyKey: `slack.event:${installation.id}:${eventId}`,
          traceId: eventId,
        });
      }
      return { installation, inboxEvent: inserted, duplicate: !inserted };
    });
  }

  /**
   * Socket Mode adapters call this after acknowledging Slack's envelope. The
   * same encrypted inbox and idempotency path is deliberately shared with HTTP
   * Events API delivery so a reconnect cannot invoke an agent twice.
   */
  async recordSocketEnvelope(envelope: {
    envelope_id: string;
    payload: Record<string, unknown>;
  }) {
    if (!envelope.envelope_id.trim()) throw new Error("Slack envelope is missing");
    return this.recordEvent(
      JSON.stringify({ envelope_id: envelope.envelope_id, payload: envelope.payload }),
      envelope.payload,
    );
  }

  async health(subject: AuthorisationSubject) {
    requireCapability(subject, "administration.manage");
    const installations = await this.db
      .select({
        id: schema.slackInstallations.id,
        teamId: schema.slackInstallations.teamId,
        teamName: schema.slackInstallations.teamName,
        scopes: schema.slackInstallations.scopes,
        status: schema.slackInstallations.status,
        lastHealthAt: schema.slackInstallations.lastHealthAt,
        lastDeliveryAt: schema.slackInstallations.lastDeliveryAt,
        lastError: schema.slackInstallations.lastError,
      })
      .from(schema.slackInstallations)
      .where(eq(schema.slackInstallations.organisationId, subject.organisationId));
    await Promise.all(
      installations
        .filter((installation) => installation.status === "active")
        .map(async (installation) => {
          try {
            const token = (decryptConnectorPayload(
              (
                await this.db
                  .select({ encryptedBotToken: schema.slackInstallations.encryptedBotToken })
                  .from(schema.slackInstallations)
                  .where(eq(schema.slackInstallations.id, installation.id))
                  .limit(1)
              )[0]?.encryptedBotToken ?? "",
              encryptionKey(),
            ) as { token: string }).token;
            await slackApi(token, "auth.test", {});
            await this.db
              .update(schema.slackInstallations)
              .set({ lastHealthAt: new Date(), lastError: null, updatedAt: new Date() })
              .where(eq(schema.slackInstallations.id, installation.id));
          } catch (error) {
            await this.db
              .update(schema.slackInstallations)
              .set({
                lastHealthAt: new Date(),
                lastError: redactObservationText(
                  error instanceof Error ? error.message : "Slack health check failed",
                ),
                updatedAt: new Date(),
              })
              .where(eq(schema.slackInstallations.id, installation.id));
          }
        }),
    );
    return this.db
      .select({
        id: schema.slackInstallations.id,
        teamId: schema.slackInstallations.teamId,
        teamName: schema.slackInstallations.teamName,
        scopes: schema.slackInstallations.scopes,
        status: schema.slackInstallations.status,
        lastHealthAt: schema.slackInstallations.lastHealthAt,
        lastDeliveryAt: schema.slackInstallations.lastDeliveryAt,
        lastError: schema.slackInstallations.lastError,
      })
      .from(schema.slackInstallations)
      .where(eq(schema.slackInstallations.organisationId, subject.organisationId));
  }

  async revoke(subject: AuthorisationSubject, installationId: string) {
    requireCapability(subject, "administration.manage");
    const [installation] = await this.db
      .select()
      .from(schema.slackInstallations)
      .where(
        and(
          eq(schema.slackInstallations.id, installationId),
          eq(schema.slackInstallations.organisationId, subject.organisationId),
        ),
      )
      .limit(1);
    if (!installation) throw new Error("Slack installation not found");
    try {
      const token = (decryptConnectorPayload(
        installation.encryptedBotToken,
        encryptionKey(),
      ) as { token: string }).token;
      await slackApi(token, "auth.revoke", { test: false });
    } finally {
      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.slackInstallations)
          .set({
            status: "revoked",
            revokedAt: new Date(),
            encryptedBotToken: encryptConnectorPayload(
              { revoked: true },
              encryptionKey(),
            ),
            updatedAt: new Date(),
          })
          .where(eq(schema.slackInstallations.id, installation.id));
        await appendAuditEvent(tx, {
          organisationId: subject.organisationId,
          actorId: subject.actorId,
          actorType: "human",
          action: "slack.installation.revoked",
          targetType: "slack_installation",
          targetId: installation.id,
          metadata: { teamId: installation.teamId },
          traceId: crypto.randomUUID(),
        });
      });
    }
  }

  async mapIdentity(
    subject: AuthorisationSubject,
    input: { installationId: string; slackUserId: string; actorId: string },
  ) {
    requireCapability(subject, "administration.manage");
    const [installationRows, actorRows] = await Promise.all([
      this.db
        .select({ id: schema.slackInstallations.id })
        .from(schema.slackInstallations)
        .where(
          and(
            eq(schema.slackInstallations.id, input.installationId),
            eq(schema.slackInstallations.organisationId, subject.organisationId),
            eq(schema.slackInstallations.status, "active"),
          ),
        )
        .limit(1),
      this.db
        .select({ id: schema.actors.id })
        .from(schema.actors)
        .where(
          and(
            eq(schema.actors.id, input.actorId),
            eq(schema.actors.organisationId, subject.organisationId),
            eq(schema.actors.actorType, "human"),
            eq(schema.actors.status, "active"),
          ),
        )
        .limit(1),
    ]);
    const installation = installationRows[0];
    const actor = actorRows[0];
    if (!installation || !actor)
      throw new Error("Slack installation or actor not found");
    await this.db
      .insert(schema.slackIdentityMappings)
      .values({
        id: newId(),
        organisationId: subject.organisationId,
        installationId: installation.id,
        slackUserId: input.slackUserId.trim(),
        actorId: actor.id,
        createdByActorId: subject.actorId,
      })
      .onConflictDoUpdate({
        target: [
          schema.slackIdentityMappings.installationId,
          schema.slackIdentityMappings.slackUserId,
        ],
        set: { actorId: actor.id, status: "active", revokedAt: null },
      });
  }

  async configureExposure(
    subject: AuthorisationSubject,
    input: {
      installationId: string;
      agentId: string;
      enabled: boolean;
      isDefault: boolean;
      allowedChannelIds?: string[];
      allowDirectMessages?: boolean;
      allowThreadContext?: boolean;
    },
  ) {
    requireCapability(subject, "administration.manage");
    const [installationRows, agentRows] = await Promise.all([
      this.db
        .select({ id: schema.slackInstallations.id })
        .from(schema.slackInstallations)
        .where(
          and(
            eq(schema.slackInstallations.id, input.installationId),
            eq(schema.slackInstallations.organisationId, subject.organisationId),
          ),
        )
        .limit(1),
      this.db
        .select({ id: schema.agentDefinitions.id })
        .from(schema.agentDefinitions)
        .where(
          and(
            eq(schema.agentDefinitions.id, input.agentId),
            eq(schema.agentDefinitions.organisationId, subject.organisationId),
          ),
        )
        .limit(1),
    ]);
    const installation = installationRows[0];
    const agent = agentRows[0];
    if (!installation || !agent)
      throw new Error("Slack installation or agent not found");
    await this.db.transaction(async (tx) => {
      if (input.isDefault)
        await tx
          .update(schema.slackAgentExposures)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(
            and(
              eq(schema.slackAgentExposures.installationId, installation.id),
              eq(schema.slackAgentExposures.organisationId, subject.organisationId),
            ),
          );
      await tx
        .insert(schema.slackAgentExposures)
        .values({
          id: newId(),
          organisationId: subject.organisationId,
          installationId: installation.id,
          agentId: agent.id,
          enabled: input.enabled,
          isDefault: input.isDefault,
          allowedChannelIds: input.allowedChannelIds ?? [],
          allowDirectMessages: input.allowDirectMessages ?? true,
          allowThreadContext: input.allowThreadContext ?? false,
          updatedByActorId: subject.actorId,
        })
        .onConflictDoUpdate({
          target: [
            schema.slackAgentExposures.installationId,
            schema.slackAgentExposures.agentId,
          ],
          set: {
            enabled: input.enabled,
            isDefault: input.isDefault,
            allowedChannelIds: input.allowedChannelIds ?? [],
            allowDirectMessages: input.allowDirectMessages ?? true,
            allowThreadContext: input.allowThreadContext ?? false,
            updatedByActorId: subject.actorId,
            updatedAt: new Date(),
          },
        });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "slack.agent.exposure.updated",
        targetType: "agent",
        targetId: agent.id,
        metadata: {
          installationId: installation.id,
          enabled: input.enabled,
          isDefault: input.isDefault,
        },
        traceId: crypto.randomUUID(),
      });
    });
  }
}

type SlackMessage = {
    type?: string;
    user?: string;
    channel?: string;
    channel_type?: string;
    text?: string;
    thread_ts?: string;
    ts?: string;
    assistant_thread?: SlackAssistantThread;
};

type SlackEnvelope = {
  event?: SlackMessage;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { thread_ts?: string; ts?: string };
  container?: { thread_ts?: string; message_ts?: string };
  type?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
};

type SlackAssistantThread = {
  user_id?: string;
  channel_id?: string;
  thread_ts?: string;
  context?: { channel_id?: string; team_id?: string; enterprise_id?: string };
};

export function normaliseSlackConversation(payload: SlackEnvelope) {
  const event: SlackMessage = payload.event ?? {};
  const assistantThread =
    event.type === "assistant_thread_started" ||
    event.type === "assistant_thread_context_changed"
      ? (event.assistant_thread ?? null)
      : null;
  return {
    event,
    assistantThread,
    slackUserId: event.user ?? assistantThread?.user_id ?? payload.user?.id,
    channelId: event.channel ?? assistantThread?.channel_id ?? payload.channel?.id,
    threadTs:
      event.thread_ts ??
      assistantThread?.thread_ts ??
      payload.message?.thread_ts ??
      payload.container?.thread_ts ??
      event.ts ??
      payload.message?.ts ??
      payload.container?.message_ts,
  };
}

function slackText(value: unknown, max = 2_000) {
  return redactObservationText(typeof value === "string" ? value : "", {
    maxStringLength: max,
  });
}

async function slackApi(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json()) as { ok?: boolean; ts?: string; error?: string };
  if (!response.ok || !payload.ok)
    throw new Error(`Slack ${method} failed: ${payload.error ?? response.status}`);
  return payload;
}

export function slackResultBlocks(agentName: string, status: string, output: unknown) {
  const result =
    output && typeof output === "object" && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : {};
  const summary = slackText(result.summary, 1_500) || "No typed result was produced.";
  const confidence =
    typeof result.confidence === "number"
      ? `\n*Confidence:* ${Math.round(result.confidence * 100)}%`
      : "";
  const gaps = Array.isArray(result.gaps)
    ? slackText(result.gaps.filter((gap): gap is string => typeof gap === "string").slice(0, 3).join("; "), 700)
    : "";
  const actions: Array<{
    type: "button";
    action_id: string;
    text: { type: "plain_text"; text: string };
    value: string;
    style?: "danger";
  }> = [
    {
      type: "button",
      action_id: "muster.view_in_muster",
      text: { type: "plain_text", text: "View in Muster" },
      value: "view",
    },
  ];
  if (["queued", "running", "waiting_sources", "awaiting_approval"].includes(status))
    actions.unshift({
      type: "button",
      action_id: "muster.cancel",
      text: { type: "plain_text", text: "Cancel" },
      style: "danger",
      value: typeof result.runId === "string" ? result.runId : "",
    });
  if (["failed", "cancelled"].includes(status) && typeof result.runId === "string")
    actions.unshift({
      type: "button",
      action_id: "muster.retry",
      text: { type: "plain_text", text: "Retry" },
      value: result.runId,
    });
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${agentName}* — ${status}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${summary}${confidence}${gaps ? `\n*Gaps:* ${gaps}` : ""}`,
      },
    },
    {
      type: "actions",
      elements: actions,
    },
  ];
}

export async function processSlackInboxEvent(inboxEventId: string) {
  const db = database();
  const [row] = await db
    .select({
      inbox: schema.slackInboxEvents,
      installation: schema.slackInstallations,
    })
    .from(schema.slackInboxEvents)
    .innerJoin(
      schema.slackInstallations,
      and(
        eq(schema.slackInstallations.id, schema.slackInboxEvents.installationId),
        eq(
          schema.slackInstallations.organisationId,
          schema.slackInboxEvents.organisationId,
        ),
      ),
    )
    .where(eq(schema.slackInboxEvents.id, inboxEventId))
    .limit(1);
  if (!row || row.inbox.status === "processed") return;
  const payload = decryptConnectorPayload(
    row.inbox.encryptedPayload,
    encryptionKey(),
  ) as SlackEnvelope;
  const { event, assistantThread, slackUserId, channelId, threadTs } =
    normaliseSlackConversation(payload);
  if (!slackUserId || !channelId) {
    await db
      .update(schema.slackInboxEvents)
      .set({ status: "ignored", processedAt: new Date() })
      .where(eq(schema.slackInboxEvents.id, row.inbox.id));
    return;
  }
  const [identity] = await db
    .select({ actor: schema.actors })
    .from(schema.slackIdentityMappings)
    .innerJoin(
      schema.actors,
      and(
        eq(schema.actors.id, schema.slackIdentityMappings.actorId),
        eq(schema.actors.organisationId, row.inbox.organisationId),
      ),
    )
    .where(
      and(
        eq(schema.slackIdentityMappings.installationId, row.installation.id),
        eq(schema.slackIdentityMappings.slackUserId, slackUserId),
        eq(schema.slackIdentityMappings.status, "active"),
        eq(schema.actors.status, "active"),
      ),
    )
    .limit(1);
  if (!identity) {
    await db
      .update(schema.slackInboxEvents)
      .set({ status: "ignored", processedAt: new Date(), error: "identity_unmapped" })
      .where(eq(schema.slackInboxEvents.id, row.inbox.id));
    return;
  }
  const subject: AuthorisationSubject = {
    actorId: identity.actor.id,
    organisationId: row.inbox.organisationId,
    capabilities: new Set(asCapabilities(identity.actor.capabilityAssignments)),
  };
  const action = payload.actions?.[0];
  if (action?.action_id === "muster.view_in_muster") {
    await db
      .update(schema.slackInboxEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(schema.slackInboxEvents.id, row.inbox.id));
    return;
  }
  if (action?.action_id === "muster.cancel" && action.value) {
    requireCapability(subject, "agents.cancel");
    const run = await new GovernedAgentHarness(db).read(subject, action.value);
    const gateway = await fetch(
      `${process.env.AGENT_GATEWAY_URL ?? "http://agent-gateway:3002"}/v1/runs/${encodeURIComponent(run.runId)}/cancel`,
      { method: "POST", signal: AbortSignal.timeout(5_000) },
    );
    if (!gateway.ok) throw new Error("Agent runtime did not accept cancellation");
    await db
      .update(schema.slackInboxEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(schema.slackInboxEvents.id, row.inbox.id));
    return;
  }
  if (action?.action_id === "muster.retry" && action.value) {
    const [prior] = await db
      .select({ run: schema.agentRuns, agent: schema.agentDefinitions })
      .from(schema.agentRuns)
      .innerJoin(
        schema.agentDefinitions,
        and(
          eq(schema.agentDefinitions.id, schema.agentRuns.agentId),
          eq(schema.agentDefinitions.organisationId, row.inbox.organisationId),
        ),
      )
      .where(
        and(
          eq(schema.agentRuns.id, action.value),
          eq(schema.agentRuns.organisationId, row.inbox.organisationId),
          eq(schema.agentRuns.requestedByActorId, subject.actorId),
        ),
      )
      .limit(1);
    const request = prior?.run.request as { humanRequest?: unknown } | undefined;
    if (!prior || typeof request?.humanRequest !== "string")
      throw new Error("Run retry is not available");
    await new GovernedAgentHarness(db).invoke(
      subject,
      {
        agentKey: prior.agent.name,
        input: { prompt: request.humanRequest },
        mode: "slack",
        correlationId: `${row.inbox.eventId}:retry`,
      },
      `slack:${row.installation.id}:${row.inbox.eventId}:retry`,
    );
    await db
      .update(schema.slackInboxEvents)
      .set({ status: "processed", processedAt: new Date() })
      .where(eq(schema.slackInboxEvents.id, row.inbox.id));
    return;
  }
  const exposures = await db
    .select({ exposure: schema.slackAgentExposures, agent: schema.agentDefinitions })
    .from(schema.slackAgentExposures)
    .innerJoin(
      schema.agentDefinitions,
      and(
        eq(schema.agentDefinitions.id, schema.slackAgentExposures.agentId),
        eq(schema.agentDefinitions.organisationId, row.inbox.organisationId),
        eq(schema.agentDefinitions.status, "active"),
        eq(schema.agentDefinitions.killSwitch, false),
      ),
    )
    .where(
      and(
        eq(schema.slackAgentExposures.installationId, row.installation.id),
        eq(schema.slackAgentExposures.enabled, true),
      ),
    );
  const text = slackText(event.text, 4_000);
  const requested = text.match(/(?:\/muster|use)\s+([\w -]+)/i)?.[1]?.trim().toLowerCase();
  const direct = event.channel_type === "im" || Boolean(assistantThread);
  const eligible = exposures.filter(({ exposure }) => {
    const allowed = Array.isArray(exposure.allowedChannelIds)
      ? exposure.allowedChannelIds.includes(channelId)
      : false;
    return direct ? exposure.allowDirectMessages : allowed;
  });
  const selected =
    eligible.find(({ agent }) => agent.name.toLowerCase() === requested) ??
    eligible.find(({ agent }) =>
      text.toLowerCase().startsWith(`${agent.name.toLowerCase()} `),
    ) ??
    eligible.find(({ exposure }) => exposure.isDefault) ??
    eligible[0];
  if (!selected) {
    await db
      .update(schema.slackInboxEvents)
      .set({ status: "ignored", processedAt: new Date(), error: "agent_not_exposed" })
      .where(eq(schema.slackInboxEvents.id, row.inbox.id));
    return;
  }
  try {
    const accepted = await new GovernedAgentHarness(db).invoke(
      subject,
      {
        agentKey: selected.agent.name,
        input: {
          prompt:
            text ||
            (assistantThread
              ? "Assist the user in this Slack Assistant thread. Keep the response bounded and governed."
              : "Continue the Slack thread."),
        },
        mode: "slack",
        correlationId: row.inbox.eventId,
      },
      `slack:${row.installation.id}:${row.inbox.eventId}`,
    );
    const token = (decryptConnectorPayload(
      row.installation.encryptedBotToken,
      encryptionKey(),
    ) as { token: string }).token;
    const posted = await slackApi(token, "chat.postMessage", {
      channel: channelId,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      text: `Muster: ${selected.agent.name} is active. Run queued.`,
      blocks: slackResultBlocks(selected.agent.name, "queued", {
        runId: accepted.runId,
        progress: "Queued; status will update here.",
      }),
    });
    if (assistantThread) {
      await slackApi(token, "assistant.threads.setStatus", {
        channel_id: channelId,
        thread_ts: threadTs,
        status: "Muster is preparing a governed response…",
      }).catch(() => undefined);
    }
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.slackRunDeliveries)
        .values({
          id: newId(),
          organisationId: row.inbox.organisationId,
          installationId: row.installation.id,
          runId: accepted.runId,
          inboxEventId: row.inbox.id,
          channelId,
          threadTs: threadTs ?? posted.ts ?? "",
          progressMessageTs: posted.ts,
          status: "queued",
          lastProgress: {
            stage: "queued",
            percent: 0,
            assistantThread: Boolean(assistantThread),
            contextChannelId: selected.exposure.allowThreadContext
              ? assistantThread?.context?.channel_id
              : undefined,
          },
        })
        .onConflictDoNothing();
      await tx
        .update(schema.slackInboxEvents)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(schema.slackInboxEvents.id, row.inbox.id));
      await appendAuditEvent(tx, {
        organisationId: row.inbox.organisationId,
        actorId: identity.actor.id,
        actorType: "human",
        action: "slack.agent.invoked",
        targetType: "agent_run",
        targetId: accepted.runId,
        metadata: { installationId: row.installation.id, channelId, agentId: selected.agent.id },
        traceId: row.inbox.eventId,
      });
    });
  } catch (error) {
    await db
      .update(schema.slackInboxEvents)
      .set({
        status: "failed",
        processedAt: new Date(),
        error: redactObservationText(error instanceof Error ? error.message : "Slack event failed"),
      })
      .where(eq(schema.slackInboxEvents.id, row.inbox.id));
    throw error;
  }
}

export async function deliverSlackRun(runId: string) {
  const db = database();
  const deliveries = await db
    .select({
      delivery: schema.slackRunDeliveries,
      installation: schema.slackInstallations,
      run: schema.agentRuns,
      agent: schema.agentDefinitions,
    })
    .from(schema.slackRunDeliveries)
    .innerJoin(
      schema.slackInstallations,
      and(
        eq(schema.slackInstallations.id, schema.slackRunDeliveries.installationId),
        eq(schema.slackInstallations.organisationId, schema.slackRunDeliveries.organisationId),
      ),
    )
    .innerJoin(
      schema.agentRuns,
      and(
        eq(schema.agentRuns.id, schema.slackRunDeliveries.runId),
        eq(schema.agentRuns.organisationId, schema.slackRunDeliveries.organisationId),
      ),
    )
    .innerJoin(
      schema.agentDefinitions,
      and(
        eq(schema.agentDefinitions.id, schema.agentRuns.agentId),
        eq(schema.agentDefinitions.organisationId, schema.agentRuns.organisationId),
      ),
    )
    .where(
      and(
        eq(schema.slackRunDeliveries.runId, runId),
        eq(schema.slackRunDeliveries.status, "queued"),
      ),
    );
  for (const row of deliveries) {
    const terminal = ["completed", "failed", "cancelled"].includes(row.run.status);
    const token = (decryptConnectorPayload(
      row.installation.encryptedBotToken,
      encryptionKey(),
    ) as { token: string }).token;
    try {
      const progress =
        row.delivery.lastProgress &&
        typeof row.delivery.lastProgress === "object" &&
        !Array.isArray(row.delivery.lastProgress)
          ? (row.delivery.lastProgress as Record<string, unknown>)
          : {};
      if (!terminal) {
        const runProgress =
          row.run.progress &&
          typeof row.run.progress === "object" &&
          !Array.isArray(row.run.progress)
            ? (row.run.progress as Record<string, unknown>)
            : {};
        const stage = slackText(runProgress.stage, 120) || "working";
        if (progress.stage === stage) continue;
        if (row.delivery.progressMessageTs)
          await slackApi(token, "chat.update", {
            channel: row.delivery.channelId,
            ts: row.delivery.progressMessageTs,
            text: `Muster: ${row.agent.name} is ${stage}.`,
            blocks: slackResultBlocks(row.agent.name, row.run.status, {
              runId: row.run.id,
              summary: `Progress: ${stage}.`,
            }),
          });
        await db
          .update(schema.slackRunDeliveries)
          .set({
            lastProgress: { ...progress, stage },
            updatedAt: new Date(),
          })
          .where(eq(schema.slackRunDeliveries.id, row.delivery.id));
        continue;
      }
      if (progress.assistantThread === true)
        await slackApi(token, "assistant.threads.setStatus", {
          channel_id: row.delivery.channelId,
          thread_ts: row.delivery.threadTs,
          status:
            row.run.status === "completed"
              ? "Muster completed the governed response."
              : `Muster ${row.run.status} the governed response.`,
        });
      if (row.delivery.progressMessageTs)
        await slackApi(token, "chat.update", {
          channel: row.delivery.channelId,
          ts: row.delivery.progressMessageTs,
          text: `Muster: ${row.agent.name} ${row.run.status}.`,
          blocks: slackResultBlocks(row.agent.name, row.run.status, {
            ...(row.run.structuredOutput &&
            typeof row.run.structuredOutput === "object" &&
            !Array.isArray(row.run.structuredOutput)
              ? row.run.structuredOutput
              : {}),
            runId: row.run.id,
          }),
        });
      await db.transaction(async (tx) => {
        await tx
          .update(schema.slackRunDeliveries)
          .set({
            status: "delivered",
            resultMessageTs: row.delivery.progressMessageTs,
            updatedAt: new Date(),
          })
          .where(eq(schema.slackRunDeliveries.id, row.delivery.id));
        await tx
          .update(schema.slackInstallations)
          .set({ lastDeliveryAt: new Date(), lastError: null, updatedAt: new Date() })
          .where(eq(schema.slackInstallations.id, row.installation.id));
      });
    } catch (error) {
      await db
        .update(schema.slackRunDeliveries)
        .set({
          attemptCount: row.delivery.attemptCount + 1,
          lastError: redactObservationText(error instanceof Error ? error.message : "Slack delivery failed"),
          updatedAt: new Date(),
        })
        .where(eq(schema.slackRunDeliveries.id, row.delivery.id));
      throw error;
    }
  }
}

export { decryptConnectorPayload, encryptConnectorPayload };
