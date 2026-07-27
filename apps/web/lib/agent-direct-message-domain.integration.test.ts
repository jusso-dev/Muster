import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, eq } from "drizzle-orm";
import { AgentDirectMessageDomainService } from "./agent-direct-message-domain";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("agent direct-message invocation", () => {
  let organisationId = "";
  let humanActorId = "";
  let agentId = "";
  let roomId = "";
  let subject: {
    actorId: string;
    organisationId: string;
    capabilities: Set<any>;
  };

  beforeAll(async () => {
    const humans = await database()
      .select()
      .from(schema.actors)
      .where(eq(schema.actors.actorType, "human"));
    const human = humans.find(
      (actor) =>
        Array.isArray(actor.capabilityAssignments) &&
        actor.capabilityAssignments.includes("agents.invoke"),
    );
    if (
      !human ||
      !Array.isArray(human.capabilityAssignments) ||
      !human.capabilityAssignments.includes("agents.invoke")
    ) {
      throw new Error("Bootstrapped agent invoker required");
    }
    organisationId = human.organisationId;
    humanActorId = human.id;
    subject = {
      actorId: human.id,
      organisationId,
      capabilities: new Set(human.capabilityAssignments as any[]),
    };
    agentId = newId();
    roomId = newId();
    await database()
      .insert(schema.actors)
      .values({
        id: agentId,
        organisationId,
        actorType: "agent",
        displayName: "Synthetic DM Agent",
        identityReference: `agent:synthetic-dm:${agentId}`,
        capabilityAssignments: [],
      });
    await database()
      .insert(schema.rooms)
      .values({
        id: roomId,
        organisationId,
        name: `synthetic-dm-${roomId}`,
        slug: `synthetic-dm-${roomId}`,
        displayName: "Synthetic DM Agent",
        roomType: "direct",
        visibility: "private",
        createdByActorId: humanActorId,
      });
    await database()
      .insert(schema.roomMemberships)
      .values([
        {
          organisationId,
          roomId,
          actorId: humanActorId,
          membershipRole: "owner",
        },
        {
          organisationId,
          roomId,
          actorId: agentId,
          membershipRole: "agent_member",
        },
      ]);
    await database()
      .insert(schema.agentDefinitions)
      .values({
        id: agentId,
        organisationId,
        name: `Synthetic DM Agent ${agentId}`,
        description: "Synthetic direct-message integration fixture",
        runtime: "mock",
        model: "synthetic",
        ownerActorId: humanActorId,
        systemPromptVersion: "synthetic-dm-v1",
        allowedRooms: [roomId],
        maximumRuntimeSeconds: 30,
        maximumTokenBudget: 1_000,
        maximumCostCents: 10,
      });
  });

  afterAll(closeDatabase);

  async function sourceMessage(targetRoomId = roomId) {
    const id = newId();
    await database()
      .insert(schema.messages)
      .values({
        id,
        organisationId,
        roomId: targetRoomId,
        authorActorId: humanActorId,
        messageType: "text",
        document: { type: "doc", content: [] },
        plainText: `Review synthetic evidence ${id}`,
        idempotencyKey: `synthetic-dm-source:${id}`,
      });
    return id;
  }

  it("queues one durable run, event, audit, and outbox idempotently", async () => {
    const messageId = await sourceMessage();
    const service = new AgentDirectMessageDomainService();
    const first = await service.maybeQueue(
      subject,
      { messageId, roomId },
      `trace-${messageId}`,
    );
    const replay = await service.maybeQueue(
      subject,
      { messageId, roomId },
      `trace-replay-${messageId}`,
    );

    expect(first).toMatchObject({
      handled: true,
      queued: true,
      duplicate: false,
      agentId,
      status: "queued",
    });
    expect(replay).toMatchObject({
      handled: true,
      queued: true,
      duplicate: true,
      agentRunId:
        first && first.queued ? first.agentRunId : "missing-agent-run",
    });
    if (!first?.queued) throw new Error("Agent run was not queued");
    const [events, outbox, audit] = await Promise.all([
      database()
        .select()
        .from(schema.agentRunEvents)
        .where(eq(schema.agentRunEvents.runId, first.agentRunId)),
      database()
        .select()
        .from(schema.outboxEvents)
        .where(
          eq(
            schema.outboxEvents.idempotencyKey,
            `agent.run.queued:${first.agentRunId}`,
          ),
        ),
      database()
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.organisationId, organisationId),
            eq(schema.auditEvents.targetType, "agent_run"),
            eq(schema.auditEvents.targetId, first.agentRunId),
            eq(schema.auditEvents.action, "agent.run.queued"),
          ),
        ),
    ]);
    expect(events).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(audit).toHaveLength(1);
  });

  it("requires agents.invoke before queueing", async () => {
    const messageId = await sourceMessage();
    await expect(
      new AgentDirectMessageDomainService().maybeQueue(
        { ...subject, capabilities: new Set() },
        { messageId, roomId },
        `trace-${messageId}`,
      ),
    ).rejects.toThrow("Missing capability: agents.invoke");
  });

  it("honours the kill switch and allowed-room boundary", async () => {
    const service = new AgentDirectMessageDomainService();
    const disabledMessageId = await sourceMessage();
    await database()
      .update(schema.agentDefinitions)
      .set({ killSwitch: true })
      .where(eq(schema.agentDefinitions.id, agentId));
    expect(
      await service.maybeQueue(
        subject,
        { messageId: disabledMessageId, roomId },
        `trace-${disabledMessageId}`,
      ),
    ).toMatchObject({ queued: false, reason: "agent_count" });

    await database()
      .update(schema.agentDefinitions)
      .set({ killSwitch: false, allowedRooms: [] })
      .where(eq(schema.agentDefinitions.id, agentId));
    const disallowedMessageId = await sourceMessage();
    expect(
      await service.maybeQueue(
        subject,
        { messageId: disallowedMessageId, roomId },
        `trace-${disallowedMessageId}`,
      ),
    ).toMatchObject({ queued: false, reason: "agent_unavailable" });
    await database()
      .update(schema.agentDefinitions)
      .set({ allowedRooms: [roomId] })
      .where(eq(schema.agentDefinitions.id, agentId));
  });

  it("does not handle a non-direct room", async () => {
    const [room] = await database()
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      .innerJoin(
        schema.roomMemberships,
        and(
          eq(schema.roomMemberships.roomId, schema.rooms.id),
          eq(schema.roomMemberships.actorId, humanActorId),
        ),
      )
      .where(
        and(
          eq(schema.rooms.organisationId, organisationId),
          eq(schema.rooms.roomType, "operations"),
        ),
      )
      .limit(1);
    if (!room) throw new Error("Bootstrapped operations room required");
    const messageId = await sourceMessage(room.id);
    await expect(
      new AgentDirectMessageDomainService().maybeQueue(
        subject,
        { messageId, roomId: room.id },
        `trace-${messageId}`,
      ),
    ).resolves.toBeNull();
  });
});
