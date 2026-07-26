import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capabilities, type AuthorisationSubject } from "@muster/authz";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { and, count, eq } from "drizzle-orm";
import { RoomService } from "./index.ts";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("enterprise room messaging", () => {
  const organisationId = newId();
  const otherOrganisationId = newId();
  const actorId = newId();
  const secondActorId = newId();
  const outsiderActorId = newId();
  const roomId = newId();
  const service = new RoomService();
  const document = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Synthetic room message" }],
      },
    ],
  };
  const subject: AuthorisationSubject = {
    organisationId,
    actorId,
    capabilities: new Set(capabilities),
  };

  beforeAll(async () => {
    await database()
      .insert(schema.organisations)
      .values([
        {
          id: organisationId,
          name: "Synthetic Room Organisation",
          slug: `synthetic-room-${organisationId}`,
        },
        {
          id: otherOrganisationId,
          name: "Synthetic Other Organisation",
          slug: `synthetic-other-${otherOrganisationId}`,
        },
      ]);
    await database()
      .insert(schema.actors)
      .values([
        {
          id: actorId,
          organisationId,
          actorType: "human",
          displayName: "Synthetic Author",
          capabilityAssignments: [...capabilities],
        },
        {
          id: secondActorId,
          organisationId,
          actorType: "human",
          displayName: "Synthetic Reader",
          capabilityAssignments: ["rooms.read", "messages.create"],
        },
        {
          id: outsiderActorId,
          organisationId: otherOrganisationId,
          actorType: "human",
          displayName: "Synthetic Outsider",
          capabilityAssignments: [...capabilities],
        },
      ]);
    await database()
      .insert(schema.rooms)
      .values({
        id: roomId,
        organisationId,
        name: "synthetic-room",
        slug: `synthetic-room-${roomId}`,
        displayName: "Synthetic Room",
        roomType: "operations",
        visibility: "private",
        createdByActorId: actorId,
      });
    await database()
      .insert(schema.roomMemberships)
      .values([
        {
          organisationId,
          roomId,
          actorId,
          membershipRole: "owner",
        },
        {
          organisationId,
          roomId,
          actorId: secondActorId,
          membershipRole: "member",
        },
      ]);
  });

  afterAll(closeDatabase);

  it("deduplicates concurrent creates in PostgreSQL", async () => {
    const idempotencyKey = `room-create-${newId()}`;
    const input = {
      roomId,
      document,
      plainText: "Synthetic room message",
      dataClassification: "internal" as const,
      idempotencyKey,
    };
    const [first, second] = await Promise.all([
      service.postMessage(subject, input, `trace-${newId()}`),
      service.postMessage(subject, input, `trace-${newId()}`),
    ]);
    expect(first.message.id).toBe(second.message.id);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    const [total] = await database()
      .select({ value: count() })
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.organisationId, organisationId),
          eq(schema.messages.idempotencyKey, idempotencyKey),
        ),
      );
    expect(total?.value).toBe(1);
  });

  it("fails closed for cross-tenant and non-member reads", async () => {
    const outsider: AuthorisationSubject = {
      organisationId: otherOrganisationId,
      actorId: outsiderActorId,
      capabilities: new Set(capabilities),
    };
    await expect(
      service.listMessages(outsider, roomId, { limit: 10 }),
    ).rejects.toThrow("Room membership required");
  });

  it("paginates without overlap using an opaque stable cursor", async () => {
    for (let index = 0; index < 5; index += 1) {
      await service.postMessage(
        subject,
        {
          roomId,
          document,
          plainText: `Synthetic paginated message ${index}`,
          dataClassification: "internal",
          idempotencyKey: `pagination-${index}-${newId()}`,
        },
        `trace-${newId()}`,
      );
    }
    const first = await service.listMessages(subject, roomId, { limit: 2 });
    expect(first.page).toMatchObject({
      hasMore: true,
      nextBefore: expect.stringContaining("|"),
    });
    const second = await service.listMessages(subject, roomId, {
      limit: 2,
      before: first.page.nextBefore!,
    });
    expect(
      first.messages.filter((message) =>
        second.messages.some((candidate) => candidate.id === message.id),
      ),
    ).toEqual([]);
  });

  it("persists reactions, edits, deletes, actions, and read state", async () => {
    const evidenceId = newId();
    await database()
      .insert(schema.evidence)
      .values({
        id: evidenceId,
        organisationId,
        fileName: "synthetic-room-evidence.txt",
        mimeType: "text/plain",
        size: 28,
        sha256: newId().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
        uploadedByActorId: actorId,
        classification: "internal",
        relatedRoomId: roomId,
        source: "room-attachment",
        storageKey: `synthetic/${evidenceId}`,
        scanState: "pending",
      });
    const attachmentMessage = await service.postMessage(
      subject,
      {
        roomId,
        document: {
          type: "doc",
          content: [
            {
              type: "attachment",
              attrs: {
                id: evidenceId,
                label: "synthetic-room-evidence.txt",
              },
            },
          ],
        },
        plainText: "Evidence attachment: synthetic-room-evidence.txt",
        dataClassification: "internal",
        idempotencyKey: `attachment-${newId()}`,
      },
      `trace-${newId()}`,
    );
    expect(attachmentMessage.created).toBe(true);
    await expect(
      service.postMessage(
        subject,
        {
          roomId,
          document: {
            type: "doc",
            content: [
              {
                type: "attachment",
                attrs: {
                  id: newId(),
                  label: "missing-evidence.txt",
                },
              },
            ],
          },
          plainText: "Evidence attachment: missing-evidence.txt",
          dataClassification: "internal",
          idempotencyKey: `missing-attachment-${newId()}`,
        },
        `trace-${newId()}`,
      ),
    ).rejects.toThrow("Attachment unavailable in room");

    const created = await service.postMessage(
      subject,
      {
        roomId,
        document,
        plainText: `Lifecycle synthetic message @synthetic.reader #synthetic-room-${roomId}`,
        dataClassification: "internal",
        idempotencyKey: `lifecycle-${newId()}`,
      },
      `trace-${newId()}`,
    );
    const messageId = created.message.id;
    const mentions = await database()
      .select()
      .from(schema.messageMentions)
      .where(
        and(
          eq(schema.messageMentions.organisationId, organisationId),
          eq(schema.messageMentions.messageId, messageId),
        ),
      );
    expect(mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mentionedActorId: secondActorId,
          mentionType: "actor",
          mentionKey: "synthetic.reader",
        }),
        expect.objectContaining({
          mentionedActorId: null,
          mentionType: "room",
          mentionKey: `synthetic-room-${roomId}`,
        }),
      ]),
    );

    const memberSubject: AuthorisationSubject = {
      organisationId,
      actorId: secondActorId,
      capabilities: new Set(["rooms.read", "messages.create"]),
    };
    await expect(
      service.postMessage(
        memberSubject,
        {
          roomId,
          document,
          plainText: "Synthetic forbidden room-wide mention @everyone",
          dataClassification: "internal",
          idempotencyKey: `forbidden-everyone-${newId()}`,
        },
        `trace-${newId()}`,
      ),
    ).rejects.toThrow("Room-wide mentions require room management capability");
    await expect(
      service.setMessageAction(
        memberSubject,
        messageId,
        {
          action: "pin",
          active: true,
          idempotencyKey: `forbidden-pin-${newId()}`,
        },
        `trace-${newId()}`,
      ),
    ).rejects.toThrow("Missing capability: messages.moderate");
    const outsider: AuthorisationSubject = {
      organisationId: otherOrganisationId,
      actorId: outsiderActorId,
      capabilities: new Set(capabilities),
    };
    await expect(
      service.setMessageAction(
        outsider,
        messageId,
        {
          action: "save",
          active: true,
          idempotencyKey: `idor-save-${newId()}`,
        },
        `trace-${newId()}`,
      ),
    ).rejects.toThrow("Message not found");
    const reactionKey = `reaction-${newId()}`;
    const firstReaction = await service.toggleReaction(
      subject,
      messageId,
      { emoji: "eyes", idempotencyKey: reactionKey },
      `trace-${newId()}`,
    );
    const replayedReaction = await service.toggleReaction(
      subject,
      messageId,
      { emoji: "eyes", idempotencyKey: reactionKey },
      `trace-${newId()}`,
    );
    expect(replayedReaction).toEqual(firstReaction);

    await service.setMessageAction(
      subject,
      messageId,
      {
        action: "save",
        active: true,
        idempotencyKey: `save-${newId()}`,
      },
      `trace-${newId()}`,
    );
    await service.setMessageAction(
      subject,
      messageId,
      {
        action: "pin",
        active: true,
        idempotencyKey: `pin-${newId()}`,
      },
      `trace-${newId()}`,
    );
    await service.editMessage(
      subject,
      messageId,
      {
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Edited synthetic message" }],
            },
          ],
        },
        plainText: "Edited synthetic message",
        idempotencyKey: `edit-${newId()}`,
      },
      `trace-${newId()}`,
    );
    const listed = await service.listMessages(subject, roomId, { limit: 20 });
    const message = listed.messages.find(
      (candidate) => candidate.id === messageId,
    );
    expect(message).toMatchObject({
      plainText: "Edited synthetic message",
      pinned: true,
      saved: true,
      reactions: [{ emoji: "eyes", count: 1, reactedByMe: true }],
    });
    await service.updateRoomNotifications(subject, roomId, {
      notificationLevel: "mentions",
      notifyReplies: false,
      notifyFollowedThreads: true,
      muted: true,
    });
    await expect(
      service.getRoomNotifications(subject, roomId),
    ).resolves.toMatchObject({
      notificationLevel: "mentions",
      notifyReplies: false,
      notifyFollowedThreads: true,
      muted: true,
    });
    await service.markRoomRead(subject, roomId, { messageId });
    await service.deleteMessage(
      subject,
      messageId,
      {
        reason: "Synthetic lifecycle verification",
        idempotencyKey: `delete-${newId()}`,
      },
      `trace-${newId()}`,
    );
    const [revisionTotal] = await database()
      .select({ value: count() })
      .from(schema.messageRevisions)
      .where(
        and(
          eq(schema.messageRevisions.organisationId, organisationId),
          eq(schema.messageRevisions.messageId, messageId),
        ),
      );
    expect(revisionTotal?.value).toBe(2);
    const afterDelete = await service.listMessages(subject, roomId, {
      limit: 20,
    });
    expect(
      afterDelete.messages.find((candidate) => candidate.id === messageId),
    ).toMatchObject({
      plainText: "Message deleted",
      deletedAt: expect.any(Date),
    });
  });
});
