import {
  applySyntheticCleanup,
  authoriseSyntheticCleanupObjectRetry,
  captureSyntheticCleanupManifest,
  findSyntheticCleanupReceipt,
  listSyntheticCleanupObjectDeletionAttempts,
  parseSyntheticCleanupManifest,
  requestSyntheticCleanupApproval,
  requestSyntheticCleanupObjectRetryApproval,
  SyntheticCleanupObjectRetrySchema,
  SyntheticCleanupPlanSchema,
  verifySyntheticCleanup,
} from "@muster/database";
import {
  ForbiddenError,
  requireCapability,
  type AuthorisationSubject,
} from "@muster/authz";
import { z } from "zod";

const RequestSchema = z
  .object({
    mode: z.enum([
      "capture",
      "verify",
      "request_approval",
      "apply",
      "request_object_deletion_retry",
      "retry_object_deletion",
    ]),
    payload: z.unknown(),
  })
  .strict();

function validateSubject(
  subject: AuthorisationSubject,
  payload: { organisationId: string; maintenanceActorId: string },
) {
  requireCapability(subject, "administration.manage");
  if (
    subject.organisationId !== payload.organisationId ||
    subject.actorId !== payload.maintenanceActorId
  ) {
    throw new ForbiddenError("administration.manage");
  }
}

export class SyntheticCleanupDomainService {
  async execute(subject: AuthorisationSubject, raw: unknown, traceId: string) {
    const input = RequestSchema.parse(raw);
    if (
      input.mode === "request_object_deletion_retry" ||
      input.mode === "retry_object_deletion"
    ) {
      const retry = SyntheticCleanupObjectRetrySchema.parse(input.payload);
      const manifest = parseSyntheticCleanupManifest(retry.manifest);
      validateSubject(subject, manifest);
      if (input.mode === "request_object_deletion_retry") {
        return requestSyntheticCleanupObjectRetryApproval(
          subject,
          { ...retry, manifest },
          traceId,
        );
      }
      const authorised = await authoriseSyntheticCleanupObjectRetry(
        subject,
        { ...retry, manifest },
        traceId,
      );
      return {
        ...authorised,
        objectDeletionQueued: authorised.pendingObjects.length > 0,
      };
    }

    if (input.mode === "capture") {
      const plan = SyntheticCleanupPlanSchema.parse(input.payload);
      validateSubject(subject, plan);
      return captureSyntheticCleanupManifest(subject, plan);
    }

    const manifest = parseSyntheticCleanupManifest(input.payload);
    validateSubject(subject, manifest);
    if (input.mode === "verify") {
      return verifySyntheticCleanup(subject, manifest);
    }
    if (input.mode === "request_approval") {
      return requestSyntheticCleanupApproval(subject, manifest, traceId);
    }

    const priorReceipt = await findSyntheticCleanupReceipt(subject, manifest);
    const result = await applySyntheticCleanup(subject, manifest, traceId);
    if (!result.applied || priorReceipt) {
      const attempts = await listSyntheticCleanupObjectDeletionAttempts(
        subject,
        manifest,
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
      return {
        ...result,
        deletedOrReconciledObjectVersions: completed.size,
        pendingObjectVersions:
          manifest.objectStorageObjects.length - completed.size,
        objectDeletionQueued: false,
      };
    }
    return {
      ...result,
      pendingObjectVersions: manifest.objectStorageObjects.length,
      objectDeletionQueued: manifest.objectStorageObjects.length > 0,
    };
  }
}
