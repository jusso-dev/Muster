import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  database,
  parseSyntheticCleanupManifest,
  recordSyntheticCleanupObjectDeletionAttempt,
  schema,
  type SyntheticCleanupObject,
} from "@muster/database";
import {
  defaultObjectStorage,
  type CleanupObjectStorage,
} from "@muster/evidence";

export type SyntheticCleanupObjectJob = {
  organisationId: string;
  aggregateType: string;
  aggregateId: string;
  traceId: string;
};

export function assertCleanupObjectVersion(
  expected: SyntheticCleanupObject,
  actual: Awaited<ReturnType<CleanupObjectStorage["headObject"]>>,
) {
  if (
    !actual ||
    actual.size !== expected.size ||
    actual.etag !== expected.etag ||
    actual.versionId !== expected.versionId ||
    actual.legalHold !== expected.legalHold ||
    JSON.stringify(actual.objectLockMetadata) !==
      JSON.stringify(expected.objectLockMetadata) ||
    actual.legalHold ||
    Object.keys(actual.objectLockMetadata).length > 0
  ) {
    throw new Error("Cleanup object version metadata changed or is locked");
  }
}

export function canReconcileMissingObject(
  aggregateType: string,
  object: Pick<SyntheticCleanupObject, "evidenceId" | "versionId">,
  authorizationApprovalId: string,
  attempts: ReadonlyArray<{
    evidenceId: string;
    versionId: string;
    authorizationApprovalId: string;
    result: string;
  }>,
) {
  return (
    aggregateType === "cleanup_object_retry_approval" ||
    attempts.some(
      (attempt) =>
        attempt.evidenceId === object.evidenceId &&
        attempt.versionId === object.versionId &&
        attempt.authorizationApprovalId === authorizationApprovalId &&
        attempt.result === "started",
    )
  );
}

export function assertCleanupObjectContent(
  expected: Pick<SyntheticCleanupObject, "size" | "sha256">,
  body: Uint8Array,
) {
  const bodyDigest = createHash("sha256").update(body).digest("hex");
  if (body.byteLength !== expected.size || bodyDigest !== expected.sha256) {
    throw new Error("Cleanup object version content digest changed");
  }
}

