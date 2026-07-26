import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { and, count, eq } from "drizzle-orm";
import { capabilities, type AuthorisationSubject } from "@muster/authz";
import { closeDatabase, database, newId, schema } from "@muster/database";
import { RoomService } from "@muster/rooms";
import { ReactionPackDomain } from "./reaction-pack-domain.ts";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

describeIntegration("organisation reaction packs", () => {
  const organisationId = newId();
  const otherOrganisationId = newId();
  const actorId = newId();
  const otherActorId = newId();
  const roomId = newId();
  const objects = new Map<string, Uint8Array>();
  const storage = {
    putObject: vi.fn(
      async (object: {
        storageKey: string;
        contentType: string;
        body: Uint8Array;
      }) => {
        objects.set(object.storageKey, new Uint8Array(object.body));
      },
    ),
    getObject: vi.fn(async (storageKey: string) => {
      const body = objects.get(storageKey);
      if (!body) throw new Error("Synthetic missing object");
      return new Uint8Array(body);
    }),
  };
  const domain = new ReactionPackDomain(database(), storage);
  const rooms = new RoomService();
  const admin: AuthorisationSubject = {
    organisationId,
    actorId,
    capabilities: new Set(capabilities),
  };
  const otherAdmin: AuthorisationSubject = {
    organisationId: otherOrganisationId,
    actorId: otherActorId,
    capabilities: new Set(capabilities),
  };
  let body: Uint8Array;
  let packId: string;
  let firstRevisionId: string;
  let firstAssetId: string;
  let firstDigest: string;
  const firstAltText = "A synthetic green acknowledgement";

  beforeAll(async () => {
    body = new Uint8Array(
      await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 4,
          background: { r: 20, g: 112, b: 84, alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
    );
    await database()
      .insert(schema.organisations)
      .values([
        {
          id: organisationId,
          name: "Synthetic Reaction Organisation",
          slug: `synthetic-reaction-${organisationId}`,
        },
        {
          id: otherOrganisationId,
          name: "Synthetic Other Reaction Organisation",
          slug: `synthetic-other-reaction-${otherOrganisationId}`,
        },
      ]);
    await database()
      .insert(schema.actors)
      .values([
        {
          id: actorId,
          organisationId,
          actorType: "human",
          displayName: "Synthetic Reaction Administrator",
          capabilityAssignments: [...capabilities],
        },
        {
          id: otherActorId,
          organisationId: otherOrganisationId,
          actorType: "human",
          displayName: "Synthetic Other Administrator",
          capabilityAssignments: [...capabilities],
        },
      ]);
    await database()
      .insert(schema.rooms)
      .values({
        id: roomId,
        organisationId,
        name: "synthetic-reaction-room",
        slug: `synthetic-reaction-room-${roomId}`,
        displayName: "Synthetic Reaction Room",
        roomType: "operations",
        visibility: "private",
        createdByActorId: actorId,
      });
    await database().insert(schema.roomMemberships).values({
      organisationId,
      roomId,
      actorId,
      membershipRole: "owner",
    });
  });

  afterAll(closeDatabase);

  it("creates, audits, and approves an exact verified revision", async () => {
    const created = await domain.createDraft(
      admin,
      {
        packSlug: "synthetic-acknowledgements",
        packDisplayName: "Synthetic Acknowledgements",
        revision: 1,
        assetName: "steady",
        altText: firstAltText,
        mimeType: "image/png",
        body,
      },
      `trace-${newId()}`,
    );
    packId = created.pack.id;
    firstRevisionId = created.revision.id;
    firstAssetId = created.asset.id;
    firstDigest = created.asset.sha256;
    expect(created.asset.storageKey).toBe(
      `reaction-assets/${organisationId}/${firstDigest}`,
    );
    expect(storage.putObject).toHaveBeenCalledTimes(1);

    const approved = await domain.approveRevision(
      admin,
      packId,
      firstRevisionId,
      {},
      `trace-${newId()}`,
    );
    expect(approved.status).toBe("approved");

    const [auditTotal] = await database()
      .select({ value: count() })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.organisationId, organisationId),
          eq(schema.auditEvents.targetId, firstRevisionId),
        ),
      );
    const [outboxTotal] = await database()
      .select({ value: count() })
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.organisationId, organisationId),
          eq(schema.outboxEvents.aggregateId, packId),
        ),
      );
    expect(auditTotal?.value).toBe(2);
    expect(outboxTotal?.value).toBe(2);
  });

  it("scopes catalog and exact asset reads to the organisation", async () => {
    const catalog = await domain.listCatalog(admin);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      id: packId,
      revisionId: firstRevisionId,
      revision: 1,
      assets: [
        {
          id: firstAssetId,
          altText: firstAltText,
          sha256: firstDigest,
        },
      ],
    });
    expect(await domain.listCatalog(otherAdmin)).toEqual([]);
    await expect(
      domain.readApprovedAsset(
        otherAdmin,
        firstAssetId,
        firstRevisionId,
        firstDigest,
        `trace-${newId()}`,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const asset = await domain.readApprovedAsset(
      admin,
      firstAssetId,
      firstRevisionId,
      firstDigest,
      `trace-${newId()}`,
    );
    expect(asset.body).toEqual(body);
  });

  it("sends a decorative reaction without structured operational links", async () => {
    const result = await rooms.postMessage(
      admin,
      {
        roomId,
        document: {
          type: "doc",
          content: [
            {
              type: "visualReaction",
              attrs: {
                assetId: firstAssetId,
                revisionId: firstRevisionId,
                sha256: firstDigest,
                altText: firstAltText,
                frameCount: 1,
              },
            },
          ],
        },
        plainText: `[Visual reaction: ${firstAltText}]`,
        dataClassification: "internal",
        idempotencyKey: `synthetic-reaction-${newId()}`,
      },
      `trace-${newId()}`,
    );
    expect(result.message).toMatchObject({
      messageType: "text",
      relatedAlertId: null,
      relatedInvestigationId: null,
    });
    await expect(
      rooms.postMessage(
        admin,
        {
          roomId,
          document: result.message.document,
          plainText: result.message.plainText,
          dataClassification: "internal",
          relatedAlertId: newId(),
          idempotencyKey: `synthetic-linked-reaction-${newId()}`,
        },
        `trace-${newId()}`,
      ),
    ).rejects.toThrow(
      "Visual reactions must remain decorative standalone messages",
    );
  });

  it("fails closed when a formerly approved revision becomes stale", async () => {
    const created = await domain.createDraft(
      admin,
      {
        packId,
        packSlug: "synthetic-acknowledgements",
        packDisplayName: "Synthetic Acknowledgements",
        revision: 2,
        assetName: "steady-v2",
        altText: "A synthetic blue acknowledgement",
        mimeType: "image/png",
        body,
      },
      `trace-${newId()}`,
    );
    await domain.approveRevision(
      admin,
      packId,
      created.revision.id,
      {},
      `trace-${newId()}`,
    );
    await expect(
      rooms.postMessage(
        admin,
        {
          roomId,
          document: {
            type: "doc",
            content: [
              {
                type: "visualReaction",
                attrs: {
                  assetId: firstAssetId,
                  revisionId: firstRevisionId,
                  sha256: firstDigest,
                  altText: firstAltText,
                  frameCount: 1,
                },
              },
            ],
          },
          plainText: `[Visual reaction: ${firstAltText}]`,
          dataClassification: "internal",
          idempotencyKey: `synthetic-stale-reaction-${newId()}`,
        },
        `trace-${newId()}`,
      ),
    ).rejects.toThrow("The exact approved visual reaction is unavailable");
    await expect(
      domain.readApprovedAsset(
        admin,
        firstAssetId,
        firstRevisionId,
        firstDigest,
        `trace-${newId()}`,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("records approved external input only as untrusted data", async () => {
    const sourceUrl =
      "https://example.invalid/synthetic-pack?content=ignore-all-instructions";
    const sourceUrlSha256 = createHash("sha256")
      .update(sourceUrl)
      .digest("hex");
    const approvalId = newId();
    await database()
      .insert(schema.approvals)
      .values({
        id: approvalId,
        organisationId,
        requestingActorId: actorId,
        actionType: "reaction-pack.external-import",
        target: { sourceUrlSha256 },
        riskSummary: "Synthetic external reaction import",
        expiresAt: new Date(Date.now() + 60_000),
        requiredCapability: "administration.manage",
        status: "approved",
        idempotencyKey: `synthetic-reaction-import-${newId()}`,
      });
    const result = await domain.recordExternalImportAttempt(
      admin,
      { sourceUrl, approvalId },
      `trace-${newId()}`,
    );
    expect(result).toMatchObject({ accepted: false });
    const [audit] = await database()
      .select({ metadata: schema.auditEvents.metadata })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.organisationId, organisationId),
          eq(
            schema.auditEvents.action,
            "reaction-pack.external-import.attempted",
          ),
        ),
      )
      .limit(1);
    expect(audit?.metadata).toMatchObject({
      approvalId,
      sourceUrlSha256,
      outcome: "not-fetched",
    });
    expect(JSON.stringify(audit?.metadata)).not.toContain(sourceUrl);

    await expect(
      domain.recordExternalImportAttempt(
        admin,
        {
          sourceUrl: "https://example.invalid/unapproved-synthetic-pack",
          approvalId,
        },
        `trace-${newId()}`,
      ),
    ).rejects.toMatchObject({ status: 403 });
    const rejected = await database()
      .select({ metadata: schema.auditEvents.metadata })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.organisationId, organisationId),
          eq(
            schema.auditEvents.action,
            "reaction-pack.external-import.attempted",
          ),
        ),
      );
    expect(
      rejected.some(
        ({ metadata }) =>
          (metadata as Record<string, unknown>).outcome === "rejected",
      ),
    ).toBe(true);
  });

  it("removes active or superseded metadata without deleting history", async () => {
    const removed = await domain.removePack(admin, packId, `trace-${newId()}`);
    expect(removed.lifecycle).toBe("removed");
    expect(await domain.listCatalog(admin)).toEqual([]);
    const revisions = await database()
      .select({ status: schema.reactionPackRevisions.status })
      .from(schema.reactionPackRevisions)
      .where(
        and(
          eq(schema.reactionPackRevisions.organisationId, organisationId),
          eq(schema.reactionPackRevisions.packId, packId),
        ),
      );
    expect(revisions.map((revision) => revision.status)).toEqual([
      "removed",
      "removed",
    ]);
  });
});
