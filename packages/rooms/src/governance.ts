import { createHash } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  hasCapability,
  requireCapability,
  type AuthorisationSubject,
} from "@muster/authz";
import { RoomTypeSchema } from "@muster/contracts";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";

const MembershipRoleSchema = z.enum([
  "owner",
  "moderator",
  "member",
  "guest",
  "agent_member",
]);
const AssignableMembershipRoleSchema = MembershipRoleSchema.exclude(["owner"]);

export const RoomPoliciesSchema = z.object({
  guestInvites: z.boolean().default(false),
  agentInvites: z.boolean().default(false),
  broadMentions: z.boolean().default(false),
  memberInvites: z.boolean().default(false),
  retentionDays: z.number().int().min(1).max(3_650).nullable().default(null),
  exportAllowed: z.boolean().default(false),
  archiveAfterDays: z.number().int().min(1).max(3_650).nullable().default(null),
});

export const OrganisationRoomGovernanceSchema = z.object({
  createOrganisationRooms: z
    .enum(["capability", "administrators"])
    .default("capability"),
  createPrivateRooms: z
    .enum(["capability", "administrators"])
    .default("capability"),
  inviteGuests: z
    .enum(["room_policy", "administrators"])
    .default("room_policy"),
  inviteAgents: z
    .enum(["room_policy", "administrators"])
    .default("room_policy"),
});

const QueryBooleanSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const RoomBrowserQuerySchema = z.object({
  query: z.string().trim().max(200).default(""),
  visibility: z
    .enum(["all", "organisation", "private", "restricted"])
    .default("all"),
  roomType: RoomTypeSchema.optional(),
  membership: z.enum(["all", "joined", "available"]).default("all"),
  includeArchived: QueryBooleanSchema.default(false),
});

export const UpdateRoomSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    description: z.string().max(2_000).optional(),
    topic: z.string().max(500).optional(),
    visibility: z.enum(["organisation", "private", "restricted"]).optional(),
    policies: RoomPoliciesSchema.partial().optional(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.description !== undefined ||
      value.topic !== undefined ||
      value.visibility !== undefined ||
      value.policies !== undefined,
    "At least one room field is required",
  );

export const RoomLifecycleSchema = z.object({
  action: z.enum(["join", "leave", "archive", "restore"]),
  idempotencyKey: z.string().min(8).max(200),
});

export const InviteRoomMemberSchema = z.object({
  actorIds: z.array(z.string().uuid()).min(1).max(100),
  membershipRole: AssignableMembershipRoleSchema,
  accessExpiresAt: z.coerce.date().nullable().default(null),
  idempotencyKey: z.string().min(8).max(200),
});

export const RespondRoomInvitationSchema = z.object({
  action: z.enum(["accept", "decline", "revoke"]),
  idempotencyKey: z.string().min(8).max(200),
});

export const UpdateRoomMemberSchema = z.object({
  membershipRole: AssignableMembershipRoleSchema.optional(),
  accessExpiresAt: z.coerce.date().nullable().optional(),
  idempotencyKey: z.string().min(8).max(200),
});

export const TransferOwnershipSchema = z.object({
  actorId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(200),
});

export const SidebarPreferenceSchema = z.object({
  favourite: z.boolean().optional(),
  muted: z.boolean().optional(),
  sidebarPosition: z.number().int().min(0).max(10_000).optional(),
  sidebarGroup: z.string().trim().max(80).nullable().optional(),
});

export const CreateDirectRoomSchema = z.object({
  actorIds: z.array(z.string().uuid()).min(1).max(20),
  idempotencyKey: z.string().min(8).max(200),
});

export const ImportRoomSchema = z.object({
  source: z.enum(["muster", "slack"]),
  externalId: z.string().trim().min(1).max(300),
  name: z.string().trim().min(2).max(80),
  displayName: z.string().trim().min(2).max(120),
  description: z.string().max(2_000).default(""),
  topic: z.string().max(500).default(""),
  roomType: RoomTypeSchema.default("operations"),
  visibility: z.enum(["organisation", "private", "restricted"]),
  memberActorIds: z.array(z.string().uuid()).max(500).default([]),
  idempotencyKey: z.string().min(8).max(200),
});

const activeMembership = (actorId: string) =>
  and(
    eq(schema.roomMemberships.actorId, actorId),
    or(
      isNull(schema.roomMemberships.accessExpiresAt),
      gt(schema.roomMemberships.accessExpiresAt, new Date()),
    ),
  );

function fingerprint(actorIds: readonly string[]) {
  return createHash("sha256")
    .update([...actorIds].sort().join(":"))
    .digest("hex");
}

function slugPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56);
}

export class RoomGovernanceService {
  constructor(private readonly db = database()) {}

