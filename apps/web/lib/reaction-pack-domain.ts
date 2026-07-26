import { createHash } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import sharp, { type Metadata } from "sharp";
import { z } from "zod";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import { ApiProblem } from "./api-context.ts";
import {
  defaultObjectStorage,
  type ContentObjectStorage,
} from "./object-storage.ts";

export const reactionAssetMaximumBytes = 512 * 1024;
export const reactionAssetMaximumDimension = 512;
export const reactionAssetMaximumFrames = 24;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const assetNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const CreateReactionPackRevisionSchema = z.object({
  packId: z.uuid().optional(),
  packSlug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  packDisplayName: z.string().trim().min(2).max(120),
  revision: z.coerce.number().int().positive(),
  assetName: assetNameSchema,
  altText: z.string().trim().min(2).max(160),
  mimeType: z.string().trim().min(1).max(100),
  expectedSha256: digestSchema.optional(),
});

export const ApproveReactionPackRevisionSchema = z.object({
  approvalId: z.uuid().optional(),
});

export const ExternalReactionPackImportSchema = z.object({
  sourceUrl: z.url().max(2_000),
  approvalId: z.uuid(),
});

type CreateReactionPackRevisionInput = z.input<
  typeof CreateReactionPackRevisionSchema
> & {
  body: Uint8Array;
};

type PackRow = typeof schema.reactionPacks.$inferSelect;
type RevisionRow = typeof schema.reactionPackRevisions.$inferSelect;
type AssetRow = typeof schema.reactionPackAssets.$inferSelect;

const allowedFormats = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

function assetStorageKey(organisationId: string, sha256: string) {
  return `reaction-assets/${organisationId}/${sha256}`;
}

export async function inspectReactionAsset(
  input: CreateReactionPackRevisionInput,
): Promise<{
  parsed: z.output<typeof CreateReactionPackRevisionSchema>;
  sha256: string;
  width: number;
  height: number;
  frameCount: number;
}> {
  const parsed = CreateReactionPackRevisionSchema.parse(input);
  if (input.body.byteLength > reactionAssetMaximumBytes) {
    throw new ApiProblem(
      413,
      "Reaction asset too large",
      `Reaction assets are limited to ${reactionAssetMaximumBytes} bytes.`,
    );
  }
  if (input.body.byteLength === 0) {
    throw new ApiProblem(
      400,
      "Invalid reaction asset",
      "Reaction assets cannot be empty.",
    );
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input.body, {
      animated: true,
      failOn: "warning",
      limitInputPixels:
        reactionAssetMaximumDimension * reactionAssetMaximumDimension,
    }).metadata();
  } catch {
    throw new ApiProblem(
      400,
      "Invalid reaction asset",
      "The uploaded file is not a supported, valid image.",
    );
  }
  const approvedMimeType = metadata.format
    ? allowedFormats.get(metadata.format)
    : undefined;
  if (!approvedMimeType || approvedMimeType !== parsed.mimeType) {
    throw new ApiProblem(
      400,
      "Invalid reaction MIME type",
      "The declared MIME type must match a verified PNG, JPEG, WebP, or GIF asset.",
    );
  }
  const width = metadata.autoOrient?.width ?? metadata.width;
  const aggregateHeight = metadata.autoOrient?.height ?? metadata.height;
  const frameCount = metadata.pages ?? 1;
  const height = metadata.pageHeight ?? aggregateHeight;
  if (
    !width ||
    !height ||
    width > reactionAssetMaximumDimension ||
    height > reactionAssetMaximumDimension
  ) {
    throw new ApiProblem(
      400,
      "Invalid reaction dimensions",
      `Reaction assets must be at most ${reactionAssetMaximumDimension} by ${reactionAssetMaximumDimension} pixels.`,
    );
  }
  if (frameCount > reactionAssetMaximumFrames) {
    throw new ApiProblem(
      400,
      "Too many reaction frames",
      `Animated reaction assets are limited to ${reactionAssetMaximumFrames} frames.`,
    );
  }

  const sha256 = createHash("sha256").update(input.body).digest("hex");
  if (parsed.expectedSha256 && parsed.expectedSha256 !== sha256) {
    throw new ApiProblem(
      409,
      "Reaction digest mismatch",
      "The uploaded asset does not match the expected SHA-256 digest.",
    );
  }
  return { parsed, sha256, width, height, frameCount };
}

