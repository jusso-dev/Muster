import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { capabilities, type AuthorisationSubject } from "@muster/authz";
import {
  closeDatabase,
  database,
  newId,
  schema,
  TenantRepository,
} from "@muster/database";
import { RoomGovernanceService, RoomService } from "./index.ts";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("enterprise room governance", () => {
  const organisationId = newId();
  const otherOrganisationId = newId();
  const ownerActorId = newId();
  const memberActorId = newId();
  const nonMemberActorId = newId();
  const guestActorId = newId();
  const agentActorId = newId();
  const crossTenantActorId = newId();
  const governance = new RoomGovernanceService();
  const messaging = new RoomService();
  const owner: AuthorisationSubject = {
    organisationId,
    actorId: ownerActorId,
    capabilities: new Set(capabilities),
  };
  const member: AuthorisationSubject = {
    organisationId,
    actorId: memberActorId,
    capabilities: new Set(["rooms.read", "rooms.create", "messages.create"]),
  };
  const nonMember: AuthorisationSubject = {
    organisationId,
    actorId: nonMemberActorId,
    capabilities: new Set(["rooms.read", "rooms.create", "messages.create"]),
  };
  let privateRoomId: string;
  let publicRoomId: string;

  beforeAll(async () => {
    await database()
      .insert(schema.organisations)
      .values([
        {
          id: organisationId,
          name: "Synthetic Governance Organisation",
          slug: `synthetic-governance-${organisationId}`,
        },
        {
          id: otherOrganisationId,
          name: "Synthetic Governance Other",
          slug: `synthetic-governance-other-${otherOrganisationId}`,
        },
      ]);
    await database()
      .insert(schema.actors)
      .values([
        {
          id: ownerActorId,
          organisationId,
          actorType: "human",
          displayName: "Synthetic Owner",
          identityReference: `owner-${ownerActorId}@example.invalid`,
          capabilityAssignments: [...capabilities],
        },
        {
          id: memberActorId,
          organisationId,
          actorType: "human",
          displayName: "Synthetic Member",
          identityReference: `member-${memberActorId}@example.invalid`,
          capabilityAssignments: [
            "rooms.read",
            "rooms.create",
            "messages.create",
          ],
        },
        {
          id: nonMemberActorId,
          organisationId,
          actorType: "human",
          displayName: "Synthetic Non Member",
          capabilityAssignments: [
            "rooms.read",
            "rooms.create",
            "messages.create",
          ],
        },
        {
          id: guestActorId,
          organisationId,
          actorType: "human",
          displayName: "Synthetic Guest",
          capabilityAssignments: ["rooms.read"],
        },
        {
          id: agentActorId,
          organisationId,
          actorType: "agent",
          displayName: "Synthetic Agent",
          capabilityAssignments: ["rooms.read"],
        },
        {
          id: crossTenantActorId,
          organisationId: otherOrganisationId,
          actorType: "human",
          displayName: "Synthetic Cross Tenant",
          capabilityAssignments: [...capabilities],
        },
      ]);
    const privateRoom = await messaging.create(
      owner,
      {
        name: "synthetic-private",
        slug: `synthetic-private-${newId()}`,
        displayName: "Synthetic Private",
        roomType: "private",
        visibility: "private",
        policies: {
          guestInvites: true,
          agentInvites: true,
          memberInvites: false,
          broadMentions: false,
          retentionDays: 90,
          exportAllowed: true,
          archiveAfterDays: null,
        },
      },
      `trace-${newId()}`,
    );
    privateRoomId = privateRoom!.id;
    const publicRoom = await messaging.create(
      owner,
      {
        name: "synthetic-public",
        slug: `synthetic-public-${newId()}`,
        displayName: "Synthetic Public",
        roomType: "operations",
        visibility: "organisation",
      },
      `trace-${newId()}`,
    );
    publicRoomId = publicRoom!.id;
    await database().insert(schema.roomMemberships).values({
      organisationId,
      roomId: privateRoomId,
      actorId: memberActorId,
      membershipRole: "member",
    });
  });

  afterAll(closeDatabase);

  it("enforces private discovery and search for every tenant actor", async () => {
    const privateRooms = await governance.list(nonMember, {
      includeArchived: true,
    });
    expect(privateRooms.some((room) => room.id === privateRoomId)).toBe(false);
    const joinedRooms = await governance.list(member, {
      includeArchived: true,
    });
    expect(joinedRooms.some((room) => room.id === privateRoomId)).toBe(true);

    await messaging.postMessage(
      owner,
      {
        roomId: privateRoomId,
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Synthetic quokka secret" }],
            },
          ],
        },
        plainText: "Synthetic quokka secret",
        dataClassification: "confidential",
        idempotencyKey: `private-search-${newId()}`,
      },
      `trace-${newId()}`,
    );
    const repository = new TenantRepository(database(), organisationId);
    expect(await repository.search("quokka", nonMemberActorId)).toEqual([]);
    expect(await repository.search("quokka", memberActorId)).toEqual([
      expect.objectContaining({ roomId: privateRoomId, type: "message" }),
    ]);
  });

  it("combines parameterised search filters without weakening tenant visibility", async () => {
    const repository = new TenantRepository(database(), organisationId);
    const duplicateActorIds = [newId(), newId()];
    await database()
      .insert(schema.actors)
      .values(
        duplicateActorIds.map((id) => ({
          id,
          organisationId,
          actorType: "human" as const,
          displayName: "Synthetic Duplicate",
          capabilityAssignments: ["rooms.read"],
        })),
      );
    await database()
      .insert(schema.roomMemberships)
      .values(
        duplicateActorIds.map((actorId) => ({
          organisationId,
          roomId: privateRoomId,
          actorId,
          membershipRole: "member",
        })),
      );

    const searchableMessageId = newId();
    await database()
      .insert(schema.messages)
      .values([
        {
          id: searchableMessageId,
          organisationId,
          roomId: privateRoomId,
          authorActorId: memberActorId,
          messageType: "text",
          document: { type: "doc", content: [] },
          plainText: "Synthetic searchfiltercanary inside window",
          createdAt: new Date("2026-07-15T12:00:00.000Z"),
        },
        {
          id: newId(),
          organisationId,
          roomId: privateRoomId,
          authorActorId: memberActorId,
          messageType: "text",
          document: { type: "doc", content: [] },
          plainText: "Synthetic searchfiltercanary before window",
          createdAt: new Date("2026-06-30T23:59:59.000Z"),
        },
        {
          id: newId(),
          organisationId,
          roomId: privateRoomId,
          authorActorId: ownerActorId,
          messageType: "text",
          document: { type: "doc", content: [] },
          plainText: "Synthetic searchfiltercanary different author",
          createdAt: new Date("2026-07-15T12:00:00.000Z"),
        },
      ]);

    const resolved = await repository.resolveSearchFilters(memberActorId, {
      from: "Synthetic Member",
      in: "Synthetic Private",
      after: new Date("2026-07-01T00:00:00.000Z"),
      before: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(
      await repository.search(
        "searchfiltercanary",
        memberActorId,
        resolved.filters,
      ),
    ).toEqual([
      expect.objectContaining({
        id: searchableMessageId,
        actorName: "Synthetic Member",
        roomId: privateRoomId,
        roomName: "Synthetic Private",
        type: "message",
      }),
    ]);
    expect(
      await repository.search("", memberActorId, resolved.filters),
    ).toEqual([expect.objectContaining({ id: searchableMessageId })]);
    expect(
      await repository.search("searchfiltercanary", memberActorId, {
        fromActorId: memberActorId,
      }),
    ).toHaveLength(2);
    expect(
      await repository.search("searchfiltercanary", memberActorId, {
        roomId: privateRoomId,
      }),
    ).toHaveLength(3);
    expect(
      await repository.search("searchfiltercanary", memberActorId, {
        after: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ).toHaveLength(2);
    expect(
      await repository.search("searchfiltercanary", memberActorId, {
        before: new Date("2026-07-01T00:00:00.000Z"),
      }),
    ).toHaveLength(1);

    await expect(
      repository.resolveSearchFilters(nonMemberActorId, {
        in: "Synthetic Private",
      }),
    ).rejects.toMatchObject({ filter: "in", reason: "unknown" });
    await expect(
      repository.resolveSearchFilters(memberActorId, {
        from: "Synthetic Cross Tenant",
      }),
    ).rejects.toMatchObject({ filter: "from", reason: "unknown" });
    await expect(
      repository.resolveSearchFilters(memberActorId, {
        from: "Synthetic Duplicate",
      }),
    ).rejects.toMatchObject({ filter: "from", reason: "ambiguous" });
    await expect(
      repository.resolveSearchFilters(memberActorId, { in: "%" }),
    ).rejects.toMatchObject({ filter: "in", reason: "unknown" });

    expect(
      await repository.search(
        "literalinjectionmarker'; DROP TABLE messages; --",
        memberActorId,
      ),
    ).toEqual([]);
    expect(
      await repository.search("searchfiltercanary", nonMemberActorId),
    ).toEqual([]);
    expect(
      await repository.search("searchfiltercanary", memberActorId),
    ).toHaveLength(3);
  });

  it("does not leak findings through inaccessible investigation rooms", async () => {
    const investigationId = newId();
    await database()
      .insert(schema.investigations)
      .values({
        id: investigationId,
        organisationId,
        investigationNumber: `SYN-${newId()}`,
        title: "Synthetic private investigation",
        summary: "Synthetic finding visibility test",
        status: "open",
        severity: "medium",
        roomId: privateRoomId,
      });
    await database().insert(schema.findings).values({
      id: newId(),
      organisationId,
      investigationId,
      createdByActorId: memberActorId,
      title: "Synthetic findingleakcheck",
      summary: "Synthetic private finding",
      confidence: 80,
      severity: "medium",
    });
    const repository = new TenantRepository(database(), organisationId);
    expect(
      await repository.search("findingleakcheck", nonMemberActorId),
    ).toEqual([]);
    expect(await repository.search("findingleakcheck", memberActorId)).toEqual([
      expect.objectContaining({
        roomId: privateRoomId,
        type: "finding",
      }),
    ]);
  });

  it("joins and leaves discoverable rooms while protecting owners", async () => {
    await governance.lifecycle(
      nonMember,
      publicRoomId,
      { action: "join", idempotencyKey: `join-${newId()}` },
      `trace-${newId()}`,
    );
    expect((await governance.get(nonMember, publicRoomId)).membershipRole).toBe(
      "member",
    );
    await governance.lifecycle(
      nonMember,
      publicRoomId,
      { action: "leave", idempotencyKey: `leave-${newId()}` },
      `trace-${newId()}`,
    );
    await expect(
      governance.lifecycle(
        owner,
        privateRoomId,
        { action: "leave", idempotencyKey: `owner-leave-${newId()}` },
        `trace-${newId()}`,
      ),
    ).rejects.toThrow("Transfer ownership before leaving");
  });

  it("supports bulk guest and agent invitations, acceptance, expiry, and revocation", async () => {
    const [guestInvitation] = await governance.invite(
      owner,
      privateRoomId,
      {
        actorIds: [guestActorId],
        membershipRole: "guest",
        accessExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        idempotencyKey: `guest-invite-${newId()}`,
      },
      `trace-${newId()}`,
    );
    const guest: AuthorisationSubject = {
      organisationId,
      actorId: guestActorId,
      capabilities: new Set(["rooms.read"]),
    };
    await governance.respondInvitation(
      guest,
      guestInvitation!.id,
      { action: "accept", idempotencyKey: `guest-accept-${newId()}` },
      `trace-${newId()}`,
    );
    expect((await governance.get(guest, privateRoomId)).membershipRole).toBe(
      "guest",
    );

    const [agentInvitation] = await governance.invite(
      owner,
      privateRoomId,
      {
        actorIds: [agentActorId],
        membershipRole: "agent_member",
        accessExpiresAt: null,
        idempotencyKey: `agent-invite-${newId()}`,
      },
      `trace-${newId()}`,
    );
    await governance.respondInvitation(
      owner,
      agentInvitation!.id,
      { action: "revoke", idempotencyKey: `agent-revoke-${newId()}` },
      `trace-${newId()}`,
    );
    await database()
      .update(schema.roomMemberships)
      .set({ accessExpiresAt: new Date(Date.now() - 1_000) })
      .where(
        and(
          eq(schema.roomMemberships.organisationId, organisationId),
          eq(schema.roomMemberships.roomId, privateRoomId),
          eq(schema.roomMemberships.actorId, guestActorId),
        ),
      );
    await expect(messaging.assertMember(guest, privateRoomId)).rejects.toThrow(
      "Room membership required",
    );
  });

  it("transfers ownership atomically and never leaves a room orphaned", async () => {
    const result = await governance.transferOwnership(
      owner,
      privateRoomId,
      {
        actorId: memberActorId,
        idempotencyKey: `ownership-${newId()}`,
      },
      `trace-${newId()}`,
    );
    expect(result.membershipRole).toBe("owner");
    const [owners] = await database()
      .select({ value: count() })
      .from(schema.roomMemberships)
      .where(
        and(
          eq(schema.roomMemberships.organisationId, organisationId),
          eq(schema.roomMemberships.roomId, privateRoomId),
          eq(schema.roomMemberships.membershipRole, "owner"),
        ),
      );
    expect(owners?.value).toBe(1);
  });

  it("deduplicates participant sets and keeps direct rooms private", async () => {
    const first = await governance.direct(
      owner,
      {
        actorIds: [memberActorId, nonMemberActorId],
        idempotencyKey: `direct-first-${newId()}`,
      },
      `trace-${newId()}`,
    );
    const second = await governance.direct(
      member,
      {
        actorIds: [nonMemberActorId, ownerActorId],
        idempotencyKey: `direct-second-${newId()}`,
      },
      `trace-${newId()}`,
    );
    expect(second.room.id).toBe(first.room.id);
    expect(second.created).toBe(false);
    const crossTenant: AuthorisationSubject = {
      organisationId: otherOrganisationId,
      actorId: crossTenantActorId,
      capabilities: new Set(capabilities),
    };
    await expect(
      governance.direct(
        owner,
        {
          actorIds: [crossTenantActorId],
          idempotencyKey: `direct-cross-${newId()}`,
        },
        `trace-${newId()}`,
      ),
    ).rejects.toThrow("Direct room actors are unavailable");
    expect(
      (await governance.list(crossTenant, { includeArchived: true })).some(
        (room) => room.id === first.room.id,
      ),
    ).toBe(false);
  });

  it("persists sidebar state and returns all governed detail tabs", async () => {
    await governance.updateSidebar(member, privateRoomId, {
      favourite: true,
      muted: true,
      sidebarPosition: 7,
      sidebarGroup: "Synthetic response",
    });
    expect(await governance.get(member, privateRoomId)).toMatchObject({
      favourite: true,
      muted: true,
      sidebarPosition: 7,
      sidebarGroup: "Synthetic response",
    });
    const details = await governance.details(member, privateRoomId);
    expect(details).toEqual(
      expect.objectContaining({
        members: expect.any(Array),
        agents: expect.any(Array),
        invitations: expect.any(Array),
        pinned: expect.any(Array),
        files: expect.any(Array),
        workflows: expect.any(Array),
        integrations: expect.any(Array),
        audit: expect.any(Array),
      }),
    );
  });

  it("renames, retopics, archives, restores, and audits state atomically", async () => {
    const updated = await governance.update(
      owner,
      privateRoomId,
      {
        displayName: "Synthetic Renamed Private",
        topic: "Synthetic governed topic",
        idempotencyKey: `room-update-${newId()}`,
      },
      `trace-${newId()}`,
    );
    expect(updated).toMatchObject({
      displayName: "Synthetic Renamed Private",
      topic: "Synthetic governed topic",
    });
    await governance.lifecycle(
      owner,
      privateRoomId,
      { action: "archive", idempotencyKey: `archive-${newId()}` },
      `trace-${newId()}`,
    );
    await expect(
      messaging.postMessage(
        member,
        {
          roomId: privateRoomId,
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Archived write" }],
              },
            ],
          },
          plainText: "Archived write",
          dataClassification: "internal",
          idempotencyKey: `archived-write-${newId()}`,
        },
        `trace-${newId()}`,
      ),
    ).rejects.toThrow("Archived rooms are read-only");
    await governance.lifecycle(
      owner,
      privateRoomId,
      { action: "restore", idempotencyKey: `restore-${newId()}` },
      `trace-${newId()}`,
    );
    const [auditTotal, outboxTotal] = await Promise.all([
      database()
        .select({ value: count() })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.organisationId, organisationId),
            eq(schema.auditEvents.targetType, "room"),
            eq(schema.auditEvents.targetId, privateRoomId),
          ),
        ),
      database()
        .select({ value: count() })
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.organisationId, organisationId),
            eq(schema.outboxEvents.aggregateType, "room"),
            eq(schema.outboxEvents.aggregateId, privateRoomId),
          ),
        ),
    ]);
    expect(auditTotal[0]!.value).toBeGreaterThanOrEqual(3);
    expect(outboxTotal[0]!.value).toBeGreaterThanOrEqual(3);
  });

  it("enforces organisation creation policy and import idempotency", async () => {
    await database()
      .update(schema.organisations)
      .set({
        authenticationPolicy: {
          roomGovernance: {
            createOrganisationRooms: "administrators",
            createPrivateRooms: "administrators",
            inviteGuests: "room_policy",
            inviteAgents: "room_policy",
          },
        },
      })
      .where(eq(schema.organisations.id, organisationId));
    await expect(
      messaging.create(
        nonMember,
        {
          name: "policy denied",
          slug: `policy-denied-${newId()}`,
          displayName: "Policy denied",
          roomType: "operations",
          visibility: "organisation",
        },
        `trace-${newId()}`,
      ),
    ).rejects.toThrow("Organisation room creation policy denied");
    const input = {
      source: "slack" as const,
      externalId: `C-${newId()}`,
      name: "synthetic-import",
      displayName: "Synthetic imported room",
      roomType: "operations" as const,
      visibility: "private" as const,
      memberActorIds: [memberActorId],
      idempotencyKey: `import-${newId()}`,
    };
    const first = await governance.import(owner, input, `trace-${newId()}`);
    const second = await governance.import(owner, input, `trace-${newId()}`);
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false });
    expect(second.room.id).toBe(first.room.id);
  });

  it("does not resolve private room mentions for non-members", async () => {
    await governance.lifecycle(
      nonMember,
      publicRoomId,
      { action: "join", idempotencyKey: `mention-join-${newId()}` },
      `trace-${newId()}`,
    );
    const privateRoom = await database().query.rooms.findFirst({
      where: and(
        eq(schema.rooms.organisationId, organisationId),
        eq(schema.rooms.id, privateRoomId),
      ),
    });
    const posted = await messaging.postMessage(
      nonMember,
      {
        roomId: publicRoomId,
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Synthetic private guess" }],
            },
          ],
        },
        plainText: `Synthetic private guess #${privateRoom!.slug}`,
        dataClassification: "internal",
        idempotencyKey: `private-mention-${newId()}`,
      },
      `trace-${newId()}`,
    );
    const mentions = await database()
      .select()
      .from(schema.messageMentions)
      .where(
        and(
          eq(schema.messageMentions.organisationId, organisationId),
          eq(schema.messageMentions.messageId, posted.message.id),
        ),
      );
    expect(mentions).toEqual([]);
  });
});