export async function processSyntheticCleanupObjectDeletion(
  input: SyntheticCleanupObjectJob,
  storage: CleanupObjectStorage = defaultObjectStorage,
) {
  const db = database();
  let manifestId = input.aggregateId;
  let authorizationApprovalId: string | undefined;
  if (input.aggregateType === "cleanup_object_retry_approval") {
    const [approval] = await db
      .select({
        id: schema.approvals.id,
        actionType: schema.approvals.actionType,
        status: schema.approvals.status,
        target: schema.approvals.target,
      })
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.organisationId, input.organisationId),
          eq(schema.approvals.id, input.aggregateId),
        ),
      )
      .limit(1);
    const target = z
      .object({ manifestId: z.uuid() })
      .safeParse(approval?.target);
    if (
      !approval ||
      approval.status !== "executed" ||
      approval.actionType !==
        "maintenance.synthetic-cleanup.object-delete-retry" ||
      !target.success
    ) {
      throw new Error("Executed cleanup object retry approval is unavailable");
    }
    manifestId = target.data.manifestId;
    authorizationApprovalId = approval.id;
  } else if (input.aggregateType !== "cleanup_manifest") {
    throw new Error("Unsupported cleanup object job target");
  }

  const [receipt] = await db
    .select({
      approvalId: schema.syntheticCleanupReceipts.approvalId,
      maintenanceActorId: schema.syntheticCleanupReceipts.maintenanceActorId,
      manifest: schema.syntheticCleanupReceipts.manifest,
    })
    .from(schema.syntheticCleanupReceipts)
    .where(
      and(
        eq(
          schema.syntheticCleanupReceipts.organisationId,
          input.organisationId,
        ),
        eq(schema.syntheticCleanupReceipts.manifestId, manifestId),
      ),
    )
    .limit(1);
  if (!receipt) throw new Error("Synthetic cleanup receipt is unavailable");
  const manifest = parseSyntheticCleanupManifest(receipt.manifest);
  authorizationApprovalId ??= receipt.approvalId;

  const [actor] = await db
    .select({
      status: schema.actors.status,
      actorType: schema.actors.actorType,
      capabilities: schema.actors.capabilityAssignments,
    })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, input.organisationId),
        eq(schema.actors.id, receipt.maintenanceActorId),
      ),
    )
    .limit(1);
  const capabilities = z.array(z.string()).safeParse(actor?.capabilities);
  if (
    !actor ||
    actor.status !== "active" ||
    actor.actorType !== "human" ||
    !capabilities.success ||
    !capabilities.data.includes("administration.manage")
  ) {
    throw new Error("Cleanup maintenance actor is no longer authorised");
  }
  const subject = {
    actorId: receipt.maintenanceActorId,
    organisationId: input.organisationId,
    capabilities: new Set(["administration.manage"] as const),
  };
  const attempts = await db
    .select({
      evidenceId: schema.syntheticCleanupObjectDeletionAttempts.evidenceId,
      versionId: schema.syntheticCleanupObjectDeletionAttempts.versionId,
      authorizationApprovalId:
        schema.syntheticCleanupObjectDeletionAttempts.authorizationApprovalId,
      result: schema.syntheticCleanupObjectDeletionAttempts.result,
    })
    .from(schema.syntheticCleanupObjectDeletionAttempts)
    .where(
      and(
        eq(
          schema.syntheticCleanupObjectDeletionAttempts.organisationId,
          input.organisationId,
        ),
        eq(
          schema.syntheticCleanupObjectDeletionAttempts.manifestId,
          manifest.manifestId,
        ),
      ),
    );
  const completed = new Set(
    attempts
      .filter(
        (attempt) =>
          attempt.result === "succeeded" ||
          attempt.result === "observed_missing",
      )
      .map((attempt) => `${attempt.evidenceId}:${attempt.versionId}`),
  );
  const configuredBucket =
    process.env.OBJECT_STORAGE_BUCKET ?? "muster-evidence";
  let completedCount = 0;
  for (const object of manifest.objectStorageObjects) {
    const objectKey = `${object.evidenceId}:${object.versionId}`;
    if (completed.has(objectKey)) continue;
    let preflightCode = "BucketMismatch";
    let before: Awaited<ReturnType<CleanupObjectStorage["headObject"]>>;
    try {
      if (object.bucket !== configuredBucket) {
        throw new Error("Cleanup object bucket changed");
      }
      preflightCode = "MetadataReadFailed";
      before = await storage.headObject(object.key, object.versionId);
    } catch (error) {
      await recordSyntheticCleanupObjectDeletionAttempt(
        subject,
        manifest,
        object,
        authorizationApprovalId,
        "failed",
        input.traceId,
        preflightCode,
      );
      throw error;
    }
    if (!before) {
      if (
        !canReconcileMissingObject(
          input.aggregateType,
          object,
          authorizationApprovalId,
          attempts,
        )
      ) {
        await recordSyntheticCleanupObjectDeletionAttempt(
          subject,
          manifest,
          object,
          authorizationApprovalId,
          "failed",
          input.traceId,
          "MissingBeforeDeletion",
        );
        throw new Error(
          "Cleanup object version was never verified before deletion",
        );
      }
      await recordSyntheticCleanupObjectDeletionAttempt(
        subject,
        manifest,
        object,
        authorizationApprovalId,
        "observed_missing",
        input.traceId,
      );
      completedCount += 1;
      continue;
    }
    try {
      preflightCode = "MetadataMismatchOrLocked";
      assertCleanupObjectVersion(object, before);
      preflightCode = "ContentReadFailed";
      const body = await storage.getObjectVersion(object.key, object.versionId);
      preflightCode = "ContentDigestMismatch";
      assertCleanupObjectContent(object, body);
    } catch (error) {
      await recordSyntheticCleanupObjectDeletionAttempt(
        subject,
        manifest,
        object,
        authorizationApprovalId,
        "failed",
        input.traceId,
        preflightCode,
      );
      throw error;
    }
    await recordSyntheticCleanupObjectDeletionAttempt(
      subject,
      manifest,
      object,
      authorizationApprovalId,
      "started",
      input.traceId,
    );
    try {
      await storage.deleteObject(object.key, object.versionId);
      if (await storage.headObject(object.key, object.versionId)) {
        throw new Error("Cleanup object version remains after deletion");
      }
      await recordSyntheticCleanupObjectDeletionAttempt(
        subject,
        manifest,
        object,
        authorizationApprovalId,
        "succeeded",
        input.traceId,
      );
      completedCount += 1;
    } catch (error) {
      await recordSyntheticCleanupObjectDeletionAttempt(
        subject,
        manifest,
        object,
        authorizationApprovalId,
        "failed",
        input.traceId,
        error instanceof Error ? error.name : "UnknownError",
      );
      throw error;
    }
  }
  return { completedObjectVersions: completedCount };
}