function groupCatalog(
  rows: Array<{ pack: PackRow; revision: RevisionRow; asset: AssetRow }>,
) {
  const packs = new Map<
    string,
    {
      id: string;
      slug: string;
      displayName: string;
      revisionId: string;
      revision: number;
      assets: Array<{
        id: string;
        name: string;
        altText: string;
        mimeType: string;
        width: number;
        height: number;
        frameCount: number;
        sha256: string;
        url: string;
      }>;
    }
  >();
  for (const row of rows) {
    const pack = packs.get(row.pack.id) ?? {
      id: row.pack.id,
      slug: row.pack.slug,
      displayName: row.pack.displayName,
      revisionId: row.revision.id,
      revision: row.revision.revision,
      assets: [],
    };
    pack.assets.push({
      id: row.asset.id,
      name: row.asset.name,
      altText: row.asset.altText,
      mimeType: row.asset.mimeType,
      width: row.asset.width,
      height: row.asset.height,
      frameCount: row.asset.frameCount,
      sha256: row.asset.sha256,
      url:
        `/api/v1/reaction-assets/${row.asset.id}` +
        `?revision=${row.revision.id}&digest=${row.asset.sha256}`,
    });
    packs.set(row.pack.id, pack);
  }
  return [...packs.values()];
}

export class ReactionPackDomain {
  constructor(
    private readonly db = database(),
    private readonly storage: ContentObjectStorage = defaultObjectStorage,
  ) {}

  async listCatalog(subject: AuthorisationSubject) {
    requireCapability(subject, "rooms.read");
    const rows = await this.db
      .select({
        pack: schema.reactionPacks,
        revision: schema.reactionPackRevisions,
        asset: schema.reactionPackAssets,
      })
      .from(schema.reactionPacks)
      .innerJoin(
        schema.reactionPackRevisions,
        and(
          eq(
            schema.reactionPackRevisions.organisationId,
            subject.organisationId,
          ),
          eq(schema.reactionPackRevisions.packId, schema.reactionPacks.id),
          eq(schema.reactionPackRevisions.status, "approved"),
        ),
      )
      .innerJoin(
        schema.reactionPackAssets,
        and(
          eq(schema.reactionPackAssets.organisationId, subject.organisationId),
          eq(
            schema.reactionPackAssets.revisionId,
            schema.reactionPackRevisions.id,
          ),
          eq(schema.reactionPackAssets.verificationState, "verified"),
        ),
      )
      .where(
        and(
          eq(schema.reactionPacks.organisationId, subject.organisationId),
          eq(schema.reactionPacks.lifecycle, "active"),
        ),
      )
      .orderBy(
        asc(schema.reactionPacks.displayName),
        asc(schema.reactionPackAssets.name),
      );
    return groupCatalog(rows);
  }

  async listAdministration(subject: AuthorisationSubject) {
    requireCapability(subject, "administration.manage");
    const packs = await this.db
      .select()
      .from(schema.reactionPacks)
      .where(eq(schema.reactionPacks.organisationId, subject.organisationId))
      .orderBy(asc(schema.reactionPacks.displayName));
    const revisions = await this.db
      .select()
      .from(schema.reactionPackRevisions)
      .where(
        eq(schema.reactionPackRevisions.organisationId, subject.organisationId),
      )
      .orderBy(
        asc(schema.reactionPackRevisions.packId),
        asc(schema.reactionPackRevisions.revision),
      );
    const revisionIds = revisions.map((revision) => revision.id);
    const assets =
      revisionIds.length === 0
        ? []
        : await this.db
            .select()
            .from(schema.reactionPackAssets)
            .where(
              and(
                eq(
                  schema.reactionPackAssets.organisationId,
                  subject.organisationId,
                ),
                inArray(schema.reactionPackAssets.revisionId, revisionIds),
              ),
            )
            .orderBy(asc(schema.reactionPackAssets.name));
    return packs.map((pack) => ({
      ...pack,
      revisions: revisions
        .filter((revision) => revision.packId === pack.id)
        .map((revision) => ({
          ...revision,
          assets: assets.filter((asset) => asset.revisionId === revision.id),
        })),
    }));
  }

