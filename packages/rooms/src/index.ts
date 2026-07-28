import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  hasCapability,
  requireCapability,
  type AuthorisationSubject,
} from "@muster/authz";
import { MessageTypeSchema, RoomTypeSchema } from "@muster/contracts";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import {
  OrganisationRoomGovernanceSchema,
  RoomPoliciesSchema,
} from "./governance.ts";

export const CreateRoomSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  displayName: z.string().min(2).max(120),
  description: z.string().max(2_000).default(""),
  roomType: RoomTypeSchema,
  visibility: z.enum(["organisation", "private", "restricted"]),
  topic: z.string().max(500).default(""),
  policies: RoomPoliciesSchema.default(RoomPoliciesSchema.parse({})),
});

const allowedNodeTypes = new Set([
  "doc",
  "paragraph",
  "text",
  "hardBreak",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "mention",
  "reference",
  "attachment",
  "visualReaction",
]);
const allowedMarkTypes = new Set(["bold", "italic", "strike", "code", "link"]);

export function sanitiseMessageDocument(input: unknown) {
  let nodeCount = 0;
  function visit(value: unknown, depth: number): Record<string, unknown> {
    if (
      depth > 12 ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw new Error("Invalid message document");
    }
    nodeCount += 1;
    if (nodeCount > 2_000) throw new Error("Message document is too complex");
    const source = value as Record<string, unknown>;
    if (typeof source.type !== "string" || !allowedNodeTypes.has(source.type)) {
      throw new Error("Unsupported message document node");
    }
    const node: Record<string, unknown> = { type: source.type };
    if (source.type === "text") {
      if (typeof source.text !== "string" || source.text.length > 100_000) {
        throw new Error("Invalid message text node");
      }
      node.text = source.text;
    }
    if (Array.isArray(source.content)) {
      node.content = source.content.map((child) => visit(child, depth + 1));
    }
    if (Array.isArray(source.marks)) {
      node.marks = source.marks.map((mark) => {
        if (!mark || typeof mark !== "object" || Array.isArray(mark)) {
          throw new Error("Invalid message mark");
        }
        const candidate = mark as Record<string, unknown>;
        if (
          typeof candidate.type !== "string" ||
          !allowedMarkTypes.has(candidate.type)
        ) {
          throw new Error("Unsupported message mark");
        }
        if (candidate.type !== "link") return { type: candidate.type };
        const href =
          candidate.attrs &&
          typeof candidate.attrs === "object" &&
          !Array.isArray(candidate.attrs)
            ? (candidate.attrs as Record<string, unknown>).href
            : undefined;
        if (
          typeof href !== "string" ||
          (!href.startsWith("https://") &&
            !href.startsWith("http://") &&
            !href.startsWith("mailto:") &&
            !href.startsWith("/"))
        ) {
          throw new Error("Unsafe message link");
        }
        return { type: "link", attrs: { href } };
      });
    }
    if (
      source.attrs &&
      typeof source.attrs === "object" &&
      !Array.isArray(source.attrs)
    ) {
      const attrs = source.attrs as Record<string, unknown>;
      if (source.type === "heading") {
        const level = Number(attrs.level);
        if (![1, 2, 3].includes(level))
          throw new Error("Invalid heading level");
        node.attrs = { level };
      } else if (source.type === "mention") {
        node.attrs = {
          id: z.string().max(160).parse(attrs.id),
          label: z.string().max(160).parse(attrs.label),
          mentionType: z
            .enum(["actor", "room", "everyone"])
            .parse(attrs.mentionType),
        };
      } else if (source.type === "reference" || source.type === "attachment") {
        node.attrs = {
          id:
            source.type === "attachment"
              ? z.uuid().parse(attrs.id)
              : z.string().max(300).parse(attrs.id),
          label: z.string().max(300).parse(attrs.label),
        };
      } else if (source.type === "visualReaction") {
        node.attrs = {
          assetId: z.uuid().parse(attrs.assetId),
          revisionId: z.uuid().parse(attrs.revisionId),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .parse(attrs.sha256),
          altText: z.string().trim().min(2).max(160).parse(attrs.altText),
          frameCount: z.number().int().min(1).max(24).parse(attrs.frameCount),
        };
      }
    }
    return node;
  }

  const document = visit(input, 0);
  if (document.type !== "doc")
    throw new Error("Message document must be a doc");
  return document;
}

const MessageDocumentSchema = z.unknown().transform(sanitiseMessageDocument);

function attachmentIds(document: Record<string, unknown>) {
  const ids = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    if (
      node.type === "attachment" &&
      node.attrs &&
      typeof node.attrs === "object" &&
      !Array.isArray(node.attrs)
    ) {
      const id = (node.attrs as Record<string, unknown>).id;
      if (typeof id === "string") ids.add(id);
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  }
  visit(document);
  return [...ids];
}

