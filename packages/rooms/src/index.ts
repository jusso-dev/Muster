import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import { MessageTypeSchema, RoomTypeSchema } from "@muster/contracts";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";

export const CreateRoomSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  displayName: z.string().min(2).max(120),
  description: z.string().max(2_000).default(""),
  roomType: RoomTypeSchema,
  visibility: z.enum(["organisation", "private", "restricted"]),
  topic: z.string().max(500).default(""),
});

export const PostMessageSchema = z.object({
  roomId: z.string().uuid(),
  threadParentId: z.string().uuid().nullable().optional(),
  messageType: MessageTypeSchema.default("text"),
  document: z.record(z.string(), z.unknown()),
  plainText: z.string().min(1).max(100_000),
  dataClassification: z.enum(["public", "internal", "confidential", "restricted"]),
  relatedAlertId: z.string().uuid().nullable().optional(),
  relatedInvestigationId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().min(8).max(200),
});

export const ToggleReactionSchema = z.object({
  emoji: z.enum(["eyes", "check", "thumbsup"]),
});

export class RoomService {
  constructor(private readonly db = database()) {}

  async create(
    subject: AuthorisationSubject,
    input: z.input<typeof CreateRoomSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "rooms.create");
    const parsed = CreateRoomSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const id = newId();
      const [room] = await tx
        .insert(schema.rooms)
        .values({
          id,
          organisationId: subject.organisationId,
          createdByActorId: subject.actorId,
          ...parsed,
        })
        .returning();
      await tx.insert(schema.roomMemberships).values({
        organisationId: subject.organisationId,
        roomId: id,
        actorId: subject.actorId,
        membershipRole: "owner",
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "room.created",
        aggregateType: "room",
        aggregateId: id,
        queueName: "muster-outbox",
        payload: { roomId: id },
        idempotencyKey: `room.created:${id}`,
        traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "room.created",
        targetType: "room",
        targetId: id,
        metadata: { slug: parsed.slug, roomType: parsed.roomType },
        traceId,
      });
      return room;
    });
  }

  async postMessage(
    subject: AuthorisationSubject,
    input: z.input<typeof PostMessageSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "messages.create");
    const parsed = PostMessageSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select({ roomId: schema.roomMemberships.roomId })
        .from(schema.roomMemberships)
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, parsed.roomId),
            eq(schema.roomMemberships.actorId, subject.actorId),
          ),
        )
        .limit(1);
      if (!membership) throw new Error("Room membership required");

      const existing = await tx.query.messages.findFirst({
        where: and(
          eq(schema.messages.organisationId, subject.organisationId),
          eq(schema.messages.idempotencyKey, parsed.idempotencyKey),
        ),
      });
      if (existing) return existing;

      if (parsed.threadParentId) {
        const [parent] = await tx
          .select({ roomId: schema.messages.roomId })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.organisationId, subject.organisationId),
              eq(schema.messages.id, parsed.threadParentId),
              eq(schema.messages.roomId, parsed.roomId),
            ),
          )
          .limit(1);
        if (!parent) throw new Error("Thread parent not found in room");
      }

      const id = newId();
      const [message] = await tx
        .insert(schema.messages)
        .values({
          id,
          organisationId: subject.organisationId,
          authorActorId: subject.actorId,
          ...parsed,
          threadParentId: parsed.threadParentId ?? null,
          relatedAlertId: parsed.relatedAlertId ?? null,
          relatedInvestigationId: parsed.relatedInvestigationId ?? null,
        })
        .returning();
      const eventType = parsed.threadParentId
        ? "room.thread.created"
        : "room.message.created";
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType,
        aggregateType: "message",
        aggregateId: id,
        queueName: "muster-outbox",
        payload: { messageId: id, roomId: parsed.roomId },
        idempotencyKey: `${eventType}:${parsed.idempotencyKey}`,
        traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: eventType,
        targetType: "message",
        targetId: id,
        metadata: {
          roomId: parsed.roomId,
          messageType: parsed.messageType,
          classification: parsed.dataClassification,
        },
        traceId,
      });
      return message;
    });
  }

  async toggleReaction(
    subject: AuthorisationSubject,
    messageId: string,
    input: z.input<typeof ToggleReactionSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "messages.create");
    const { emoji } = ToggleReactionSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .select({ roomId: schema.messages.roomId })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.organisationId, subject.organisationId),
            eq(schema.messages.id, messageId),
          ),
        )
        .limit(1);
      if (!message) throw new Error("Message not found");

      const [membership] = await tx
        .select({ roomId: schema.roomMemberships.roomId })
        .from(schema.roomMemberships)
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, message.roomId),
            eq(schema.roomMemberships.actorId, subject.actorId),
          ),
        )
        .limit(1);
      if (!membership) throw new Error("Room membership required");

      const [existing] = await tx
        .select({ emoji: schema.reactions.emoji })
        .from(schema.reactions)
        .where(
          and(
            eq(schema.reactions.organisationId, subject.organisationId),
            eq(schema.reactions.messageId, messageId),
            eq(schema.reactions.actorId, subject.actorId),
            eq(schema.reactions.emoji, emoji),
          ),
        )
        .limit(1);
      const active = !existing;
      if (existing) {
        await tx
          .delete(schema.reactions)
          .where(
            and(
              eq(schema.reactions.organisationId, subject.organisationId),
              eq(schema.reactions.messageId, messageId),
              eq(schema.reactions.actorId, subject.actorId),
              eq(schema.reactions.emoji, emoji),
            ),
          );
      } else {
        await tx.insert(schema.reactions).values({
          organisationId: subject.organisationId,
          messageId,
          actorId: subject.actorId,
          emoji,
        });
      }

      const [reactionTotal] = await tx
        .select({ value: count() })
        .from(schema.reactions)
        .where(
          and(
            eq(schema.reactions.organisationId, subject.organisationId),
            eq(schema.reactions.messageId, messageId),
            eq(schema.reactions.emoji, emoji),
          ),
        );
      const eventType = active
        ? "room.reaction.created"
        : "room.reaction.removed";
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType,
        aggregateType: "message",
        aggregateId: messageId,
        queueName: "muster-outbox",
        payload: { messageId, roomId: message.roomId, emoji, active },
        idempotencyKey: `${eventType}:${messageId}:${subject.actorId}:${emoji}:${Date.now()}`,
        traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: eventType,
        targetType: "message",
        targetId: messageId,
        metadata: { roomId: message.roomId, emoji, active },
        traceId,
      });
      return { messageId, emoji, active, count: reactionTotal?.value ?? 0 };
    });
  }
}