  async createDraft(
    subject: AuthorisationSubject,
    input: CreateReactionPackRevisionInput,
    traceId: string,
  ) {
    requireCapability(subject, "administration.manage");
    const validated = await inspectReactionAsset(input);
    let existingPack: PackRow | undefined;
    if (validated.parsed.packId) {
      [existingPack] = await this.db
        .select()
        .from(schema.reactionPacks)
        .where(
          and(
            eq(schema.reactionPacks.organisationId, subject.organisationId),
            eq(schema.reactionPacks.id, validated.parsed.packId),
            eq(schema.reactionPacks.lifecycle, "active"),
          ),
        )
        .limit(1);
      if (!existingPack) {
        throw new ApiProblem(
          404,
          "Reaction pack not found",
          "The active reaction pack was not found.",
        );
      }
      if (
        existingPack.slug !== validated.parsed.packSlug ||
        existingPack.displayName !== validated.parsed.packDisplayName
      ) {
        throw new ApiProblem(
          409,
          "Reaction pack mismatch",
          "Existing pack identity cannot be changed by a new revision.",
        );
      }
    }

    const packId = existingPack?.id ?? newId();
    const revisionId = newId();
    const assetId = newId();
    const storageKey = assetStorageKey(
      subject.organisationId,
      validated.sha256,
    );
    await this.storage.putObject({
      storageKey,
      contentType: validated.parsed.mimeType,
      body: input.body,
    });

    return this.db.transaction(async (tx) => {
      let pack = existingPack;
      if (!pack) {
        [pack] = await tx
          .insert(schema.reactionPacks)
          .values({
            id: packId,
            organisationId: subject.organisationId,
            slug: validated.parsed.packSlug,
            displayName: validated.parsed.packDisplayName,
            createdByActorId: subject.actorId,
          })
          .returning();
        if (!pack) throw new Error("Reaction pack creation failed");
        await appendAuditEvent(tx, {
          organisationId: subject.organisationId,
          actorId: subject.actorId,
          actorType: "human",
          action: "reaction-pack.created",
          targetType: "reaction-pack",
          targetId: pack.id,
          metadata: {
            slug: pack.slug,
            displayName: pack.displayName,
          },
          traceId,
        });
      }

      const [revision] = await tx
        .insert(schema.reactionPackRevisions)
        .values({
          id: revisionId,
          organisationId: subject.organisationId,
          packId: pack.id,
          revision: validated.parsed.revision,
          createdByActorId: subject.actorId,
        })
        .returning();
      if (!revision) throw new Error("Reaction pack revision creation failed");
      const [asset] = await tx
        .insert(schema.reactionPackAssets)
        .values({
          id: assetId,
          organisationId: subject.organisationId,
          revisionId,
          name: validated.parsed.assetName,
          altText: validated.parsed.altText,
          mimeType: validated.parsed.mimeType,
          byteSize: input.body.byteLength,
          width: validated.width,
          height: validated.height,
          frameCount: validated.frameCount,
          sha256: validated.sha256,
          storageKey,
        })
        .returning();
      if (!asset) throw new Error("Reaction pack asset creation failed");

      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "reaction-pack.revision.created",
        targetType: "reaction-pack-revision",
        targetId: revision.id,
        metadata: {
          packId: pack.id,
          revision: revision.revision,
          assetId: asset.id,
          sha256: asset.sha256,
          mimeType: asset.mimeType,
          byteSize: asset.byteSize,
          width: asset.width,
          height: asset.height,
          frameCount: asset.frameCount,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "reaction-pack.revision.created",
        aggregateType: "reaction-pack",
        aggregateId: pack.id,
        queueName: "muster-outbox",
        payload: {
          packId: pack.id,
          revisionId: revision.id,
          assetId: asset.id,
        },
        idempotencyKey: `reaction-pack.revision.created:${revision.id}`,
        traceId,
      });
      return { pack, revision, asset };
    });
  }

  async approveRevision(
    subject: AuthorisationSubject,
    packId: string,
    revisionId: string,
    input: z.input<typeof ApproveReactionPackRevisionSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "administration.manage");
    const parsed = ApproveReactionPackRevisionSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [revision] = await tx
        .select()
        .from(schema.reactionPackRevisions)
        .innerJoin(
          schema.reactionPacks,
          and(
            eq(schema.reactionPacks.organisationId, subject.organisationId),
            eq(schema.reactionPacks.id, packId),
            eq(schema.reactionPacks.lifecycle, "active"),
          ),
        )
        .where(
          and(
            eq(
              schema.reactionPackRevisions.organisationId,
              subject.organisationId,
            ),
            eq(schema.reactionPackRevisions.id, revisionId),
            eq(schema.reactionPackRevisions.packId, packId),
            eq(schema.reactionPackRevisions.status, "draft"),
          ),
        )
        .limit(1);
      if (!revision) {
        throw new ApiProblem(
          409,
          "Reaction revision unavailable",
          "Only an active draft revision can be approved.",
        );
      }
      const assets = await tx
        .select()
        .from(schema.reactionPackAssets)
        .where(
          and(
            eq(
              schema.reactionPackAssets.organisationId,
              subject.organisationId,
            ),
            eq(schema.reactionPackAssets.revisionId, revisionId),
            eq(schema.reactionPackAssets.verificationState, "verified"),
          ),
        );
      if (assets.length === 0) {
        throw new ApiProblem(
          409,
          "Reaction revision empty",
          "At least one verified asset is required before approval.",
        );
      }

      const now = new Date();
      await tx
        .update(schema.reactionPackRevisions)
        .set({ status: "superseded", supersededAt: now, updatedAt: now })
        .where(
          and(
            eq(
              schema.reactionPackRevisions.organisationId,
              subject.organisationId,
            ),
            eq(schema.reactionPackRevisions.packId, packId),
            eq(schema.reactionPackRevisions.status, "approved"),
            ne(schema.reactionPackRevisions.id, revisionId),
          ),
        );
      const [approved] = await tx
        .update(schema.reactionPackRevisions)
        .set({
          status: "approved",
          approvalId: parsed.approvalId ?? null,
          approvedByActorId: subject.actorId,
          approvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(
              schema.reactionPackRevisions.organisationId,
              subject.organisationId,
            ),
            eq(schema.reactionPackRevisions.id, revisionId),
            eq(schema.reactionPackRevisions.status, "draft"),
          ),
        )
        .returning();
      if (!approved) {
        throw new ApiProblem(
          409,
          "Reaction revision unavailable",
          "The draft revision changed before approval.",
        );
      }
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "reaction-pack.revision.approved",
        targetType: "reaction-pack-revision",
        targetId: approved.id,
        metadata: {
          packId,
          revision: approved.revision,
          assetDigests: assets.map((asset) => asset.sha256),
          approvalId: approved.approvalId,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "reaction-pack.revision.approved",
        aggregateType: "reaction-pack",
        aggregateId: packId,
        queueName: "muster-outbox",
        payload: { packId, revisionId: approved.id },
        idempotencyKey: `reaction-pack.revision.approved:${approved.id}`,
        traceId,
      });
      return approved;
    });
  }

  async removePack(
    subject: AuthorisationSubject,
    packId: string,
    traceId: string,
  ) {
    requireCapability(subject, "administration.manage");
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [pack] = await tx
        .update(schema.reactionPacks)
        .set({
          lifecycle: "removed",
          removedByActorId: subject.actorId,
          removedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.reactionPacks.organisationId, subject.organisationId),
            eq(schema.reactionPacks.id, packId),
            eq(schema.reactionPacks.lifecycle, "active"),
          ),
        )
        .returning();
      if (!pack) {
        throw new ApiProblem(
          404,
          "Reaction pack not found",
          "The active reaction pack was not found.",
        );
      }
      await tx
        .update(schema.reactionPackRevisions)
        .set({ status: "removed", removedAt: now, updatedAt: now })
        .where(
          and(
            eq(
              schema.reactionPackRevisions.organisationId,
              subject.organisationId,
            ),
            eq(schema.reactionPackRevisions.packId, packId),
          ),
        );
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "reaction-pack.removed",
        targetType: "reaction-pack",
        targetId: pack.id,
        metadata: { slug: pack.slug },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "reaction-pack.removed",
        aggregateType: "reaction-pack",
        aggregateId: pack.id,
        queueName: "muster-outbox",
        payload: { packId: pack.id },
        idempotencyKey: `reaction-pack.removed:${pack.id}`,
        traceId,
      });
      return pack;
    });
  }

  async recordExternalImportAttempt(
    subject: AuthorisationSubject,
    input: z.input<typeof ExternalReactionPackImportSchema>,
    traceId: string,
  ) {
    requireCapability(subject, "administration.manage");
    const parsed = ExternalReactionPackImportSchema.parse(input);
    const sourceUrlSha256 = createHash("sha256")
      .update(parsed.sourceUrl)
      .digest("hex");
    const [approval] = await this.db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.organisationId, subject.organisationId),
          eq(schema.approvals.id, parsed.approvalId),
          eq(schema.approvals.actionType, "reaction-pack.external-import"),
          eq(schema.approvals.status, "approved"),
        ),
      )
      .limit(1);
    const target =
      approval?.target &&
      typeof approval.target === "object" &&
      !Array.isArray(approval.target)
        ? (approval.target as Record<string, unknown>)
        : {};
    const approved =
      Boolean(approval) && target.sourceUrlSha256 === sourceUrlSha256;
    const outcome = approved ? "not-fetched" : "rejected";
    await this.db.transaction(async (tx) => {
      const attemptId = newId();
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "reaction-pack.external-import.attempted",
        targetType: "reaction-pack-import",
        targetId: attemptId,
        metadata: {
          approvalId: parsed.approvalId,
          sourceUrlSha256,
          outcome,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "reaction-pack.external-import.attempted",
        aggregateType: "reaction-pack-import",
        aggregateId: attemptId,
        queueName: "muster-outbox",
        payload: {
          approvalId: parsed.approvalId,
          sourceUrlSha256,
          outcome,
        },
        idempotencyKey: `reaction-pack.external-import.attempted:${attemptId}`,
        traceId,
      });
    });
    if (!approved) {
      throw new ApiProblem(
        403,
        "External import not approved",
        "An exact approved external-import record is required.",
      );
    }
    return {
      accepted: false,
      detail:
        "External content was recorded as untrusted data and was not fetched.",
    };
  }

  async readApprovedAsset(
    subject: AuthorisationSubject,
    assetId: string,
    revisionId: string,
    digest: string,
    traceId: string,
  ) {
    requireCapability(subject, "rooms.read");
    const parsedDigest = digestSchema.parse(digest);
    const [row] = await this.db
      .select({
        asset: schema.reactionPackAssets,
      })
      .from(schema.reactionPackAssets)
      .innerJoin(
        schema.reactionPackRevisions,
        and(
          eq(
            schema.reactionPackRevisions.organisationId,
            subject.organisationId,
          ),
          eq(schema.reactionPackRevisions.id, revisionId),
          eq(
            schema.reactionPackRevisions.id,
            schema.reactionPackAssets.revisionId,
          ),
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
          eq(schema.reactionPackAssets.organisationId, subject.organisationId),
          eq(schema.reactionPackAssets.id, assetId),
          eq(schema.reactionPackAssets.revisionId, revisionId),
          eq(schema.reactionPackAssets.sha256, parsedDigest),
          eq(schema.reactionPackAssets.verificationState, "verified"),
        ),
      )
      .limit(1);
    if (!row) {
      throw new ApiProblem(
        404,
        "Reaction unavailable",
        "The exact approved reaction asset is unavailable.",
      );
    }

    let body: Uint8Array;
    try {
      body = await this.storage.getObject(row.asset.storageKey);
    } catch {
      await this.markAssetUnavailable(subject, row.asset, "missing", traceId);
      throw new ApiProblem(
        404,
        "Reaction unavailable",
        "The approved reaction asset is missing.",
      );
    }
    const actualDigest = createHash("sha256").update(body).digest("hex");
    if (actualDigest !== row.asset.sha256) {
      await this.markAssetUnavailable(subject, row.asset, "mismatch", traceId);
      throw new ApiProblem(
        409,
        "Reaction digest mismatch",
        "The stored reaction asset failed digest verification.",
      );
    }
    return {
      body,
      mimeType: row.asset.mimeType,
      sha256: row.asset.sha256,
    };
  }

  private async markAssetUnavailable(
    subject: AuthorisationSubject,
    asset: AssetRow,
    state: "missing" | "mismatch",
    traceId: string,
  ) {
    await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.reactionPackAssets)
        .set({ verificationState: state })
        .where(
          and(
            eq(
              schema.reactionPackAssets.organisationId,
              subject.organisationId,
            ),
            eq(schema.reactionPackAssets.id, asset.id),
            eq(schema.reactionPackAssets.verificationState, "verified"),
          ),
        )
        .returning({ id: schema.reactionPackAssets.id });
      if (!updated) return;
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "reaction-pack.asset.verification-failed",
        targetType: "reaction-pack-asset",
        targetId: asset.id,
        metadata: {
          revisionId: asset.revisionId,
          sha256: asset.sha256,
          verificationState: state,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "reaction-pack.asset.verification-failed",
        aggregateType: "reaction-pack-asset",
        aggregateId: asset.id,
        queueName: "muster-outbox",
        payload: {
          assetId: asset.id,
          verificationState: state,
        },
        idempotencyKey: `reaction-pack.asset.verification-failed:${asset.id}:${state}`,
        traceId,
      });
    });
  }
}