type VisualReactionReference = {
  assetId: string;
  revisionId: string;
  sha256: string;
  altText: string;
  frameCount: number;
};

export function visualReactionReferences(
  document: Record<string, unknown>,
): VisualReactionReference[] {
  const references: VisualReactionReference[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    if (
      node.type === "visualReaction" &&
      node.attrs &&
      typeof node.attrs === "object" &&
      !Array.isArray(node.attrs)
    ) {
      const attrs = node.attrs as Record<string, unknown>;
      references.push({
        assetId: z.uuid().parse(attrs.assetId),
        revisionId: z.uuid().parse(attrs.revisionId),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(attrs.sha256),
        altText: z.string().trim().min(2).max(160).parse(attrs.altText),
        frameCount: z.number().int().min(1).max(24).parse(attrs.frameCount),
      });
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  }
  visit(document);
  return references;
}

export const PostMessageSchema = z.object({
  roomId: z.string().uuid(),
  threadParentId: z.string().uuid().nullable().optional(),
  messageType: MessageTypeSchema.default("text"),
  document: MessageDocumentSchema,
  plainText: z.string().trim().min(1).max(100_000),
  dataClassification: z.enum([
    "public",
    "internal",
    "confidential",
    "restricted",
  ]),
  relatedAlertId: z.string().uuid().nullable().optional(),
  relatedInvestigationId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().min(8).max(200),
});

export const ToggleReactionSchema = z.object({
  emoji: z.enum(["eyes", "check", "thumbsup", "heart", "tada", "warning"]),
  idempotencyKey: z.string().min(8).max(200),
});

export const EditMessageSchema = z.object({
  document: MessageDocumentSchema,
  plainText: z.string().trim().min(1).max(100_000),
  idempotencyKey: z.string().min(8).max(200),
});

export const DeleteMessageSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

export const MessageActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    active: z.boolean(),
    idempotencyKey: z.string().min(8).max(200),
  }),
  z.object({
    action: z.literal("pin"),
    active: z.boolean(),
    idempotencyKey: z.string().min(8).max(200),
  }),
  z.object({
    action: z.literal("follow_thread"),
    active: z.boolean(),
    idempotencyKey: z.string().min(8).max(200),
  }),
]);

export const MarkRoomReadSchema = z.object({
  messageId: z.string().uuid().nullable(),
});

export const RoomNotificationSchema = z.object({
  notificationLevel: z.enum(["all", "mentions", "nothing"]),
  notifyReplies: z.boolean(),
  notifyFollowedThreads: z.boolean(),
  muted: z.boolean(),
});

export const ListMessagesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  before: z
    .string()
    .max(128)
    .refine((value) => {
      const [timestamp, id] = value.split("|");
      return (
        Boolean(timestamp) &&
        !Number.isNaN(new Date(timestamp ?? "").getTime()) &&
        (!id || z.uuid().safeParse(id).success)
      );
    }, "Invalid message cursor")
    .optional(),
});

function activeRoomMembership(subject: AuthorisationSubject, roomId: string) {
  return and(
    eq(schema.roomMemberships.organisationId, subject.organisationId),
    eq(schema.roomMemberships.roomId, roomId),
    eq(schema.roomMemberships.actorId, subject.actorId),
    or(
      isNull(schema.roomMemberships.accessExpiresAt),
      gt(schema.roomMemberships.accessExpiresAt, new Date()),
    ),
  );
}

export class RoomService {
  constructor(private readonly db = database()) {}

  async assertMember(subject: AuthorisationSubject, roomId: string) {
    requireCapability(subject, "rooms.read");
    const [membership] = await this.db
      .select({ roomId: schema.roomMemberships.roomId })
      .from(schema.roomMemberships)
      .where(activeRoomMembership(subject, roomId))
      .limit(1);
    if (!membership) throw new Error("Room membership required");
    return membership;
  }

