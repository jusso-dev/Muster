import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { appendAuditEvent } from "./domain-transaction.ts";
import { newId } from "./ids.ts";
import { database } from "./index.ts";
import { writeOutbox } from "./outbox.ts";
import * as schema from "./schema.ts";

export const protectedDirectMessageIds = [
  "019fa05a-fff0-76ce-9084-bf0707206d15",
  "019fa05b-c62c-7368-8166-a23b68e3057f",
  "019fa19f-335e-708e-9ce3-be4083921691",
  "019fa19f-5c96-7402-8784-0324bb98d48c",
] as const;

const ids = z.array(z.uuid()).max(10_000).refine(
  (value) => new Set(value).size === value.length,
  "Candidate IDs must be unique",
);

export const SyntheticCleanupManifestSchema = z.object({
  version: z.literal(1),
  manifestId: z.uuid(),
  organisationId: z.uuid(),
  maintenanceActorId: z.uuid(),
  generatedAt: z.string().datetime({ offset: true }),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  archiveRoomIds: ids.default([]),
  hideMessageIds: ids.default([]),
  retireEvidenceIds: ids.default([]),
  rejectAgentMemoryIds: ids.default([]),
  disableWatchlistIds: ids.default([]),
  tableDigests: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
}).strict();

export type SyntheticCleanupManifest = z.infer<typeof SyntheticCleanupManifestSchema>;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

export function syntheticCleanupManifestDigest(
  manifest: Omit<SyntheticCleanupManifest, "digest">,
) {
  return createHash("sha256").update(canonical(manifest)).digest("hex");
}

export function parseSyntheticCleanupManifest(input: unknown) {
  const manifest = SyntheticCleanupManifestSchema.parse(input);
  const { digest, ...unsigned } = manifest;
  if (syntheticCleanupManifestDigest(unsigned) !== digest) {
    throw new Error("Cleanup manifest digest mismatch");
  }
  if (
    manifest.hideMessageIds.some((id) =>
      (protectedDirectMessageIds as readonly string[]).includes(id),
    )
  ) {
    throw new Error("Cleanup manifest includes protected direct message");
  }
  return manifest;
}

/**
 * Applies only reversible/governed transitions.  Candidate selection and any
 * physical object disposition stay outside this command; audit/outbox/message
 * history remain immutable.
 */
export async function applySyntheticCleanup(
  input: unknown,
  traceId: string,
  db = database(),
) {
  const manifest = parseSyntheticCleanupManifest(input);
  return db.transaction(async (tx) => {
    const idempotencyKey = `maintenance.synthetic-cleanup:${manifest.manifestId}`;
    const [prior] = await tx
      .select({ id: schema.outboxEvents.id })
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.idempotencyKey, idempotencyKey))
      .limit(1)
      .for("update");
    if (prior) return { applied: false, manifestId: manifest.manifestId };

    const now = new Date();
    if (manifest.archiveRoomIds.length) {
      await tx.update(schema.rooms).set({ archivedAt: now, updatedAt: now }).where(and(
        eq(schema.rooms.organisationId, manifest.organisationId),
        inArray(schema.rooms.id, manifest.archiveRoomIds),
      ));
    }
    for (const messageId of manifest.hideMessageIds) {
      const [message] = await tx.select().from(schema.messages).where(and(
        eq(schema.messages.organisationId, manifest.organisationId),
        eq(schema.messages.id, messageId),
      )).limit(1).for("update");
      if (!message || message.deletedAt) continue;
      await tx.insert(schema.messageRevisions).values({
        id: newId(), organisationId: manifest.organisationId, messageId,
        actorId: manifest.maintenanceActorId, revisionType: "delete",
        previousDocument: message.document, previousPlainText: message.plainText,
        nextDocument: null, nextPlainText: null,
        reason: `Synthetic cleanup manifest ${manifest.manifestId}`,
        idempotencyKey: `${idempotencyKey}:message:${messageId}`,
      });
      await tx.update(schema.messages).set({
        document: { type: "doc", content: [] }, plainText: "Message deleted", deletedAt: now,
      }).where(and(eq(schema.messages.organisationId, manifest.organisationId), eq(schema.messages.id, messageId)));
    }
    if (manifest.retireEvidenceIds.length) {
      await tx.update(schema.evidence).set({ retentionState: "retired" }).where(and(
        eq(schema.evidence.organisationId, manifest.organisationId),
        inArray(schema.evidence.id, manifest.retireEvidenceIds),
        eq(schema.evidence.legalHold, false),
      ));
    }
    if (manifest.rejectAgentMemoryIds.length) {
      await tx.update(schema.agentMemories).set({ status: "rejected", expiresAt: now }).where(and(
        eq(schema.agentMemories.organisationId, manifest.organisationId),
        inArray(schema.agentMemories.id, manifest.rejectAgentMemoryIds),
      ));
    }
    if (manifest.disableWatchlistIds.length) {
      await tx.update(schema.researchWatchlists).set({ enabled: false, updatedAt: now }).where(and(
        eq(schema.researchWatchlists.organisationId, manifest.organisationId),
        inArray(schema.researchWatchlists.id, manifest.disableWatchlistIds),
      ));
    }
    await appendAuditEvent(tx, {
      organisationId: manifest.organisationId, actorId: manifest.maintenanceActorId,
      actorType: "human", action: "maintenance.synthetic_cleanup.applied",
      targetType: "cleanup_manifest", targetId: manifest.manifestId,
      metadata: { digest: manifest.digest, tableDigests: manifest.tableDigests }, traceId,
    });
    await writeOutbox(tx, {
      organisationId: manifest.organisationId, eventType: "maintenance.synthetic_cleanup.applied",
      aggregateType: "cleanup_manifest", aggregateId: manifest.manifestId,
      queueName: "muster-outbox", payload: { manifestId: manifest.manifestId, digest: manifest.digest },
      idempotencyKey, traceId,
    });
    return { applied: true, manifestId: manifest.manifestId };
  }, { isolationLevel: "serializable", accessMode: "read write" });
}
