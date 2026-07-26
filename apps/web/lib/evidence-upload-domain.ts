import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { requireCapability, type AuthorisationSubject } from "@muster/authz";
import {
  appendAuditEvent,
  database,
  newId,
  schema,
  writeOutbox,
} from "@muster/database";
import {
  evidenceStorageKey,
  EvidenceUploadRequestSchema,
} from "@muster/evidence";
import { RoomService } from "@muster/rooms";
import { ApiProblem } from "./api-context.ts";
import {
  defaultEvidenceObjectStorage,
  type EvidenceObjectStorage,
} from "./object-storage.ts";

export const roomAttachmentMaximumBytes = 25 * 1024 * 1024;

export type RoomAttachmentInput = {
  fileName: string;
  mimeType: string;
  body: Uint8Array;
  classification: "public" | "internal" | "confidential" | "restricted";
};

function attachmentResult(record: typeof schema.evidence.$inferSelect) {
  return {
    id: record.id,
    label: record.fileName,
    mimeType: record.mimeType,
    size: record.size,
    scanState: record.scanState,
  };
}

export async function uploadRoomAttachment(
  subject: AuthorisationSubject,
  roomId: string,
  input: RoomAttachmentInput,
  traceId: string,
  storage: EvidenceObjectStorage = defaultEvidenceObjectStorage,
) {
  requireCapability(subject, "evidence.upload");
  await new RoomService().assertMember(subject, roomId);
  if (input.body.byteLength > roomAttachmentMaximumBytes) {
    throw new ApiProblem(
      413,
      "Attachment too large",
      "Room attachments are limited to 25 MiB.",
    );
  }

  const sha256 = createHash("sha256").update(input.body).digest("hex");
  const parsed = EvidenceUploadRequestSchema.parse({
    organisationId: subject.organisationId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    size: input.body.byteLength,
    sha256,
    classification: input.classification,
  });
  const evidenceId = newId();
  const storageKey = evidenceStorageKey(
    subject.organisationId,
    evidenceId,
    parsed.fileName,
  );
  const db = database();
  const record = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(schema.evidence)
      .values({
        id: evidenceId,
        organisationId: subject.organisationId,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        size: parsed.size,
        sha256: parsed.sha256,
        uploadedByActorId: subject.actorId,
        classification: parsed.classification,
        relatedRoomId: roomId,
        source: "room-attachment",
        storageKey,
        scanState: "uploading",
      })
      .onConflictDoNothing({
        target: [schema.evidence.organisationId, schema.evidence.sha256],
      })
      .returning();
    if (inserted) {
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "evidence.upload.started",
        targetType: "evidence",
        targetId: evidenceId,
        metadata: {
          roomId,
          mimeType: parsed.mimeType,
          size: parsed.size,
          classification: parsed.classification,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "evidence.upload.started",
        aggregateType: "evidence",
        aggregateId: evidenceId,
        queueName: "muster-outbox",
        payload: { evidenceId, roomId },
        idempotencyKey: `evidence.upload.started:${evidenceId}`,
        traceId,
      });
      return inserted;
    }
    const [existing] = await tx
      .select()
      .from(schema.evidence)
      .where(
        and(
          eq(schema.evidence.organisationId, subject.organisationId),
          eq(schema.evidence.sha256, parsed.sha256),
        ),
      )
      .limit(1);
    if (!existing || existing.relatedRoomId !== roomId) {
      throw new ApiProblem(
        409,
        "Attachment conflict",
        "This evidence is already governed in another room.",
      );
    }
    return existing;
  });

  if (record.id !== evidenceId) {
    if (record.scanState === "uploading") {
      throw new ApiProblem(
        409,
        "Attachment processing",
        "This attachment is already being processed.",
      );
    }
    if (record.scanState !== "failed") return attachmentResult(record);
  }

  try {
    await storage.putObject({
      storageKey: record.storageKey,
      contentType: record.mimeType,
      body: input.body,
    });
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.evidence)
        .set({ scanState: "failed" })
        .where(
          and(
            eq(schema.evidence.organisationId, subject.organisationId),
            eq(schema.evidence.id, record.id),
          ),
        );
      await appendAuditEvent(tx, {
        organisationId: subject.organisationId,
        actorId: subject.actorId,
        actorType: "human",
        action: "evidence.upload.failed",
        targetType: "evidence",
        targetId: record.id,
        metadata: { roomId, reason: "object-storage-write-failed" },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: subject.organisationId,
        eventType: "evidence.upload.failed",
        aggregateType: "evidence",
        aggregateId: record.id,
        queueName: "muster-outbox",
        payload: { evidenceId: record.id, roomId },
        idempotencyKey: `evidence.upload.failed:${record.id}:${traceId}`,
        traceId,
      });
    });
    throw new ApiProblem(
      502,
      "Attachment storage unavailable",
      "The attachment could not be stored. Retry is safe.",
    );
  }

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.evidence)
      .set({ scanState: "pending" })
      .where(
        and(
          eq(schema.evidence.organisationId, subject.organisationId),
          eq(schema.evidence.id, record.id),
        ),
      )
      .returning();
    if (!updated)
      throw new ApiProblem(404, "Attachment missing", "Evidence not found.");
    await appendAuditEvent(tx, {
      organisationId: subject.organisationId,
      actorId: subject.actorId,
      actorType: "human",
      action: "evidence.upload.stored",
      targetType: "evidence",
      targetId: record.id,
      metadata: {
        roomId,
        mimeType: updated.mimeType,
        size: updated.size,
        scanState: updated.scanState,
      },
      traceId,
    });
    await writeOutbox(tx, {
      organisationId: subject.organisationId,
      eventType: "evidence.upload.stored",
      aggregateType: "evidence",
      aggregateId: record.id,
      queueName: "muster-outbox",
      payload: { evidenceId: record.id, roomId, scanState: updated.scanState },
      idempotencyKey: `evidence.upload.stored:${record.id}`,
      traceId,
    });
    return attachmentResult(updated);
  });
}