  async listMessages(
    subject: AuthorisationSubject,
    roomId: string,
    input: z.input<typeof ListMessagesSchema>,
  ) {
    requireCapability(subject, "rooms.read");
    const { limit, before } = ListMessagesSchema.parse(input);
    const [membership] = await this.db
      .select({
        joinedAt: schema.roomMemberships.joinedAt,
        lastReadEventId: schema.roomMemberships.lastReadEventId,
      })
      .from(schema.roomMemberships)
      .where(activeRoomMembership(subject, roomId))
      .limit(1);
    if (!membership) throw new Error("Room membership required");

    let readAt = membership.joinedAt;
    if (membership.lastReadEventId) {
      const [readMessage] = await this.db
        .select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.organisationId, subject.organisationId),
            eq(schema.messages.roomId, roomId),
            eq(schema.messages.id, membership.lastReadEventId),
          ),
        )
        .limit(1);
      if (readMessage) readAt = readMessage.createdAt;
    }

    const conditions = [
      eq(schema.messages.organisationId, subject.organisationId),
      eq(schema.messages.roomId, roomId),
    ];
    if (before) {
      const [timestamp, cursorId] = before.split("|");
      const cursorDate = new Date(timestamp!);
      conditions.push(
        cursorId
          ? or(
              lt(schema.messages.createdAt, cursorDate),
              and(
                eq(schema.messages.createdAt, cursorDate),
                lt(schema.messages.id, cursorId),
              ),
            )!
          : lt(schema.messages.createdAt, cursorDate),
      );
    }
    const rows = await this.db
      .select({
        id: schema.messages.id,
        roomId: schema.messages.roomId,
        threadParentId: schema.messages.threadParentId,
        authorActorId: schema.messages.authorActorId,
        authorName: schema.actors.displayName,
        authorType: schema.actors.actorType,
        messageType: schema.messages.messageType,
        document: schema.messages.document,
        plainText: schema.messages.plainText,
        createdAt: schema.messages.createdAt,
        editedAt: schema.messages.editedAt,
        deletedAt: schema.messages.deletedAt,
        dataClassification: schema.messages.dataClassification,
        relatedAlertId: schema.messages.relatedAlertId,
        relatedInvestigationId: schema.messages.relatedInvestigationId,
        relatedCaseId: schema.messages.relatedCaseId,
        relatedAgentRunId: schema.messages.relatedAgentRunId,
        relatedWorkflowRunId: schema.messages.relatedWorkflowRunId,
        idempotencyKey: schema.messages.idempotencyKey,
      })
      .from(schema.messages)
      .innerJoin(
        schema.actors,
        and(
          eq(schema.actors.organisationId, subject.organisationId),
          eq(schema.actors.id, schema.messages.authorActorId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const ids = page.map((message) => message.id);
    if (ids.length === 0) {
      return { messages: [], page: { hasMore: false, nextBefore: null } };
    }

    const [reactionRows, replyRows, pinRows, saveRows, followRows] =
      await Promise.all([
        this.db
          .select({
            messageId: schema.reactions.messageId,
            actorId: schema.reactions.actorId,
            emoji: schema.reactions.emoji,
          })
          .from(schema.reactions)
          .where(
            and(
              eq(schema.reactions.organisationId, subject.organisationId),
              inArray(schema.reactions.messageId, ids),
            ),
          ),
        this.db
          .select({
            parentId: schema.messages.threadParentId,
            count: count(),
            participants: sql<
              string[]
            >`array_agg(distinct ${schema.messages.authorActorId}::text)`,
          })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.organisationId, subject.organisationId),
              eq(schema.messages.roomId, roomId),
              isNotNull(schema.messages.threadParentId),
              inArray(schema.messages.threadParentId, ids),
            ),
          )
          .groupBy(schema.messages.threadParentId),
        this.db
          .select({ messageId: schema.messagePins.messageId })
          .from(schema.messagePins)
          .where(
            and(
              eq(schema.messagePins.organisationId, subject.organisationId),
              eq(schema.messagePins.roomId, roomId),
              inArray(schema.messagePins.messageId, ids),
            ),
          ),
        this.db
          .select({ messageId: schema.messageSaves.messageId })
          .from(schema.messageSaves)
          .where(
            and(
              eq(schema.messageSaves.organisationId, subject.organisationId),
              eq(schema.messageSaves.actorId, subject.actorId),
              inArray(schema.messageSaves.messageId, ids),
            ),
          ),
        this.db
          .select({ rootMessageId: schema.threadFollows.rootMessageId })
          .from(schema.threadFollows)
          .where(
            and(
              eq(schema.threadFollows.organisationId, subject.organisationId),
              eq(schema.threadFollows.actorId, subject.actorId),
              inArray(schema.threadFollows.rootMessageId, ids),
            ),
          ),
      ]);

    const reactions = new Map<
      string,
      Map<string, { count: number; reactedByMe: boolean }>
    >();
    for (const reaction of reactionRows) {
      const messageReactions =
        reactions.get(reaction.messageId) ??
        new Map<string, { count: number; reactedByMe: boolean }>();
      const aggregate = messageReactions.get(reaction.emoji) ?? {
        count: 0,
        reactedByMe: false,
      };
      aggregate.count += 1;
      aggregate.reactedByMe ||= reaction.actorId === subject.actorId;
      messageReactions.set(reaction.emoji, aggregate);
      reactions.set(reaction.messageId, messageReactions);
    }
    const replies = new Map(
      replyRows.flatMap((row) =>
        row.parentId
          ? [
              [
                row.parentId,
                {
                  count: row.count,
                  participantActorIds: row.participants,
                },
              ] as const,
            ]
          : [],
      ),
    );
    const pinned = new Set(pinRows.map((row) => row.messageId));
    const saved = new Set(saveRows.map((row) => row.messageId));
    const followed = new Set(followRows.map((row) => row.rootMessageId));

    return {
      messages: page.map((message) => ({
        ...message,
        plainText: message.deletedAt ? "Message deleted" : message.plainText,
        document: message.deletedAt
          ? { type: "doc", content: [] }
          : message.document,
        reactions: Array.from(
          reactions.get(message.id)?.entries() ?? [],
          ([emoji, aggregate]) => ({ emoji, ...aggregate }),
        ),
        replyCount: replies.get(message.id)?.count ?? 0,
        participantActorIds: replies.get(message.id)?.participantActorIds ?? [],
        pinned: pinned.has(message.id),
        saved: saved.has(message.id),
        following: followed.has(message.id),
        canEdit:
          message.authorActorId === subject.actorId ||
          hasCapability(subject, "messages.moderate"),
        canPin: hasCapability(subject, "messages.moderate"),
        unread:
          message.authorActorId !== subject.actorId &&
          message.createdAt.getTime() > readAt.getTime(),
      })),
      page: {
        hasMore,
        nextBefore:
          hasMore && page[0]
            ? `${page[0].createdAt.toISOString()}|${page[0].id}`
            : null,
      },
    };
  }

  async create(
    subject: AuthorisationSubject,
    input: z.input<typeof CreateRoomSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "rooms.create");
    const parsed = CreateRoomSchema.parse(input);
    const [organisation] = await this.db
      .select({ policy: schema.organisations.authenticationPolicy })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, subject.organisationId))
      .limit(1);
    if (!organisation) throw new Error("Organisation not found");
    const roomGovernance =
      organisation.policy &&
      typeof organisation.policy === "object" &&
      !Array.isArray(organisation.policy)
        ? (organisation.policy as Record<string, unknown>).roomGovernance
        : undefined;
    const organisationPolicy = OrganisationRoomGovernanceSchema.parse(
      roomGovernance ?? {},
    );
    const creationPolicy =
      parsed.visibility === "organisation"
        ? organisationPolicy.createOrganisationRooms
        : organisationPolicy.createPrivateRooms;
    if (
      creationPolicy === "administrators" &&
      !hasCapability(subject, "administration.manage")
    ) {
      throw new Error("Organisation room creation policy denied");
    }
    if (
      parsed.roomType === "system" &&
      !hasCapability(subject, "rooms.manage")
    ) {
      throw new Error("System rooms require room management capability");
    }
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
    const attachments = attachmentIds(parsed.document);
    const visualReactions = visualReactionReferences(parsed.document);
    if (attachments.length > 0 && !hasCapability(subject, "evidence.upload")) {
      throw new Error("Attachment upload capability required");
    }
    if (visualReactions.length > 0) {
      const [reaction] = visualReactions;
      if (
        visualReactions.length !== 1 ||
        !reaction ||
        parsed.messageType !== "text" ||
        parsed.relatedAlertId ||
        parsed.relatedInvestigationId ||
        parsed.plainText !== `[Visual reaction: ${reaction.altText}]`
      ) {
        throw new Error(
          "Visual reactions must remain decorative standalone messages",
        );
      }
    }
    const mentionRecords = Array.from(
      new Map(
        [
          ...Array.from(
            parsed.plainText.matchAll(/(^|\s)@([a-z0-9._-]+)/gi),
            (match) => {
              const key = (match[2] ?? "").toLowerCase();
              return {
                key,
                type:
                  key === "everyone" || key === "channel"
                    ? ("everyone" as const)
                    : ("actor" as const),
              };
            },
          ),
          ...Array.from(
            parsed.plainText.matchAll(/(^|\s)#([a-z0-9][a-z0-9-]+)/gi),
            (match) => ({
              key: (match[2] ?? "").toLowerCase(),
              type: "room" as const,
            }),
          ),
        ]
          .filter((mention) => mention.key)
          .map((mention) => [`${mention.type}:${mention.key}`, mention]),
      ).values(),
    );
    return this.db.transaction(async (tx) => {
      const [membership] = await tx
        .select({
          roomId: schema.roomMemberships.roomId,
          membershipRole: schema.roomMemberships.membershipRole,
          policies: schema.rooms.policies,
          archivedAt: schema.rooms.archivedAt,
          roomType: schema.rooms.roomType,
        })
        .from(schema.roomMemberships)
        .innerJoin(
          schema.rooms,
          and(
            eq(schema.rooms.organisationId, subject.organisationId),
            eq(schema.rooms.id, schema.roomMemberships.roomId),
          ),
        )
        .where(activeRoomMembership(subject, parsed.roomId))
        .limit(1);
      if (!membership) throw new Error("Room membership required");
      if (membership.archivedAt)
        throw new Error("Archived rooms are read-only");
      if (mentionRecords.some((mention) => mention.type === "everyone")) {
        const policy = RoomPoliciesSchema.parse(membership.policies ?? {});
        const canMentionBroadly =
          hasCapability(subject, "rooms.manage") ||
          membership.membershipRole === "owner" ||
          membership.membershipRole === "moderator";
        if (!policy.broadMentions || !canMentionBroadly) {
          throw new Error("Room-wide mentions are disabled");
        }
      }
      if (attachments.length > 0) {
        const governedAttachments = await tx
          .select({ id: schema.evidence.id })
          .from(schema.evidence)
          .where(
            and(
              eq(schema.evidence.organisationId, subject.organisationId),
              eq(schema.evidence.relatedRoomId, parsed.roomId),
              inArray(schema.evidence.id, attachments),
              inArray(schema.evidence.scanState, ["pending", "clean"]),
            ),
          );
        if (governedAttachments.length !== attachments.length) {
          throw new Error("Attachment unavailable in room");
        }
      }
      if (visualReactions.length > 0) {
        const reaction = visualReactions[0]!;
        const [approvedAsset] = await tx
          .select({ id: schema.reactionPackAssets.id })
          .from(schema.reactionPackAssets)
          .innerJoin(
            schema.reactionPackRevisions,
            and(
              eq(
                schema.reactionPackRevisions.organisationId,
                subject.organisationId,
              ),
              eq(
                schema.reactionPackRevisions.id,
                schema.reactionPackAssets.revisionId,
              ),
              eq(schema.reactionPackRevisions.id, reaction.revisionId),
              eq(schema.reactionPackRevisions.status, "approved"),
            ),
          )
          .innerJoin(
            schema.reactionPacks,
            and(
              eq(schema.reactionPacks.organisationId, subject.organisationId),
              eq(schema.reactionPacks.id, schema.reactionPackRevisions.packId),
              eq(schema.reactionPacks.lifecycle, "active"),
            ),
          )
          .where(
            and(
              eq(
                schema.reactionPackAssets.organisationId,
                subject.organisationId,
              ),
              eq(schema.reactionPackAssets.id, reaction.assetId),
              eq(schema.reactionPackAssets.revisionId, reaction.revisionId),
              eq(schema.reactionPackAssets.sha256, reaction.sha256),
              eq(schema.reactionPackAssets.altText, reaction.altText),
              eq(schema.reactionPackAssets.frameCount, reaction.frameCount),
              eq(schema.reactionPackAssets.verificationState, "verified"),
            ),
          )
          .limit(1);
        if (!approvedAsset) {
          throw new Error("The exact approved visual reaction is unavailable");
        }
      }

      const existing = await tx.query.messages.findFirst({
        where: and(
          eq(schema.messages.organisationId, subject.organisationId),
          eq(schema.messages.idempotencyKey, parsed.idempotencyKey),
        ),
      });
      if (existing) return { message: existing, created: false };

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
      const [inserted] = await tx
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
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const raced = await tx.query.messages.findFirst({
          where: and(
            eq(schema.messages.organisationId, subject.organisationId),
            eq(schema.messages.idempotencyKey, parsed.idempotencyKey),
          ),
        });
        if (!raced) throw new Error("Message idempotency conflict");
        return { message: raced, created: false };
      }
      const message = inserted;

      if (parsed.threadParentId) {
        await tx
          .insert(schema.threadFollows)
          .values({
            organisationId: subject.organisationId,
            rootMessageId: parsed.threadParentId,
            actorId: subject.actorId,
          })
          .onConflictDoNothing();
      }
      if (mentionRecords.length > 0) {
        const [orgActors, orgRooms] = await Promise.all([
          tx
            .select({
              id: schema.actors.id,
              displayName: schema.actors.displayName,
              identityReference: schema.actors.identityReference,
            })
            .from(schema.actors)
            .where(eq(schema.actors.organisationId, subject.organisationId)),
          tx
            .select({ slug: schema.rooms.slug })
            .from(schema.rooms)
            .leftJoin(
              schema.roomMemberships,
              and(
                eq(
                  schema.roomMemberships.organisationId,
                  schema.rooms.organisationId,
                ),
                eq(schema.roomMemberships.roomId, schema.rooms.id),
                eq(schema.roomMemberships.actorId, subject.actorId),
                or(
                  isNull(schema.roomMemberships.accessExpiresAt),
                  gt(schema.roomMemberships.accessExpiresAt, new Date()),
                ),
              ),
            )
            .where(
              and(
                eq(schema.rooms.organisationId, subject.organisationId),
                or(
                  eq(schema.rooms.visibility, "organisation"),
                  eq(schema.roomMemberships.actorId, subject.actorId),
                ),
              ),
            ),
        ]);
        const actorByKey = new Map<string, string>();
        for (const actor of orgActors) {
          actorByKey.set(
            actor.displayName.toLowerCase().replaceAll(" ", "."),
            actor.id,
          );
          if (actor.identityReference) {
            actorByKey.set(
              actor.identityReference.split("@")[0]?.toLowerCase() ?? "",
              actor.id,
            );
          }
        }
        const roomKeys = new Set(orgRooms.map((room) => room.slug));
        const storedMentions = mentionRecords
          .filter(
            (mention) => mention.type !== "room" || roomKeys.has(mention.key),
          )
          .map((mention) => ({
            organisationId: subject.organisationId,
            messageId: id,
            mentionedActorId:
              mention.type === "actor"
                ? (actorByKey.get(mention.key) ?? null)
                : null,
            mentionType: mention.type,
            mentionKey: mention.key,
          }));
        if (storedMentions.length > 0) {
          await tx.insert(schema.messageMentions).values(storedMentions);
        }
      }
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
      // Durable direct-message agent evaluation in the same transaction as the
      // message so a crash after commit still redrives invocation via outbox.
      if (
        membership.roomType === "direct" &&
        !parsed.threadParentId &&
        parsed.messageType === "text"
      ) {
        await writeOutbox(tx, {
          organisationId: subject.organisationId,
          eventType: "agent.direct_message.evaluate",
          aggregateType: "message",
          aggregateId: id,
          queueName: "muster-agents",
          payload: {
            messageId: id,
            roomId: parsed.roomId,
            actorId: subject.actorId,
          },
          idempotencyKey: `agent.direct_message.evaluate:${id}`,
          traceId,
        });
      }
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
      return { message, created: true };
    });
  }

  async editMessage(
    subject: AuthorisationSubject,
    messageId: string,
    input: z.input<typeof EditMessageSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "messages.create");
    const parsed = EditMessageSchema.parse(input);
    if (visualReactionReferences(parsed.document).length > 0) {
      throw new Error("Visual reactions cannot be edited");
    }
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .select()
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
        .where(activeRoomMembership(subject, message.roomId))
        .limit(1);
      if (!membership) throw new Error("Room membership required");
      if (
        message.authorActorId !== subject.actorId &&
        !hasCapability(subject, "messages.moderate")
      ) {
        throw new Error("Only the author or a moderator can edit this message");
      }
      if (message.deletedAt)
        throw new Error("Deleted messages cannot be edited");
      const priorRevision = await tx.query.messageRevisions.findFirst({
        where: and(
          eq(schema.messageRevisions.organisationId, subject.organisationId),
          eq(schema.messageRevisions.idempotencyKey, parsed.idempotencyKey),
        ),
      });
      if (priorRevision) return message;

      await tx.insert(schema.messageRevisions).values({
        id: newId(),
        organisationId: subject.organisationId,
        messageId,
        actorId: subject.actorId,
        revisionType: "edit",
        previousDocument: message.document,
        previousPlainText: message.plainText,
        nextDocument: parsed.document,
        nextPlainText: parsed.plainText,
        idempotencyKey: parsed.idempotencyKey,
      });
      const [updated] = await tx
        .update(schema.messages)
        .set({
          document: parsed.document,
          plainText: parsed.plainText,
          editedAt: new Date(),
        })
        .where(
          and(
            eq(schema.messages.organisationId, subject.organisationId),
            eq(schema.messages.id, messageId),
          ),
        )
        .returning();
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "room.message.edited",
        aggregateType: "message",
        aggregateId: messageId,
        queueName: "muster-outbox",
        payload: { messageId, roomId: message.roomId },
        idempotencyKey: `room.message.edited:${parsed.idempotencyKey}`,
        traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "room.message.edited",
        targetType: "message",
        targetId: messageId,
        metadata: { roomId: message.roomId },
        traceId,
      });
      return updated;
    });
  }

  async deleteMessage(
    subject: AuthorisationSubject,
    messageId: string,
    input: z.input<typeof DeleteMessageSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "messages.create");
    const parsed = DeleteMessageSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .select()
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
        .where(activeRoomMembership(subject, message.roomId))
        .limit(1);
      if (!membership) throw new Error("Room membership required");
      if (
        message.authorActorId !== subject.actorId &&
        !hasCapability(subject, "messages.moderate")
      ) {
        throw new Error(
          "Only the author or a moderator can delete this message",
        );
      }
      if (message.deletedAt) return message;
      const priorRevision = await tx.query.messageRevisions.findFirst({
        where: and(
          eq(schema.messageRevisions.organisationId, subject.organisationId),
          eq(schema.messageRevisions.idempotencyKey, parsed.idempotencyKey),
        ),
      });
      if (priorRevision) return message;

      await tx.insert(schema.messageRevisions).values({
        id: newId(),
        organisationId: subject.organisationId,
        messageId,
        actorId: subject.actorId,
        revisionType: "delete",
        previousDocument: message.document,
        previousPlainText: message.plainText,
        nextDocument: null,
        nextPlainText: null,
        reason: parsed.reason,
        idempotencyKey: parsed.idempotencyKey,
      });
      const [deleted] = await tx
        .update(schema.messages)
        .set({
          document: { type: "doc", content: [] },
          plainText: "Message deleted",
          deletedAt: new Date(),
        })
        .where(
          and(
            eq(schema.messages.organisationId, subject.organisationId),
            eq(schema.messages.id, messageId),
          ),
        )
        .returning();
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "room.message.deleted",
        aggregateType: "message",
        aggregateId: messageId,
        queueName: "muster-outbox",
        payload: { messageId, roomId: message.roomId },
        idempotencyKey: `room.message.deleted:${parsed.idempotencyKey}`,
        traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "room.message.deleted",
        targetType: "message",
        targetId: messageId,
        metadata: { roomId: message.roomId, reason: parsed.reason ?? null },
        traceId,
      });
      return deleted;
    });
  }

  async setMessageAction(
    subject: AuthorisationSubject,
    messageId: string,
    input: z.input<typeof MessageActionSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "rooms.read");
    const parsed = MessageActionSchema.parse(input);
    if (parsed.action === "pin") {
      requireCapability(subject, "messages.moderate");
    }
    return this.db.transaction(async (tx) => {
      const [message] = await tx
        .select({
          roomId: schema.messages.roomId,
          threadParentId: schema.messages.threadParentId,
        })
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
        .where(activeRoomMembership(subject, message.roomId))
        .limit(1);
      if (!membership) throw new Error("Room membership required");

      let changed = false;
      let eventType: string;
      if (parsed.action === "save") {
        const existing = await tx.query.messageSaves.findFirst({
          where: and(
            eq(schema.messageSaves.organisationId, subject.organisationId),
            eq(schema.messageSaves.messageId, messageId),
            eq(schema.messageSaves.actorId, subject.actorId),
          ),
        });
        changed = Boolean(existing) !== parsed.active;
        if (changed && parsed.active) {
          await tx.insert(schema.messageSaves).values({
            organisationId: subject.organisationId,
            messageId,
            actorId: subject.actorId,
          });
        } else if (changed) {
          await tx
            .delete(schema.messageSaves)
            .where(
              and(
                eq(schema.messageSaves.organisationId, subject.organisationId),
                eq(schema.messageSaves.messageId, messageId),
                eq(schema.messageSaves.actorId, subject.actorId),
              ),
            );
        }
        eventType = parsed.active
          ? "room.message.saved"
          : "room.message.unsaved";
      } else if (parsed.action === "pin") {
        const existing = await tx.query.messagePins.findFirst({
          where: and(
            eq(schema.messagePins.organisationId, subject.organisationId),
            eq(schema.messagePins.roomId, message.roomId),
            eq(schema.messagePins.messageId, messageId),
          ),
        });
        changed = Boolean(existing) !== parsed.active;
        if (changed && parsed.active) {
          await tx.insert(schema.messagePins).values({
            organisationId: subject.organisationId,
            roomId: message.roomId,
            messageId,
            pinnedByActorId: subject.actorId,
          });
        } else if (changed) {
          await tx
            .delete(schema.messagePins)
            .where(
              and(
                eq(schema.messagePins.organisationId, subject.organisationId),
                eq(schema.messagePins.roomId, message.roomId),
                eq(schema.messagePins.messageId, messageId),
              ),
            );
        }
        eventType = parsed.active
          ? "room.message.pinned"
          : "room.message.unpinned";
      } else {
        if (message.threadParentId) {
          throw new Error("Only thread roots can be followed");
        }
        const existing = await tx.query.threadFollows.findFirst({
          where: and(
            eq(schema.threadFollows.organisationId, subject.organisationId),
            eq(schema.threadFollows.rootMessageId, messageId),
            eq(schema.threadFollows.actorId, subject.actorId),
          ),
        });
        changed = Boolean(existing) !== parsed.active;
        if (changed && parsed.active) {
          await tx.insert(schema.threadFollows).values({
            organisationId: subject.organisationId,
            rootMessageId: messageId,
            actorId: subject.actorId,
          });
        } else if (changed) {
          await tx
            .delete(schema.threadFollows)
            .where(
              and(
                eq(schema.threadFollows.organisationId, subject.organisationId),
                eq(schema.threadFollows.rootMessageId, messageId),
                eq(schema.threadFollows.actorId, subject.actorId),
              ),
            );
        }
        eventType = parsed.active
          ? "room.thread.followed"
          : "room.thread.unfollowed";
      }
      if (!changed) {
        return { messageId, action: parsed.action, active: parsed.active };
      }
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType,
        aggregateType: "message",
        aggregateId: messageId,
        queueName: "muster-outbox",
        payload: { messageId, roomId: message.roomId, active: parsed.active },
        idempotencyKey: `${eventType}:${parsed.idempotencyKey}`,
        traceId,
      });
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: eventType,
        targetType: "message",
        targetId: messageId,
        metadata: { roomId: message.roomId, active: parsed.active },
        traceId,
      });
      return { messageId, action: parsed.action, active: parsed.active };
    });
  }

  async markRoomRead(
    subject: AuthorisationSubject,
    roomId: string,
    input: z.input<typeof MarkRoomReadSchema>,
  ) {
    requireCapability(subject, "rooms.read");
    const { messageId } = MarkRoomReadSchema.parse(input);
    if (messageId) {
      const [message] = await this.db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.organisationId, subject.organisationId),
            eq(schema.messages.roomId, roomId),
            eq(schema.messages.id, messageId),
          ),
        )
        .limit(1);
      if (!message) throw new Error("Read marker message not found in room");
    }
    const [membership] = await this.db
      .update(schema.roomMemberships)
      .set({ lastReadEventId: messageId })
      .where(activeRoomMembership(subject, roomId))
      .returning({
        roomId: schema.roomMemberships.roomId,
        lastReadEventId: schema.roomMemberships.lastReadEventId,
      });
    if (!membership) throw new Error("Room membership required");
    return membership;
  }

  async updateRoomNotifications(
    subject: AuthorisationSubject,
    roomId: string,
    input: z.input<typeof RoomNotificationSchema>,
  ) {
    requireCapability(subject, "rooms.read");
    const parsed = RoomNotificationSchema.parse(input);
    const [membership] = await this.db
      .update(schema.roomMemberships)
      .set(parsed)
      .where(activeRoomMembership(subject, roomId))
      .returning({
        roomId: schema.roomMemberships.roomId,
        notificationLevel: schema.roomMemberships.notificationLevel,
        notifyReplies: schema.roomMemberships.notifyReplies,
        notifyFollowedThreads: schema.roomMemberships.notifyFollowedThreads,
        muted: schema.roomMemberships.muted,
      });
    if (!membership) throw new Error("Room membership required");
    return membership;
  }

  async getRoomNotifications(subject: AuthorisationSubject, roomId: string) {
    requireCapability(subject, "rooms.read");
    const [membership] = await this.db
      .select({
        roomId: schema.roomMemberships.roomId,
        notificationLevel: schema.roomMemberships.notificationLevel,
        notifyReplies: schema.roomMemberships.notifyReplies,
        notifyFollowedThreads: schema.roomMemberships.notifyFollowedThreads,
        muted: schema.roomMemberships.muted,
      })
      .from(schema.roomMemberships)
      .where(activeRoomMembership(subject, roomId))
      .limit(1);
    if (!membership) throw new Error("Room membership required");
    return membership;
  }

  async toggleReaction(
    subject: AuthorisationSubject,
    messageId: string,
    input: z.input<typeof ToggleReactionSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "messages.create");
    const { emoji, idempotencyKey } = ToggleReactionSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const priorOperation = await tx.query.reactionOperations.findFirst({
        where: and(
          eq(schema.reactionOperations.organisationId, subject.organisationId),
          eq(schema.reactionOperations.idempotencyKey, idempotencyKey),
        ),
      });
      if (priorOperation) {
        return {
          messageId: priorOperation.messageId,
          emoji: priorOperation.emoji,
          active: priorOperation.active,
          count: priorOperation.resultCount,
        };
      }
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
        .where(activeRoomMembership(subject, message.roomId))
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
      const resultCount = reactionTotal?.value ?? 0;
      await tx.insert(schema.reactionOperations).values({
        id: newId(),
        organisationId: subject.organisationId,
        messageId,
        actorId: subject.actorId,
        emoji,
        active,
        resultCount,
        idempotencyKey,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType,
        aggregateType: "message",
        aggregateId: messageId,
        queueName: "muster-outbox",
        payload: { messageId, roomId: message.roomId, emoji, active },
        idempotencyKey: `${eventType}:${idempotencyKey}`,
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
      return { messageId, emoji, active, count: resultCount };
    });
  }
}

export * from "./governance.ts";
export {
  AgentDirectMessageDomainService,
  type DirectMessageInvocation,
} from "./agent-direct-message.ts";