  private async organisationPolicy(subject: AuthorisationSubject) {
    const [organisation] = await this.db
      .select({ policy: schema.organisations.authenticationPolicy })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, subject.organisationId))
      .limit(1);
    if (!organisation) throw new Error("Organisation not found");
    const policy =
      organisation.policy &&
      typeof organisation.policy === "object" &&
      !Array.isArray(organisation.policy)
        ? (organisation.policy as Record<string, unknown>).roomGovernance
        : undefined;
    return OrganisationRoomGovernanceSchema.parse(policy ?? {});
  }

  async list(subject: AuthorisationSubject, input: unknown = {}) {
    requireCapability(subject, "rooms.read");
    const parsed = RoomBrowserQuerySchema.parse(input);
    const joined = activeMembership(subject.actorId);
    const visibility = or(
      eq(schema.rooms.visibility, "organisation"),
      eq(schema.roomMemberships.actorId, subject.actorId),
      hasCapability(subject, "rooms.manage")
        ? ne(schema.rooms.roomType, "direct")
        : sql`false`,
    );
    const filters = [
      eq(schema.rooms.organisationId, subject.organisationId),
      visibility!,
    ];
    if (!parsed.includeArchived) filters.push(isNull(schema.rooms.archivedAt));
    if (parsed.query) {
      filters.push(
        or(
          ilike(schema.rooms.slug, `%${parsed.query.replaceAll(" ", "-")}%`),
          ilike(schema.rooms.displayName, `%${parsed.query}%`),
          ilike(schema.rooms.description, `%${parsed.query}%`),
          ilike(schema.rooms.topic, `%${parsed.query}%`),
        )!,
      );
    }
    if (parsed.visibility !== "all") {
      filters.push(eq(schema.rooms.visibility, parsed.visibility));
    }
    if (parsed.roomType)
      filters.push(eq(schema.rooms.roomType, parsed.roomType));
    if (parsed.membership === "joined") {
      filters.push(eq(schema.roomMemberships.actorId, subject.actorId));
    }
    if (parsed.membership === "available") {
      filters.push(isNull(schema.roomMemberships.actorId));
    }
    return this.db
      .select({
        id: schema.rooms.id,
        slug: schema.rooms.slug,
        displayName: schema.rooms.displayName,
        description: schema.rooms.description,
        topic: schema.rooms.topic,
        roomType: schema.rooms.roomType,
        visibility: schema.rooms.visibility,
        archivedAt: schema.rooms.archivedAt,
        updatedAt: schema.rooms.updatedAt,
        membershipRole: schema.roomMemberships.membershipRole,
        favourite: schema.roomMemberships.favourite,
        muted: schema.roomMemberships.muted,
        sidebarPosition: schema.roomMemberships.sidebarPosition,
        sidebarGroup: schema.roomMemberships.sidebarGroup,
        memberCount: sql<number>`(
          select count(*)::int from ${schema.roomMemberships} members
          where members.organisation_id = ${subject.organisationId}
            and members.room_id = ${schema.rooms.id}
            and (members.access_expires_at is null or members.access_expires_at > now())
        )`,
        owner: sql<string | null>`(
          select actor.display_name from ${schema.roomMemberships} owner_membership
          join ${schema.actors} actor
            on actor.organisation_id = owner_membership.organisation_id
           and actor.id = owner_membership.actor_id
          where owner_membership.organisation_id = ${subject.organisationId}
            and owner_membership.room_id = ${schema.rooms.id}
            and owner_membership.membership_role = 'owner'
          order by owner_membership.joined_at asc
          limit 1
        )`,
        lastActivityAt: sql<Date | null>`(
          select max(message.created_at) from ${schema.messages} message
          where message.organisation_id = ${subject.organisationId}
            and message.room_id = ${schema.rooms.id}
        )`,
        unreadCount: sql<number>`(
          select count(*)::int
          from ${schema.messages} unread_message
          where unread_message.organisation_id = ${subject.organisationId}
            and unread_message.room_id = ${schema.rooms.id}
            and unread_message.author_actor_id <> ${subject.actorId}
            and ${schema.roomMemberships.actorId} is not null
            and unread_message.created_at > coalesce(
              (
                select read_message.created_at
                from ${schema.messages} read_message
                where read_message.organisation_id = ${subject.organisationId}
                  and read_message.id = ${schema.roomMemberships.lastReadEventId}
                  and read_message.room_id = ${schema.rooms.id}
              ),
              ${schema.roomMemberships.joinedAt}
            )
        )`,
        mentionCount: sql<number>`(
          select count(distinct mention.message_id)::int
          from ${schema.messageMentions} mention
          join ${schema.messages} mention_message
            on mention_message.organisation_id = mention.organisation_id
           and mention_message.id = mention.message_id
          where mention.organisation_id = ${subject.organisationId}
            and mention_message.room_id = ${schema.rooms.id}
            and ${schema.roomMemberships.actorId} is not null
            and (
              mention.mentioned_actor_id = ${subject.actorId}
              or mention.mention_type = 'everyone'
            )
            and mention_message.created_at > coalesce(
              (
                select read_message.created_at
                from ${schema.messages} read_message
                where read_message.organisation_id = ${subject.organisationId}
                  and read_message.id = ${schema.roomMemberships.lastReadEventId}
                  and read_message.room_id = ${schema.rooms.id}
              ),
              ${schema.roomMemberships.joinedAt}
            )
        )`,
      })
      .from(schema.rooms)
      .leftJoin(
        schema.roomMemberships,
        and(
          eq(
            schema.roomMemberships.organisationId,
            schema.rooms.organisationId,
          ),
          eq(schema.roomMemberships.roomId, schema.rooms.id),
          joined,
        ),
      )
      .where(and(...filters))
      .orderBy(
        desc(schema.roomMemberships.favourite),
        asc(schema.roomMemberships.sidebarPosition),
        asc(schema.rooms.displayName),
      );
  }

  async get(subject: AuthorisationSubject, roomId: string) {
    const rooms = await this.list(subject, { includeArchived: true });
    const room = rooms.find((candidate) => candidate.id === roomId);
    if (!room) throw new Error("Room not found");
    return room;
  }

  private async manager(subject: AuthorisationSubject, roomId: string) {
    requireCapability(subject, "rooms.read");
    const [room] = await this.db
      .select({
        id: schema.rooms.id,
        roomType: schema.rooms.roomType,
        visibility: schema.rooms.visibility,
        policies: schema.rooms.policies,
        membershipRole: schema.roomMemberships.membershipRole,
      })
      .from(schema.rooms)
      .leftJoin(
        schema.roomMemberships,
        and(
          eq(
            schema.roomMemberships.organisationId,
            schema.rooms.organisationId,
          ),
          eq(schema.roomMemberships.roomId, schema.rooms.id),
          activeMembership(subject.actorId),
        ),
      )
      .where(
        and(
          eq(schema.rooms.organisationId, subject.organisationId),
          eq(schema.rooms.id, roomId),
        ),
      )
      .limit(1);
    if (!room) throw new Error("Room not found");
    if (
      !hasCapability(subject, "rooms.manage") &&
      room.membershipRole !== "owner" &&
      room.membershipRole !== "moderator"
    ) {
      throw new Error("Room management permission required");
    }
    return room;
  }

  private async writeEvent(
    tx: Parameters<
      Parameters<ReturnType<typeof database>["transaction"]>[0]
    >[0],
    subject: AuthorisationSubject,
    roomId: string,
    action: string,
    idempotencyKey: string,
    traceId: string,
    metadata: Record<string, unknown> = {},
  ) {
    await writeOutbox(tx, {
      organisationId: subject.organisationId,
      eventType: action,
      aggregateType: "room",
      aggregateId: roomId,
      queueName: "muster-outbox",
      payload: { roomId, ...metadata },
      idempotencyKey: `${action}:${idempotencyKey}`,
      traceId,
    });
    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: "human",
      action,
      targetType: "room",
      targetId: roomId,
      metadata,
      traceId,
    });
  }

  async update(
    subject: AuthorisationSubject,
    roomId: string,
    input: unknown,
    traceId: string,
  ) {
    const parsed = UpdateRoomSchema.parse(input);
    const current = await this.manager(subject, roomId);
    if (current.roomType === "direct" && parsed.visibility) {
      throw new Error("Direct room visibility cannot be changed");
    }
    const currentPolicies = RoomPoliciesSchema.parse(current.policies ?? {});
    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.rooms)
        .set({
          ...(parsed.displayName === undefined
            ? {}
            : { displayName: parsed.displayName, name: parsed.displayName }),
          ...(parsed.description === undefined
            ? {}
            : { description: parsed.description }),
          ...(parsed.topic === undefined ? {} : { topic: parsed.topic }),
          ...(parsed.visibility === undefined
            ? {}
            : { visibility: parsed.visibility }),
          ...(parsed.policies === undefined
            ? {}
            : { policies: { ...currentPolicies, ...parsed.policies } }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.rooms.organisationId, subject.organisationId),
            eq(schema.rooms.id, roomId),
          ),
        )
        .returning();
      if (!updated) throw new Error("Room not found");
      await this.writeEvent(
        tx,
        subject,
        roomId,
        "room.updated",
        parsed.idempotencyKey,
        traceId,
        {
          fields: Object.keys(parsed).filter((key) => key !== "idempotencyKey"),
        },
      );
      return updated;
    });
  }

  async lifecycle(
    subject: AuthorisationSubject,
    roomId: string,
    input: unknown,
    traceId: string,
  ) {
    const parsed = RoomLifecycleSchema.parse(input);
    requireCapability(subject, "rooms.read");
    if (parsed.action === "join") {
      const [room] = await this.db
        .select()
        .from(schema.rooms)
        .where(
          and(
            eq(schema.rooms.organisationId, subject.organisationId),
            eq(schema.rooms.id, roomId),
            eq(schema.rooms.visibility, "organisation"),
            isNull(schema.rooms.archivedAt),
            ne(schema.rooms.roomType, "direct"),
          ),
        )
        .limit(1);
      if (!room) throw new Error("Joinable room not found");
      return this.db.transaction(async (tx) => {
        const [membership] = await tx
          .insert(schema.roomMemberships)
          .values({
            organisationId: subject.organisationId,
            roomId,
            actorId: subject.actorId,
            membershipRole: "member",
          })
          .onConflictDoUpdate({
            target: [
              schema.roomMemberships.roomId,
              schema.roomMemberships.actorId,
            ],
            set: { accessExpiresAt: null },
          })
          .returning();
        await this.writeEvent(
          tx,
          subject,
          roomId,
          "room.member.joined",
          parsed.idempotencyKey,
          traceId,
        );
        return membership;
      });
    }
    if (parsed.action === "leave") {
      const [membership] = await this.db
        .select({ role: schema.roomMemberships.membershipRole })
        .from(schema.roomMemberships)
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, roomId),
            eq(schema.roomMemberships.actorId, subject.actorId),
          ),
        )
        .limit(1);
      if (!membership) throw new Error("Room membership required");
      if (membership.role === "owner") {
        throw new Error("Transfer ownership before leaving");
      }
      return this.db.transaction(async (tx) => {
        await tx
          .delete(schema.roomMemberships)
          .where(
            and(
              eq(schema.roomMemberships.organisationId, subject.organisationId),
              eq(schema.roomMemberships.roomId, roomId),
              eq(schema.roomMemberships.actorId, subject.actorId),
            ),
          );
        await this.writeEvent(
          tx,
          subject,
          roomId,
          "room.member.left",
          parsed.idempotencyKey,
          traceId,
        );
        return { roomId, left: true };
      });
    }
    await this.manager(subject, roomId);
    const archivedAt = parsed.action === "archive" ? new Date() : null;
    return this.db.transaction(async (tx) => {
      const [room] = await tx
        .update(schema.rooms)
        .set({ archivedAt, updatedAt: new Date() })
        .where(
          and(
            eq(schema.rooms.organisationId, subject.organisationId),
            eq(schema.rooms.id, roomId),
          ),
        )
        .returning();
      if (!room) throw new Error("Room not found");
      await this.writeEvent(
        tx,
        subject,
        roomId,
        parsed.action === "archive" ? "room.archived" : "room.restored",
        parsed.idempotencyKey,
        traceId,
      );
      return room;
    });
  }

  async invite(
    subject: AuthorisationSubject,
    roomId: string,
    input: unknown,
    traceId: string,
  ) {
    const parsed = InviteRoomMemberSchema.parse(input);
    const room = await this.manager(subject, roomId);
    const policies = RoomPoliciesSchema.parse(room.policies ?? {});
    const organisationPolicy = await this.organisationPolicy(subject);
    if (
      parsed.membershipRole === "guest" &&
      organisationPolicy.inviteGuests === "administrators" &&
      !hasCapability(subject, "administration.manage")
    ) {
      throw new Error("Guest invitations require organisation administration");
    }
    if (
      parsed.membershipRole === "agent_member" &&
      organisationPolicy.inviteAgents === "administrators" &&
      !hasCapability(subject, "administration.manage")
    ) {
      throw new Error("Agent invitations require organisation administration");
    }
    if (parsed.membershipRole === "guest" && !policies.guestInvites) {
      throw new Error("Guest invitations are disabled for this room");
    }
    if (parsed.membershipRole === "agent_member" && !policies.agentInvites) {
      throw new Error("Agent invitations are disabled for this room");
    }
    if (
      parsed.accessExpiresAt &&
      parsed.accessExpiresAt.getTime() <= Date.now()
    ) {
      throw new Error("Access expiry must be in the future");
    }
    const actors = await this.db
      .select({
        id: schema.actors.id,
        actorType: schema.actors.actorType,
        status: schema.actors.status,
      })
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.organisationId, subject.organisationId),
          inArray(schema.actors.id, parsed.actorIds),
        ),
      );
    if (actors.length !== new Set(parsed.actorIds).size) {
      throw new Error("One or more actors are unavailable");
    }
    if (actors.some((actor) => actor.status !== "active")) {
      throw new Error("Deactivated actors cannot be invited");
    }
    if (
      actors.some(
        (actor) =>
          (parsed.membershipRole === "agent_member") !==
          (actor.actorType === "agent"),
      )
    ) {
      throw new Error("Agent actors require the agent_member role");
    }
    if (parsed.membershipRole === "guest" && parsed.accessExpiresAt === null) {
      throw new Error("Guest access requires an expiry");
    }
    return this.db.transaction(async (tx) => {
      const results = [];
      for (const actor of actors) {
        const actorKey = `${parsed.idempotencyKey}:${actor.id}`;
        const [invitation] = await tx
          .insert(schema.roomInvitations)
          .values({
            id: newId(),
            organisationId: subject.organisationId,
            roomId,
            invitedActorId: actor.id,
            membershipRole: parsed.membershipRole,
            accessExpiresAt: parsed.accessExpiresAt,
            idempotencyKey: actorKey,
            invitedByActorId: subject.actorId,
          })
          .onConflictDoNothing()
          .returning();
        const result =
          invitation ??
          (await tx.query.roomInvitations.findFirst({
            where: and(
              eq(schema.roomInvitations.organisationId, subject.organisationId),
              eq(schema.roomInvitations.idempotencyKey, actorKey),
            ),
          }));
        if (result) results.push(result);
      }
      await this.writeEvent(
        tx,
        subject,
        roomId,
        "room.members.invited",
        parsed.idempotencyKey,
        traceId,
        {
          actorIds: actors.map((actor) => actor.id),
          role: parsed.membershipRole,
        },
      );
      return results;
    });
  }

  async respondInvitation(
    subject: AuthorisationSubject,
    invitationId: string,
    input: unknown,
    traceId: string,
  ) {
    const parsed = RespondRoomInvitationSchema.parse(input);
    requireCapability(subject, "rooms.read");
    const [invitation] = await this.db
      .select()
      .from(schema.roomInvitations)
      .where(
        and(
          eq(schema.roomInvitations.organisationId, subject.organisationId),
          eq(schema.roomInvitations.id, invitationId),
        ),
      )
      .limit(1);
    if (!invitation || invitation.status !== "pending") {
      throw new Error("Pending invitation not found");
    }
    if (
      parsed.action === "accept" &&
      invitation.accessExpiresAt &&
      invitation.accessExpiresAt.getTime() <= Date.now()
    ) {
      throw new Error("Invitation has expired");
    }
    if (
      (parsed.action === "accept" || parsed.action === "decline") &&
      invitation.invitedActorId !== subject.actorId
    ) {
      throw new Error("Only the invited actor may respond");
    }
    if (parsed.action === "revoke") {
      await this.manager(subject, invitation.roomId);
    }
    return this.db.transaction(async (tx) => {
      if (parsed.action === "accept") {
        await tx
          .insert(schema.roomMemberships)
          .values({
            organisationId: subject.organisationId,
            roomId: invitation.roomId,
            actorId: invitation.invitedActorId,
            membershipRole: invitation.membershipRole,
            accessExpiresAt: invitation.accessExpiresAt,
          })
          .onConflictDoUpdate({
            target: [
              schema.roomMemberships.roomId,
              schema.roomMemberships.actorId,
            ],
            set: {
              membershipRole: invitation.membershipRole,
              accessExpiresAt: invitation.accessExpiresAt,
            },
          });
      }
      const [updated] = await tx
        .update(schema.roomInvitations)
        .set({
          status: parsed.action === "accept" ? "accepted" : "revoked",
          respondedAt: new Date(),
        })
        .where(
          and(
            eq(schema.roomInvitations.organisationId, subject.organisationId),
            eq(schema.roomInvitations.id, invitationId),
            eq(schema.roomInvitations.status, "pending"),
          ),
        )
        .returning();
      if (!updated) throw new Error("Invitation already resolved");
      await this.writeEvent(
        tx,
        subject,
        invitation.roomId,
        parsed.action === "accept"
          ? "room.invitation.accepted"
          : parsed.action === "decline"
            ? "room.invitation.declined"
            : "room.invitation.revoked",
        parsed.idempotencyKey,
        traceId,
        { invitationId },
      );
      return updated;
    });
  }

  async updateMember(
    subject: AuthorisationSubject,
    roomId: string,
    actorId: string,
    input: unknown,
    traceId: string,
  ) {
    const parsed = UpdateRoomMemberSchema.parse(input);
    await this.manager(subject, roomId);
    const [actor] = await this.db
      .select({ actorType: schema.actors.actorType })
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.organisationId, subject.organisationId),
          eq(schema.actors.id, actorId),
        ),
      )
      .limit(1);
    if (!actor) throw new Error("Actor not found");
    if (
      parsed.membershipRole &&
      (parsed.membershipRole === "agent_member") !==
        (actor.actorType === "agent")
    ) {
      throw new Error("Agent actors require the agent_member role");
    }
    return this.db.transaction(async (tx) => {
      const [membership] = await tx
        .update(schema.roomMemberships)
        .set({
          ...(parsed.membershipRole === undefined
            ? {}
            : { membershipRole: parsed.membershipRole }),
          ...(parsed.accessExpiresAt === undefined
            ? {}
            : { accessExpiresAt: parsed.accessExpiresAt }),
        })
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, roomId),
            eq(schema.roomMemberships.actorId, actorId),
            ne(schema.roomMemberships.membershipRole, "owner"),
          ),
        )
        .returning();
      if (!membership) throw new Error("Editable room member not found");
      await this.writeEvent(
        tx,
        subject,
        roomId,
        "room.member.updated",
        parsed.idempotencyKey,
        traceId,
        { actorId, role: membership.membershipRole },
      );
      return membership;
    });
  }

  async removeMember(
    subject: AuthorisationSubject,
    roomId: string,
    actorId: string,
    idempotencyKey: string,
    traceId: string,
  ) {
    z.string().min(8).max(200).parse(idempotencyKey);
    await this.manager(subject, roomId);
    if (actorId === subject.actorId) {
      throw new Error("Use leave to remove your own membership");
    }
    return this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(schema.roomMemberships)
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, roomId),
            eq(schema.roomMemberships.actorId, actorId),
            ne(schema.roomMemberships.membershipRole, "owner"),
          ),
        )
        .returning();
      if (!removed) throw new Error("Removable room member not found");
      await this.writeEvent(
        tx,
        subject,
        roomId,
        "room.member.removed",
        idempotencyKey,
        traceId,
        { actorId },
      );
      return removed;
    });
  }

  async transferOwnership(
    subject: AuthorisationSubject,
    roomId: string,
    input: unknown,
    traceId: string,
  ) {
    const parsed = TransferOwnershipSchema.parse(input);
    const manager = await this.manager(subject, roomId);
    if (
      !hasCapability(subject, "rooms.manage") &&
      manager.membershipRole !== "owner"
    ) {
      throw new Error("Only an owner may transfer ownership");
    }
    return this.db.transaction(async (tx) => {
      const [target] = await tx
        .select({ role: schema.roomMemberships.membershipRole })
        .from(schema.roomMemberships)
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, roomId),
            eq(schema.roomMemberships.actorId, parsed.actorId),
            or(
              isNull(schema.roomMemberships.accessExpiresAt),
              gt(schema.roomMemberships.accessExpiresAt, new Date()),
            ),
          ),
        )
        .limit(1);
      if (!target) throw new Error("New owner must be an active room member");
      if (target.role === "guest" || target.role === "agent_member") {
        throw new Error("Guests and agents cannot own rooms");
      }
      await tx
        .update(schema.roomMemberships)
        .set({ membershipRole: "moderator" })
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, roomId),
            eq(schema.roomMemberships.membershipRole, "owner"),
          ),
        );
      const [owner] = await tx
        .update(schema.roomMemberships)
        .set({ membershipRole: "owner", accessExpiresAt: null })
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, roomId),
            eq(schema.roomMemberships.actorId, parsed.actorId),
          ),
        )
        .returning();
      if (!owner) throw new Error("Ownership transfer failed");
      await this.writeEvent(
        tx,
        subject,
        roomId,
        "room.ownership.transferred",
        parsed.idempotencyKey,
        traceId,
        { newOwnerActorId: parsed.actorId },
      );
      return owner;
    });
  }

  async updateSidebar(
    subject: AuthorisationSubject,
    roomId: string,
    input: unknown,
  ) {
    requireCapability(subject, "rooms.read");
    const parsed = SidebarPreferenceSchema.parse(input);
    const [membership] = await this.db
      .update(schema.roomMemberships)
      .set(parsed)
      .where(
        and(
          eq(schema.roomMemberships.organisationId, subject.organisationId),
          eq(schema.roomMemberships.roomId, roomId),
          eq(schema.roomMemberships.actorId, subject.actorId),
          or(
            isNull(schema.roomMemberships.accessExpiresAt),
            gt(schema.roomMemberships.accessExpiresAt, new Date()),
          ),
        ),
      )
      .returning();
    if (!membership) throw new Error("Room membership required");
    return membership;
  }

  async direct(subject: AuthorisationSubject, input: unknown, traceId: string) {
    requireCapability(subject, "rooms.create");
    const parsed = CreateDirectRoomSchema.parse(input);
    const actorIds = [...new Set([subject.actorId, ...parsed.actorIds])].sort();
    const actors = await this.db
      .select({
        id: schema.actors.id,
        displayName: schema.actors.displayName,
        status: schema.actors.status,
      })
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.organisationId, subject.organisationId),
          inArray(schema.actors.id, actorIds),
        ),
      );
    if (
      actors.length !== actorIds.length ||
      actors.some((actor) => actor.status !== "active")
    ) {
      throw new Error("Direct room actors are unavailable");
    }
    const directFingerprint = fingerprint(actorIds);
    const label = actors
      .filter((actor) => actor.id !== subject.actorId)
      .map((actor) => actor.displayName)
      .sort()
      .join(", ");
    return this.db.transaction(async (tx) => {
      const existing = await tx.query.rooms.findFirst({
        where: and(
          eq(schema.rooms.organisationId, subject.organisationId),
          eq(schema.rooms.directFingerprint, directFingerprint),
        ),
      });
      if (existing) return { room: existing, created: false };
      const id = newId();
      const [inserted] = await tx
        .insert(schema.rooms)
        .values({
          id,
          organisationId: subject.organisationId,
          name: label || "Direct message",
          slug: `dm-${directFingerprint.slice(0, 24)}`,
          displayName: label || "Direct message",
          roomType: "direct",
          visibility: "private",
          topic: "",
          directFingerprint,
          createdByActorId: subject.actorId,
          policies: RoomPoliciesSchema.parse({}),
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        const raced = await tx.query.rooms.findFirst({
          where: and(
            eq(schema.rooms.organisationId, subject.organisationId),
            eq(schema.rooms.directFingerprint, directFingerprint),
          ),
        });
        if (!raced) throw new Error("Direct room conflict");
        return { room: raced, created: false };
      }
      await tx.insert(schema.roomMemberships).values(
        actorIds.map((actorId) => ({
          organisationId: subject.organisationId,
          roomId: id,
          actorId,
          membershipRole: actorId === subject.actorId ? "owner" : "member",
        })),
      );
      await this.writeEvent(
        tx,
        subject,
        id,
        "room.direct.created",
        parsed.idempotencyKey,
        traceId,
        { participantCount: actorIds.length },
      );
      return { room: inserted, created: true };
    });
  }

  async directory(subject: AuthorisationSubject, query = "") {
    requireCapability(subject, "rooms.read");
    const filters = [eq(schema.actors.organisationId, subject.organisationId)];
    if (query.trim()) {
      filters.push(ilike(schema.actors.displayName, `%${query.trim()}%`));
    }
    return this.db
      .select({
        id: schema.actors.id,
        displayName: schema.actors.displayName,
        avatar: schema.actors.avatar,
        actorType: schema.actors.actorType,
        status: schema.actors.status,
        capabilityAssignments: schema.actors.capabilityAssignments,
        jobTitle: schema.users.jobTitle,
        team: schema.users.team,
        presenceState: schema.users.presenceState,
        timezone: schema.users.timezone,
        lastActiveAt: schema.users.lastActiveAt,
      })
      .from(schema.actors)
      .leftJoin(
        schema.users,
        and(
          eq(schema.users.organisationId, schema.actors.organisationId),
          eq(schema.users.email, schema.actors.identityReference),
        ),
      )
      .where(and(...filters))
      .orderBy(
        sql`case when ${schema.actors.status} = 'active' then 0 else 1 end`,
        asc(schema.actors.displayName),
      )
      .limit(200);
  }

  async pendingInvitations(subject: AuthorisationSubject) {
    requireCapability(subject, "rooms.read");
    return this.db
      .select({
        id: schema.roomInvitations.id,
        roomId: schema.roomInvitations.roomId,
        roomName: schema.rooms.displayName,
        membershipRole: schema.roomInvitations.membershipRole,
        accessExpiresAt: schema.roomInvitations.accessExpiresAt,
        invitedByActorId: schema.roomInvitations.invitedByActorId,
        createdAt: schema.roomInvitations.createdAt,
      })
      .from(schema.roomInvitations)
      .innerJoin(
        schema.rooms,
        and(
          eq(schema.rooms.organisationId, subject.organisationId),
          eq(schema.rooms.id, schema.roomInvitations.roomId),
        ),
      )
      .where(
        and(
          eq(schema.roomInvitations.organisationId, subject.organisationId),
          eq(schema.roomInvitations.invitedActorId, subject.actorId),
          eq(schema.roomInvitations.status, "pending"),
          or(
            isNull(schema.roomInvitations.accessExpiresAt),
            gt(schema.roomInvitations.accessExpiresAt, new Date()),
          ),
        ),
      )
      .orderBy(desc(schema.roomInvitations.createdAt));
  }

  async administration(subject: AuthorisationSubject) {
    requireCapability(subject, "administration.manage");
    const [rooms, actors, invitations, memberships, audit] = await Promise.all([
      this.list(subject, { includeArchived: true }),
      this.directory(subject),
      this.db
        .select({
          id: schema.roomInvitations.id,
          roomId: schema.roomInvitations.roomId,
          roomName: schema.rooms.displayName,
          actorId: schema.roomInvitations.invitedActorId,
          actorName: schema.actors.displayName,
          role: schema.roomInvitations.membershipRole,
          status: schema.roomInvitations.status,
          accessExpiresAt: schema.roomInvitations.accessExpiresAt,
          createdAt: schema.roomInvitations.createdAt,
        })
        .from(schema.roomInvitations)
        .innerJoin(
          schema.rooms,
          and(
            eq(schema.rooms.organisationId, subject.organisationId),
            eq(schema.rooms.id, schema.roomInvitations.roomId),
          ),
        )
        .innerJoin(
          schema.actors,
          and(
            eq(schema.actors.organisationId, subject.organisationId),
            eq(schema.actors.id, schema.roomInvitations.invitedActorId),
          ),
        )
        .where(
          eq(schema.roomInvitations.organisationId, subject.organisationId),
        )
        .orderBy(desc(schema.roomInvitations.createdAt))
        .limit(500),
      this.db
        .select({
          roomId: schema.roomMemberships.roomId,
          actorId: schema.roomMemberships.actorId,
          actorName: schema.actors.displayName,
          actorType: schema.actors.actorType,
          role: schema.roomMemberships.membershipRole,
          accessExpiresAt: schema.roomMemberships.accessExpiresAt,
        })
        .from(schema.roomMemberships)
        .innerJoin(
          schema.actors,
          and(
            eq(
              schema.actors.organisationId,
              schema.roomMemberships.organisationId,
            ),
            eq(schema.actors.id, schema.roomMemberships.actorId),
          ),
        )
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            inArray(schema.roomMemberships.membershipRole, [
              "owner",
              "guest",
              "agent_member",
            ]),
          ),
        ),
      this.db
        .select({
          id: schema.auditEvents.id,
          action: schema.auditEvents.action,
          targetId: schema.auditEvents.targetId,
          actorId: schema.auditEvents.actorId,
          createdAt: schema.auditEvents.createdAt,
        })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.organisationId, subject.organisationId),
            eq(schema.auditEvents.targetType, "room"),
          ),
        )
        .orderBy(desc(schema.auditEvents.createdAt))
        .limit(500),
    ]);
    return {
      rooms,
      actors,
      invitations,
      owners: memberships.filter((membership) => membership.role === "owner"),
      guests: memberships.filter((membership) => membership.role === "guest"),
      agents: memberships.filter(
        (membership) => membership.role === "agent_member",
      ),
      audit,
    };
  }

  async details(subject: AuthorisationSubject, roomId: string) {
    const room = await this.get(subject, roomId);
    if (!room.membershipRole && !hasCapability(subject, "rooms.manage")) {
      throw new Error("Room membership required");
    }
    const [
      members,
      invitations,
      pinned,
      files,
      workflows,
      integrations,
      audit,
    ] = await Promise.all([
      this.db
        .select({
          actorId: schema.actors.id,
          displayName: schema.actors.displayName,
          actorType: schema.actors.actorType,
          status: schema.actors.status,
          role: schema.roomMemberships.membershipRole,
          joinedAt: schema.roomMemberships.joinedAt,
          accessExpiresAt: schema.roomMemberships.accessExpiresAt,
        })
        .from(schema.roomMemberships)
        .innerJoin(
          schema.actors,
          and(
            eq(
              schema.actors.organisationId,
              schema.roomMemberships.organisationId,
            ),
            eq(schema.actors.id, schema.roomMemberships.actorId),
          ),
        )
        .where(
          and(
            eq(schema.roomMemberships.organisationId, subject.organisationId),
            eq(schema.roomMemberships.roomId, roomId),
          ),
        )
        .orderBy(asc(schema.roomMemberships.joinedAt)),
      this.db
        .select()
        .from(schema.roomInvitations)
        .where(
          and(
            eq(schema.roomInvitations.organisationId, subject.organisationId),
            eq(schema.roomInvitations.roomId, roomId),
          ),
        )
        .orderBy(desc(schema.roomInvitations.createdAt))
        .limit(100),
      this.db
        .select({
          id: schema.messages.id,
          plainText: schema.messages.plainText,
          createdAt: schema.messages.createdAt,
          authorActorId: schema.messages.authorActorId,
        })
        .from(schema.messagePins)
        .innerJoin(
          schema.messages,
          and(
            eq(schema.messages.organisationId, subject.organisationId),
            eq(schema.messages.id, schema.messagePins.messageId),
          ),
        )
        .where(
          and(
            eq(schema.messagePins.organisationId, subject.organisationId),
            eq(schema.messagePins.roomId, roomId),
          ),
        )
        .orderBy(desc(schema.messagePins.createdAt))
        .limit(100),
      this.db
        .select({
          id: schema.evidence.id,
          fileName: schema.evidence.fileName,
          mimeType: schema.evidence.mimeType,
          size: schema.evidence.size,
          classification: schema.evidence.classification,
          scanState: schema.evidence.scanState,
          uploadedAt: schema.evidence.uploadedAt,
        })
        .from(schema.evidence)
        .where(
          and(
            eq(schema.evidence.organisationId, subject.organisationId),
            eq(schema.evidence.relatedRoomId, roomId),
          ),
        )
        .orderBy(desc(schema.evidence.uploadedAt))
        .limit(100),
      this.db
        .select({
          id: schema.workflowRuns.id,
          status: schema.workflowRuns.status,
          workflowDefinitionId: schema.workflowRuns.workflowDefinitionId,
          startedAt: schema.workflowRuns.startedAt,
          completedAt: schema.workflowRuns.completedAt,
        })
        .from(schema.workflowRuns)
        .where(
          and(
            eq(schema.workflowRuns.organisationId, subject.organisationId),
            eq(schema.workflowRuns.roomId, roomId),
          ),
        )
        .limit(100),
      this.db
        .select({
          id: schema.integrationRecords.id,
          product: schema.integrationRecords.product,
          displayName: schema.integrationRecords.displayName,
          status: schema.integrationRecords.status,
        })
        .from(schema.roomIntegrationBindings)
        .innerJoin(
          schema.integrationRecords,
          and(
            eq(
              schema.integrationRecords.organisationId,
              subject.organisationId,
            ),
            eq(
              schema.integrationRecords.id,
              schema.roomIntegrationBindings.integrationId,
            ),
          ),
        )
        .where(
          and(
            eq(
              schema.roomIntegrationBindings.organisationId,
              subject.organisationId,
            ),
            eq(schema.roomIntegrationBindings.roomId, roomId),
          ),
        ),
      this.db
        .select({
          id: schema.auditEvents.id,
          action: schema.auditEvents.action,
          actorId: schema.auditEvents.actorId,
          metadata: schema.auditEvents.metadata,
          createdAt: schema.auditEvents.createdAt,
        })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.organisationId, subject.organisationId),
            eq(schema.auditEvents.targetType, "room"),
            eq(schema.auditEvents.targetId, roomId),
          ),
        )
        .orderBy(desc(schema.auditEvents.createdAt))
        .limit(100),
    ]);
    return {
      room,
      members,
      agents: members.filter((member) => member.actorType === "agent"),
      invitations,
      pinned,
      files,
      workflows,
      integrations,
      audit,
    };
  }

  async export(subject: AuthorisationSubject, roomId: string) {
    const details = await this.details(subject, roomId);
    if (!hasCapability(subject, "rooms.manage")) {
      const policy = RoomPoliciesSchema.parse(
        (
          await this.db.query.rooms.findFirst({
            where: and(
              eq(schema.rooms.organisationId, subject.organisationId),
              eq(schema.rooms.id, roomId),
            ),
          })
        )?.policies ?? {},
      );
      if (!policy.exportAllowed) throw new Error("Room export is disabled");
    }
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      room: {
        externalId: details.room.id,
        name: details.room.slug,
        displayName: details.room.displayName,
        description: details.room.description,
        topic: details.room.topic,
        roomType: details.room.roomType,
        visibility: details.room.visibility,
      },
      members: details.members.map((member) => ({
        actorId: member.actorId,
        role: member.role,
      })),
    };
  }

  async import(subject: AuthorisationSubject, input: unknown, traceId: string) {
    requireCapability(subject, "rooms.manage");
    const parsed = ImportRoomSchema.parse(input);
    const actorIds = [...new Set([subject.actorId, ...parsed.memberActorIds])];
    const actors = await this.db
      .select({ id: schema.actors.id })
      .from(schema.actors)
      .where(
        and(
          eq(schema.actors.organisationId, subject.organisationId),
          inArray(schema.actors.id, actorIds),
        ),
      );
    if (actors.length !== actorIds.length) {
      throw new Error("Imported members must belong to the organisation");
    }
    const importFingerprint = createHash("sha256")
      .update(`${parsed.source}:${parsed.externalId}`)
      .digest("hex");
    const slug = `${slugPart(parsed.name)}-${importFingerprint.slice(0, 8)}`;
    return this.db.transaction(async (tx) => {
      const existing = await tx.query.rooms.findFirst({
        where: and(
          eq(schema.rooms.organisationId, subject.organisationId),
          eq(schema.rooms.slug, slug),
        ),
      });
      if (existing) return { room: existing, created: false };
      const id = newId();
      const [room] = await tx
        .insert(schema.rooms)
        .values({
          id,
          organisationId: subject.organisationId,
          name: parsed.name,
          slug,
          displayName: parsed.displayName,
          description: parsed.description,
          topic: parsed.topic,
          roomType: parsed.roomType,
          visibility: parsed.visibility,
          createdByActorId: subject.actorId,
          policies: RoomPoliciesSchema.parse({}),
        })
        .returning();
      if (!room) throw new Error("Room import failed");
      await tx.insert(schema.roomMemberships).values(
        actorIds.map((actorId) => ({
          organisationId: subject.organisationId,
          roomId: id,
          actorId,
          membershipRole: actorId === subject.actorId ? "owner" : "member",
        })),
      );
      await this.writeEvent(
        tx,
        subject,
        id,
        "room.imported",
        parsed.idempotencyKey,
        traceId,
        { source: parsed.source, externalId: parsed.externalId },
      );
      return { room, created: true };
    });
  }
}
