import { createHash } from "node:crypto";
import {
  actionApprovalPolicy,
  assertExecutableApproval,
  ForbiddenError,
  requireCapability,
  type AuthorisationSubject,
} from "@muster/authz";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";
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

export const syntheticCleanupTableKeys = [
  "rooms",
  "tasks",
  "hunts",
  "integrations",
  "researchWatchlists",
  "reportManifests",
  "reportSchedules",
  "messages",
  "evidence",
  "agentMemories",
  "actors",
] as const;

const SyntheticCleanupTableKeySchema = z.enum(syntheticCleanupTableKeys);
type SyntheticCleanupTableKey = z.infer<typeof SyntheticCleanupTableKeySchema>;

const ids = z
  .array(z.uuid())
  .max(10_000)
  .refine(
    (value) => new Set(value).size === value.length,
    "Candidate IDs must be unique",
  );
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const tableDigests = z
  .object({
    rooms: digest,
    tasks: digest,
    hunts: digest,
    integrations: digest,
    researchWatchlists: digest,
    reportManifests: digest,
    reportSchedules: digest,
    messages: digest,
    evidence: digest,
    agentMemories: digest,
    actors: digest,
  })
  .strict();
const selectionEvidence = z.object({
  table: SyntheticCleanupTableKeySchema,
  recordId: z.uuid(),
  provenanceId: z.uuid(),
});
const objectStorageObject = z
  .object({
    evidenceId: z.uuid(),
    bucket: z.string().min(1).max(255),
    key: z.string().min(1).max(2_048),
    versionId: z
      .string()
      .min(1)
      .max(2_048)
      .refine(
        (value) => value !== "unversioned" && value !== "null",
        "Cleanup requires an immutable object version",
      ),
    etag: z.string().min(1).max(512),
    size: z.number().int().nonnegative(),
    sha256: digest,
    legalHold: z.literal(false),
    objectLockMetadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export const SyntheticCleanupManifestSchema = z
  .object({
    version: z.literal(2),
    manifestId: z.uuid(),
    approvalId: z.uuid(),
    organisationId: z.uuid(),
    maintenanceActorId: z.uuid(),
    generatedAt: z.string().datetime({ offset: true }),
    digest,
    archiveRoomIds: ids.default([]),
    archiveTaskIds: ids.default([]),
    archiveHuntIds: ids.default([]),
    archiveIntegrationIds: ids.default([]),
    archiveResearchWatchlistIds: ids.default([]),
    archiveReportManifestIds: ids.default([]),
    archiveReportScheduleIds: ids.default([]),
    hideMessageIds: ids.default([]),
    retireEvidenceIds: ids.default([]),
    rejectAgentMemoryIds: ids.default([]),
    retireActorIds: ids.default([]),
    selectionEvidence: z.array(selectionEvidence).max(110_000),
    objectStorageObjects: z.array(objectStorageObject).max(10_000).default([]),
    tableDigests,
  })
  .strict();
export const SyntheticCleanupPlanSchema = SyntheticCleanupManifestSchema.omit({
  digest: true,
  tableDigests: true,
});
export const SyntheticCleanupObjectRetrySchema = z
  .object({
    manifest: SyntheticCleanupManifestSchema,
    retryApprovalId: z.uuid(),
  })
  .strict();

export type SyntheticCleanupManifest = z.infer<
  typeof SyntheticCleanupManifestSchema
>;
export type SyntheticCleanupPlan = z.infer<typeof SyntheticCleanupPlanSchema>;
export type SyntheticCleanupObject = z.infer<typeof objectStorageObject>;
export type SyntheticCleanupObjectRetry = z.infer<
  typeof SyntheticCleanupObjectRetrySchema
>;

type Database = ReturnType<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type CandidateRow = { id: string; [key: string]: unknown };
type CandidateRows = Record<SyntheticCleanupTableKey, CandidateRow[]>;

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function syntheticCleanupManifestDigest(
  manifest: Omit<SyntheticCleanupManifest, "digest">,
) {
  return sha256(canonical(manifest));
}

export function syntheticCleanupTableDigest(rows: ReadonlyArray<CandidateRow>) {
  return sha256(
    canonical([...rows].sort((left, right) => left.id.localeCompare(right.id))),
  );
}

function candidateIds(
  manifest: SyntheticCleanupManifest,
): Record<SyntheticCleanupTableKey, string[]> {
  return {
    rooms: manifest.archiveRoomIds,
    tasks: manifest.archiveTaskIds,
    hunts: manifest.archiveHuntIds,
    integrations: manifest.archiveIntegrationIds,
    researchWatchlists: manifest.archiveResearchWatchlistIds,
    reportManifests: manifest.archiveReportManifestIds,
    reportSchedules: manifest.archiveReportScheduleIds,
    messages: manifest.hideMessageIds,
    evidence: manifest.retireEvidenceIds,
    agentMemories: manifest.rejectAgentMemoryIds,
    actors: manifest.retireActorIds,
  };
}

function verifySelectionEvidence(manifest: SyntheticCleanupManifest) {
  const expected = new Set(
    Object.entries(candidateIds(manifest)).flatMap(([table, recordIds]) =>
      recordIds.map((recordId) => `${table}:${recordId}`),
    ),
  );
  const actual = new Set(
    manifest.selectionEvidence.map((item) => `${item.table}:${item.recordId}`),
  );
  if (
    actual.size !== manifest.selectionEvidence.length ||
    actual.size !== expected.size ||
    [...expected].some((key) => !actual.has(key))
  ) {
    throw new Error(
      "Cleanup selection evidence must exactly cover every candidate",
    );
  }
}

export function parseSyntheticCleanupManifest(input: unknown) {
  const manifest = SyntheticCleanupManifestSchema.parse(input);
  const { digest: manifestDigest, ...unsigned } = manifest;
  if (syntheticCleanupManifestDigest(unsigned) !== manifestDigest) {
    throw new Error("Cleanup manifest digest mismatch");
  }
  validateManifestGuards(manifest);
  return manifest;
}

function validateManifestGuards(manifest: SyntheticCleanupManifest) {
  if (
    manifest.hideMessageIds.some((id) =>
      (protectedDirectMessageIds as readonly string[]).includes(id),
    )
  ) {
    throw new Error("Cleanup manifest includes protected direct message");
  }
  if (manifest.retireActorIds.includes(manifest.maintenanceActorId)) {
    throw new Error("Cleanup manifest retires its maintenance actor");
  }
  verifySelectionEvidence(manifest);
  const retiredEvidence = new Set(manifest.retireEvidenceIds);
  if (
    new Set(manifest.objectStorageObjects.map((object) => object.evidenceId))
      .size !== manifest.objectStorageObjects.length ||
    manifest.objectStorageObjects.length !== retiredEvidence.size ||
    manifest.objectStorageObjects.some(
      (object) => !retiredEvidence.has(object.evidenceId),
    )
  ) {
    throw new Error(
      "Object cleanup inventory must exactly cover selected evidence",
    );
  }
}

function validateAuthenticatedSubject(
  subject: AuthorisationSubject,
  manifest: SyntheticCleanupManifest,
) {
  requireCapability(subject, "administration.manage");
  if (
    subject.organisationId !== manifest.organisationId ||
    subject.actorId !== manifest.maintenanceActorId
  ) {
    throw new ForbiddenError("administration.manage");
  }
}

function assertExactRows(
  table: SyntheticCleanupTableKey,
  expectedIds: readonly string[],
  rows: readonly CandidateRow[],
  expectedDigest: string,
) {
  const actualIds = rows.map((row) => row.id).sort();
  const sortedExpected = [...expectedIds].sort();
  if (
    actualIds.length !== sortedExpected.length ||
    actualIds.some((id, index) => id !== sortedExpected[index])
  ) {
    throw new Error(`Cleanup ${table} candidate count or ownership changed`);
  }
  if (syntheticCleanupTableDigest(rows) !== expectedDigest) {
    throw new Error(`Cleanup ${table} pre-state digest changed`);
  }
}

async function loadCandidateRows(
  tx: Transaction,
  manifest: SyntheticCleanupManifest,
): Promise<CandidateRows> {
  const organisationId = manifest.organisationId;
  const rooms = manifest.archiveRoomIds.length
    ? await tx
        .select({ ...getTableColumns(schema.rooms) })
        .from(schema.rooms)
        .where(
          and(
            eq(schema.rooms.organisationId, organisationId),
            inArray(schema.rooms.id, manifest.archiveRoomIds),
          ),
        )
        .for("update")
    : [];
  const tasks = manifest.archiveTaskIds.length
    ? await tx
        .select({ ...getTableColumns(schema.tasks) })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.organisationId, organisationId),
            inArray(schema.tasks.id, manifest.archiveTaskIds),
          ),
        )
        .for("update")
    : [];
  const hunts = manifest.archiveHuntIds.length
    ? await tx
        .select({ ...getTableColumns(schema.huntRuns) })
        .from(schema.huntRuns)
        .where(
          and(
            eq(schema.huntRuns.organisationId, organisationId),
            inArray(schema.huntRuns.id, manifest.archiveHuntIds),
          ),
        )
        .for("update")
    : [];
  const integrations = manifest.archiveIntegrationIds.length
    ? await tx
        .select({ ...getTableColumns(schema.integrationRecords) })
        .from(schema.integrationRecords)
        .where(
          and(
            eq(schema.integrationRecords.organisationId, organisationId),
            inArray(
              schema.integrationRecords.id,
              manifest.archiveIntegrationIds,
            ),
          ),
        )
        .for("update")
    : [];
  const researchWatchlists = manifest.archiveResearchWatchlistIds.length
    ? await tx
        .select({ ...getTableColumns(schema.researchWatchlists) })
        .from(schema.researchWatchlists)
        .where(
          and(
            eq(schema.researchWatchlists.organisationId, organisationId),
            inArray(
              schema.researchWatchlists.id,
              manifest.archiveResearchWatchlistIds,
            ),
          ),
        )
        .for("update")
    : [];
  const reportManifests = manifest.archiveReportManifestIds.length
    ? await tx
        .select({ ...getTableColumns(schema.reportManifests) })
        .from(schema.reportManifests)
        .where(
          and(
            eq(schema.reportManifests.organisationId, organisationId),
            inArray(
              schema.reportManifests.id,
              manifest.archiveReportManifestIds,
            ),
          ),
        )
        .for("update")
    : [];
  const reportSchedules = manifest.archiveReportScheduleIds.length
    ? await tx
        .select({ ...getTableColumns(schema.reportSchedules) })
        .from(schema.reportSchedules)
        .where(
          and(
            eq(schema.reportSchedules.organisationId, organisationId),
            inArray(
              schema.reportSchedules.id,
              manifest.archiveReportScheduleIds,
            ),
          ),
        )
        .for("update")
    : [];
  const messages = manifest.hideMessageIds.length
    ? await tx
        .select({
          ...getTableColumns(schema.messages),
          roomType: schema.rooms.roomType,
        })
        .from(schema.messages)
        .innerJoin(
          schema.rooms,
          and(
            eq(schema.rooms.organisationId, schema.messages.organisationId),
            eq(schema.rooms.id, schema.messages.roomId),
          ),
        )
        .where(
          and(
            eq(schema.messages.organisationId, organisationId),
            inArray(schema.messages.id, manifest.hideMessageIds),
          ),
        )
        .for("update", { of: [schema.messages, schema.rooms] })
    : [];
  const evidence = manifest.retireEvidenceIds.length
    ? await tx
        .select({ ...getTableColumns(schema.evidence) })
        .from(schema.evidence)
        .where(
          and(
            eq(schema.evidence.organisationId, organisationId),
            inArray(schema.evidence.id, manifest.retireEvidenceIds),
          ),
        )
        .for("update")
    : [];
  const agentMemories = manifest.rejectAgentMemoryIds.length
    ? await tx
        .select({ ...getTableColumns(schema.agentMemories) })
        .from(schema.agentMemories)
        .where(
          and(
            eq(schema.agentMemories.organisationId, organisationId),
            inArray(schema.agentMemories.id, manifest.rejectAgentMemoryIds),
          ),
        )
        .for("update")
    : [];
  const actors = manifest.retireActorIds.length
    ? await tx
        .select({ ...getTableColumns(schema.actors) })
        .from(schema.actors)
        .where(
          and(
            eq(schema.actors.organisationId, organisationId),
            inArray(schema.actors.id, manifest.retireActorIds),
          ),
        )
        .for("update")
    : [];
  const rows: CandidateRows = {
    rooms,
    tasks,
    hunts,
    integrations,
    researchWatchlists,
    reportManifests,
    reportSchedules,
    messages,
    evidence,
    agentMemories,
    actors,
  };
  const selectedArtifactIds = Object.values(candidateIds(manifest)).flat();
  const provenance = selectedArtifactIds.length
    ? await tx
        .select({
          id: schema.syntheticArtifactProvenance.id,
          artifactTable: schema.syntheticArtifactProvenance.artifactTable,
          artifactId: schema.syntheticArtifactProvenance.artifactId,
          sourceKind: schema.syntheticArtifactProvenance.sourceKind,
          sourceReference: schema.syntheticArtifactProvenance.sourceReference,
        })
        .from(schema.syntheticArtifactProvenance)
        .where(
          and(
            eq(
              schema.syntheticArtifactProvenance.organisationId,
              organisationId,
            ),
            inArray(
              schema.syntheticArtifactProvenance.artifactId,
              selectedArtifactIds,
            ),
          ),
        )
        .for("update")
    : [];
  const provenanceByArtifact = new Map(
    provenance.map((record) => [
      `${record.artifactTable}:${record.artifactId}`,
      record,
    ]),
  );
  for (const table of syntheticCleanupTableKeys) {
    for (const row of rows[table]) {
      const record = provenanceByArtifact.get(`${table}:${row.id}`);
      if (record) {
        row.syntheticProvenanceId = record.id;
        row.syntheticProvenanceSourceKind = record.sourceKind;
        row.syntheticProvenanceSourceReference = record.sourceReference;
      }
    }
  }
  if (manifest.retireActorIds.length) {
    const protectedMemberships = await tx
      .select({ actorId: schema.roomMemberships.actorId })
      .from(schema.roomMemberships)
      .innerJoin(
        schema.rooms,
        and(
          eq(
            schema.rooms.organisationId,
            schema.roomMemberships.organisationId,
          ),
          eq(schema.rooms.id, schema.roomMemberships.roomId),
        ),
      )
      .where(
        and(
          eq(schema.roomMemberships.organisationId, organisationId),
          inArray(schema.roomMemberships.actorId, manifest.retireActorIds),
          eq(schema.rooms.roomType, "direct"),
        ),
      )
      .for("update", { of: [schema.roomMemberships, schema.rooms] });
    if (protectedMemberships.length) {
      throw new Error("Cleanup cannot retire a direct-room member");
    }
  }
  return rows;
}

function verifyCandidateRows(
  manifest: SyntheticCleanupManifest,
  rows: CandidateRows,
) {
  for (const table of syntheticCleanupTableKeys) {
    assertExactRows(
      table,
      candidateIds(manifest)[table],
      rows[table],
      manifest.tableDigests[table],
    );
  }
  verifyCandidateStates(manifest, rows);
}

function verifyCandidateStates(
  manifest: SyntheticCleanupManifest,
  rows: CandidateRows,
) {
  if (
    rows.rooms.some(
      (row) => row.archivedAt !== null || row.roomType === "direct",
    )
  ) {
    throw new Error("Cleanup room is archived or direct");
  }
  if (
    rows.tasks.some((row) => row.archivedAt !== null || row.status !== "done")
  ) {
    throw new Error("Cleanup tasks must be done and unarchived");
  }
  if (
    rows.hunts.some(
      (row) =>
        row.archivedAt !== null ||
        !["completed", "failed", "cancelled"].includes(String(row.status)),
    )
  ) {
    throw new Error("Cleanup hunts must be terminal and unarchived");
  }
  if (rows.integrations.some((row) => row.archivedAt !== null)) {
    throw new Error("Cleanup integration is already archived");
  }
  if (rows.researchWatchlists.some((row) => row.archivedAt !== null)) {
    throw new Error("Cleanup research watchlist is already archived");
  }
  if (rows.reportManifests.some((row) => row.archivedAt !== null)) {
    throw new Error("Cleanup report manifest is already archived");
  }
  if (rows.reportSchedules.some((row) => row.archivedAt !== null)) {
    throw new Error("Cleanup report schedule is already archived");
  }
  if (
    rows.messages.some(
      (row) => row.deletedAt !== null || row.roomType === "direct",
    )
  ) {
    throw new Error("Cleanup cannot hide deleted or direct-room messages");
  }
  if (
    rows.evidence.some(
      (row) => row.legalHold === true || row.retentionState === "retired",
    )
  ) {
    throw new Error("Cleanup evidence is held or already retired");
  }
  if (rows.agentMemories.some((row) => row.status === "rejected")) {
    throw new Error("Cleanup memory is already rejected");
  }
  if (
    rows.actors.some(
      (row) =>
        row.status !== "active" ||
        row.actorType !== "human" ||
        row.id === manifest.maintenanceActorId,
    )
  ) {
    throw new Error("Cleanup actor is protected or already inactive");
  }
  const expectedObjects = new Map(
    manifest.objectStorageObjects.map((object) => [object.evidenceId, object]),
  );
  for (const row of rows.evidence) {
    const object = expectedObjects.get(row.id);
    if (!object) continue;
    if (
      object.key !== row.storageKey ||
      object.sha256 !== row.sha256 ||
      object.size !== row.size
    ) {
      throw new Error("Cleanup object inventory changed");
    }
    if (
      object.legalHold ||
      Object.keys(object.objectLockMetadata).length > 0 ||
      (row.objectLockMetadata &&
        Object.keys(row.objectLockMetadata as object).length > 0)
    ) {
      throw new Error("Cleanup object is locked");
    }
  }
  const rowsByTable = Object.fromEntries(
    syntheticCleanupTableKeys.map((table) => [
      table,
      new Map(rows[table].map((row) => [row.id, row])),
    ]),
  ) as Record<SyntheticCleanupTableKey, Map<string, CandidateRow>>;
  for (const evidence of manifest.selectionEvidence) {
    const row = rowsByTable[evidence.table].get(evidence.recordId);
    if (!row) {
      throw new Error("Cleanup selection evidence row is unavailable");
    }
    if (row.syntheticProvenanceId !== evidence.provenanceId) {
      throw new Error(
        "Cleanup candidate lacks exact append-only synthetic provenance",
      );
    }
  }
}

async function validateMaintenanceActor(
  tx: Transaction,
  manifest: SyntheticCleanupManifest,
) {
  const [actor] = await tx
    .select({
      id: schema.actors.id,
      status: schema.actors.status,
      actorType: schema.actors.actorType,
      capabilities: schema.actors.capabilityAssignments,
    })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, manifest.organisationId),
        eq(schema.actors.id, manifest.maintenanceActorId),
      ),
    )
    .limit(1)
    .for("update");
  const capabilities = z.array(z.string()).safeParse(actor?.capabilities);
  if (
    !actor ||
    actor.status !== "active" ||
    actor.actorType !== "human" ||
    !capabilities.success ||
    !capabilities.data.includes("administration.manage")
  ) {
    throw new Error("Authorised maintenance actor is unavailable");
  }
  return actor;
}

async function validateExecutableApproval(
  tx: Transaction,
  manifest: SyntheticCleanupManifest,
  now: Date,
) {
  const [approval] = await tx
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.organisationId, manifest.organisationId),
        eq(schema.approvals.id, manifest.approvalId),
      ),
    )
    .limit(1)
    .for("update");
  const target = z
    .object({ manifestId: z.uuid(), digest })
    .safeParse(approval?.target);
  const decisions = z
    .array(
      z.object({
        actorId: z.uuid(),
        status: z.enum(["approved", "rejected"]),
      }),
    )
    .safeParse(approval?.decisions);
  if (
    !approval ||
    approval.status !== "approved" ||
    approval.actionType !== "maintenance.synthetic-cleanup" ||
    approval.requiredCapability !== "administration.manage" ||
    approval.requiredApprovalCount !==
      actionApprovalPolicy["maintenance.synthetic-cleanup"].approvalCount ||
    approval.requestingActorId !== manifest.maintenanceActorId ||
    approval.expiresAt <= now ||
    approval.executedAt !== null ||
    !target.success ||
    target.data.manifestId !== manifest.manifestId ||
    target.data.digest !== manifest.digest ||
    !decisions.success
  ) {
    throw new Error("Executable cleanup approval is missing");
  }
  assertExecutableApproval("maintenance.synthetic-cleanup", decisions.data);
  const approvedActorIds = [
    ...new Set(
      decisions.data
        .filter((decision) => decision.status === "approved")
        .map((decision) => decision.actorId),
    ),
  ];
  if (approvedActorIds.length < approval.requiredApprovalCount) {
    throw new Error("Cleanup approval count is insufficient");
  }
  if (approvedActorIds.includes(manifest.maintenanceActorId)) {
    throw new Error("Cleanup requires an independent approver");
  }
  const approvers = await tx
    .select({
      id: schema.actors.id,
      status: schema.actors.status,
      capabilities: schema.actors.capabilityAssignments,
    })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.organisationId, manifest.organisationId),
        inArray(schema.actors.id, approvedActorIds),
      ),
    )
    .for("update");
  if (
    approvers.length !== approvedActorIds.length ||
    approvers.some((approver) => {
      const capabilities = z.array(z.string()).safeParse(approver.capabilities);
      return (
        approver.status !== "active" ||
        !capabilities.success ||
        !capabilities.data.includes("administration.manage")
      );
    })
  ) {
    throw new Error("Cleanup approver capability was revoked");
  }
  return approval;
}

function candidateCounts(rows: CandidateRows) {
  return Object.fromEntries(
    syntheticCleanupTableKeys.map((table) => [table, rows[table].length]),
  ) as Record<SyntheticCleanupTableKey, number>;
}

async function updateExactly(
  expectedIds: readonly string[],
  update: () => Promise<Array<{ id: string }>>,
  label: string,
) {
  if (!expectedIds.length) return;
  const updated = await update();
  if (
    updated.length !== expectedIds.length ||
    updated.some((row) => !expectedIds.includes(row.id))
  ) {
    throw new Error(`Cleanup ${label} affected-count mismatch`);
  }
}

async function applyCandidateTransitions(
  tx: Transaction,
  manifest: SyntheticCleanupManifest,
  now: Date,
  idempotencyKey: string,
) {
  await updateExactly(
    manifest.archiveRoomIds,
    () =>
      tx
        .update(schema.rooms)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.rooms.organisationId, manifest.organisationId),
            inArray(schema.rooms.id, manifest.archiveRoomIds),
          ),
        )
        .returning({ id: schema.rooms.id }),
    "rooms",
  );
  await updateExactly(
    manifest.archiveTaskIds,
    () =>
      tx
        .update(schema.tasks)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.tasks.organisationId, manifest.organisationId),
            inArray(schema.tasks.id, manifest.archiveTaskIds),
          ),
        )
        .returning({ id: schema.tasks.id }),
    "tasks",
  );
  await updateExactly(
    manifest.archiveHuntIds,
    () =>
      tx
        .update(schema.huntRuns)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.huntRuns.organisationId, manifest.organisationId),
            inArray(schema.huntRuns.id, manifest.archiveHuntIds),
          ),
        )
        .returning({ id: schema.huntRuns.id }),
    "hunts",
  );
  await updateExactly(
    manifest.archiveIntegrationIds,
    () =>
      tx
        .update(schema.integrationRecords)
        .set({ archivedAt: now, status: "disabled", updatedAt: now })
        .where(
          and(
            eq(
              schema.integrationRecords.organisationId,
              manifest.organisationId,
            ),
            inArray(
              schema.integrationRecords.id,
              manifest.archiveIntegrationIds,
            ),
          ),
        )
        .returning({ id: schema.integrationRecords.id }),
    "integrations",
  );
  await updateExactly(
    manifest.archiveResearchWatchlistIds,
    () =>
      tx
        .update(schema.researchWatchlists)
        .set({ archivedAt: now, enabled: false, updatedAt: now })
        .where(
          and(
            eq(
              schema.researchWatchlists.organisationId,
              manifest.organisationId,
            ),
            inArray(
              schema.researchWatchlists.id,
              manifest.archiveResearchWatchlistIds,
            ),
          ),
        )
        .returning({ id: schema.researchWatchlists.id }),
    "research watchlists",
  );
  await updateExactly(
    manifest.archiveReportManifestIds,
    () =>
      tx
        .update(schema.reportManifests)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.reportManifests.organisationId, manifest.organisationId),
            inArray(
              schema.reportManifests.id,
              manifest.archiveReportManifestIds,
            ),
          ),
        )
        .returning({ id: schema.reportManifests.id }),
    "report manifests",
  );
  await updateExactly(
    manifest.archiveReportScheduleIds,
    () =>
      tx
        .update(schema.reportSchedules)
        .set({ archivedAt: now, enabled: false, updatedAt: now })
        .where(
          and(
            eq(schema.reportSchedules.organisationId, manifest.organisationId),
            inArray(
              schema.reportSchedules.id,
              manifest.archiveReportScheduleIds,
            ),
          ),
        )
        .returning({ id: schema.reportSchedules.id }),
    "report schedules",
  );
  for (const messageId of manifest.hideMessageIds) {
    const [message] = await tx
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.organisationId, manifest.organisationId),
          eq(schema.messages.id, messageId),
        ),
      )
      .limit(1);
    if (!message || message.deletedAt) {
      throw new Error("Cleanup message changed after preflight");
    }
    await tx.insert(schema.messageRevisions).values({
      id: newId(),
      organisationId: manifest.organisationId,
      messageId,
      actorId: manifest.maintenanceActorId,
      revisionType: "delete",
      previousDocument: message.document,
      previousPlainText: message.plainText,
      nextDocument: null,
      nextPlainText: null,
      reason: `Synthetic cleanup manifest ${manifest.manifestId}`,
      idempotencyKey: `${idempotencyKey}:message:${messageId}`,
    });
    const updated = await tx
      .update(schema.messages)
      .set({
        document: { type: "doc", content: [] },
        plainText: "Message deleted",
        deletedAt: now,
      })
      .where(
        and(
          eq(schema.messages.organisationId, manifest.organisationId),
          eq(schema.messages.id, messageId),
        ),
      )
      .returning({ id: schema.messages.id });
    if (updated.length !== 1) {
      throw new Error("Cleanup message affected-count mismatch");
    }
  }
  await updateExactly(
    manifest.retireEvidenceIds,
    () =>
      tx
        .update(schema.evidence)
        .set({ retentionState: "retired" })
        .where(
          and(
            eq(schema.evidence.organisationId, manifest.organisationId),
            inArray(schema.evidence.id, manifest.retireEvidenceIds),
            eq(schema.evidence.legalHold, false),
          ),
        )
        .returning({ id: schema.evidence.id }),
    "evidence",
  );
  await updateExactly(
    manifest.rejectAgentMemoryIds,
    () =>
      tx
        .update(schema.agentMemories)
        .set({ status: "rejected", expiresAt: now })
        .where(
          and(
            eq(schema.agentMemories.organisationId, manifest.organisationId),
            inArray(schema.agentMemories.id, manifest.rejectAgentMemoryIds),
          ),
        )
        .returning({ id: schema.agentMemories.id }),
    "agent memories",
  );
  await updateExactly(
    manifest.retireActorIds,
    () =>
      tx
        .update(schema.actors)
        .set({ status: "inactive" })
        .where(
          and(
            eq(schema.actors.organisationId, manifest.organisationId),
            inArray(schema.actors.id, manifest.retireActorIds),
          ),
        )
        .returning({ id: schema.actors.id }),
    "actors",
  );
}

function verifyPostCandidateStates(
  manifest: SyntheticCleanupManifest,
  before: CandidateRows,
  after: CandidateRows,
  now: Date,
) {
  const expected: CandidateRows = Object.fromEntries(
    syntheticCleanupTableKeys.map((table) => [
      table,
      before[table].map((row) => ({ ...row })),
    ]),
  ) as CandidateRows;
  for (const row of expected.rooms) {
    row.archivedAt = now;
    row.updatedAt = now;
  }
  for (const row of expected.tasks) {
    row.archivedAt = now;
    row.updatedAt = now;
  }
  for (const row of expected.hunts) {
    row.archivedAt = now;
    row.updatedAt = now;
  }
  for (const row of expected.integrations) {
    row.archivedAt = now;
    row.status = "disabled";
    row.updatedAt = now;
  }
  for (const row of expected.researchWatchlists) {
    row.archivedAt = now;
    row.enabled = false;
    row.updatedAt = now;
  }
  for (const row of expected.reportManifests) {
    row.archivedAt = now;
    row.updatedAt = now;
  }
  for (const row of expected.reportSchedules) {
    row.archivedAt = now;
    row.enabled = false;
    row.updatedAt = now;
  }
  for (const row of expected.messages) {
    row.document = { type: "doc", content: [] };
    row.plainText = "Message deleted";
    row.deletedAt = now;
  }
  for (const row of expected.evidence) {
    row.retentionState = "retired";
  }
  for (const row of expected.agentMemories) {
    row.status = "rejected";
    row.expiresAt = now;
  }
  for (const row of expected.actors) {
    row.status = "inactive";
  }
  for (const table of syntheticCleanupTableKeys) {
    assertExactRows(
      table,
      candidateIds(manifest)[table],
      after[table],
      syntheticCleanupTableDigest(expected[table]),
    );
  }
  return Object.fromEntries(
    syntheticCleanupTableKeys.map((table) => [
      table,
      syntheticCleanupTableDigest(expected[table]),
    ]),
  ) as Record<SyntheticCleanupTableKey, string>;
}

async function verifyMessageRevisions(
  tx: Transaction,
  manifest: SyntheticCleanupManifest,
  before: CandidateRows,
  idempotencyKey: string,
) {
  if (!manifest.hideMessageIds.length) return;
  const revisionKeys = manifest.hideMessageIds.map(
    (messageId) => `${idempotencyKey}:message:${messageId}`,
  );
  const revisions = await tx
    .select()
    .from(schema.messageRevisions)
    .where(
      and(
        eq(schema.messageRevisions.organisationId, manifest.organisationId),
        inArray(schema.messageRevisions.idempotencyKey, revisionKeys),
      ),
    );
  const beforeById = new Map(
    before.messages.map((message) => [message.id, message]),
  );
  if (
    revisions.length !== manifest.hideMessageIds.length ||
    revisions.some((revision) => {
      const previous = beforeById.get(revision.messageId);
      return (
        !previous ||
        revision.actorId !== manifest.maintenanceActorId ||
        revision.revisionType !== "delete" ||
        canonical(revision.previousDocument) !== canonical(previous.document) ||
        revision.previousPlainText !== previous.plainText ||
        revision.nextDocument !== null ||
        revision.nextPlainText !== null ||
        revision.idempotencyKey !==
          `${idempotencyKey}:message:${revision.messageId}`
      );
    })
  ) {
    throw new Error("Cleanup message revision post-state mismatch");
  }
}

export async function requestSyntheticCleanupApproval(
  subject: AuthorisationSubject,
  input: unknown,
  traceId: string,
  db = database(),
) {
  const manifest = parseSyntheticCleanupManifest(input);
  validateAuthenticatedSubject(subject, manifest);
  return db.transaction(
    async (tx) => {
      await validateMaintenanceActor(tx, manifest);
      const rows = await loadCandidateRows(tx, manifest);
      verifyCandidateRows(manifest, rows);
      const [prior] = await tx
        .select({
          id: schema.approvals.id,
          actionType: schema.approvals.actionType,
          target: schema.approvals.target,
        })
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.organisationId, manifest.organisationId),
            eq(schema.approvals.id, manifest.approvalId),
          ),
        )
        .limit(1)
        .for("update");
      if (prior) {
        const target = z
          .object({ manifestId: z.uuid(), digest })
          .safeParse(prior.target);
        if (
          prior.actionType !== "maintenance.synthetic-cleanup" ||
          !target.success ||
          target.data.manifestId !== manifest.manifestId ||
          target.data.digest !== manifest.digest
        ) {
          throw new Error("Cleanup approval ID is already bound");
        }
        return {
          requested: false,
          manifestId: manifest.manifestId,
          approvalId: manifest.approvalId,
          candidateCounts: candidateCounts(rows),
        };
      }
      const policy = actionApprovalPolicy["maintenance.synthetic-cleanup"];
      await tx.insert(schema.approvals).values({
        id: manifest.approvalId,
        organisationId: manifest.organisationId,
        requestingActorId: manifest.maintenanceActorId,
        actionType: "maintenance.synthetic-cleanup",
        target: {
          manifestId: manifest.manifestId,
          digest: manifest.digest,
        },
        riskSummary: `Archive or retire ${Object.values(candidateCounts(rows)).reduce((sum, count) => sum + count, 0)} exact synthetic records; object deletion remains post-commit.`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        requiredCapability: policy.capability,
        requiredApprovalCount: policy.approvalCount,
        idempotencyKey: `maintenance.synthetic-cleanup:${manifest.manifestId}:approval`,
      });
      await appendAuditEvent(tx, {
        organisationId: manifest.organisationId,
        actorId: manifest.maintenanceActorId,
        actorType: "human",
        action: "maintenance.synthetic_cleanup.requested",
        targetType: "cleanup_manifest",
        targetId: manifest.manifestId,
        metadata: {
          approvalId: manifest.approvalId,
          digest: manifest.digest,
          candidateCounts: candidateCounts(rows),
          tableDigests: manifest.tableDigests,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: manifest.organisationId,
        eventType: "maintenance.synthetic_cleanup.requested",
        aggregateType: "cleanup_manifest",
        aggregateId: manifest.manifestId,
        queueName: "muster-outbox",
        payload: {
          manifestId: manifest.manifestId,
          approvalId: manifest.approvalId,
          digest: manifest.digest,
        },
        idempotencyKey: `maintenance.synthetic-cleanup:${manifest.manifestId}:requested`,
        traceId,
      });
      return {
        requested: true,
        manifestId: manifest.manifestId,
        approvalId: manifest.approvalId,
        candidateCounts: candidateCounts(rows),
      };
    },
    { isolationLevel: "serializable", accessMode: "read write" },
  );
}

export async function captureSyntheticCleanupManifest(
  subject: AuthorisationSubject,
  input: unknown,
  db = database(),
) {
  const plan = SyntheticCleanupPlanSchema.parse(input);
  const placeholder = {
    ...plan,
    digest: "0".repeat(64),
    tableDigests: Object.fromEntries(
      syntheticCleanupTableKeys.map((table) => [table, "0".repeat(64)]),
    ),
  } as SyntheticCleanupManifest;
  validateManifestGuards(placeholder);
  validateAuthenticatedSubject(subject, placeholder);
  return db.transaction(
    async (tx) => {
      await validateMaintenanceActor(tx, placeholder);
      const rows = await loadCandidateRows(tx, placeholder);
      for (const table of syntheticCleanupTableKeys) {
        const actualDigest = syntheticCleanupTableDigest(rows[table]);
        assertExactRows(
          table,
          candidateIds(placeholder)[table],
          rows[table],
          actualDigest,
        );
      }
      verifyCandidateStates(placeholder, rows);
      const capturedTableDigests = Object.fromEntries(
        syntheticCleanupTableKeys.map((table) => [
          table,
          syntheticCleanupTableDigest(rows[table]),
        ]),
      ) as SyntheticCleanupManifest["tableDigests"];
      const unsigned: Omit<SyntheticCleanupManifest, "digest"> = {
        ...plan,
        tableDigests: capturedTableDigests,
      };
      return {
        ...unsigned,
        digest: syntheticCleanupManifestDigest(unsigned),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read write" },
  );
}

export async function verifySyntheticCleanup(
  subject: AuthorisationSubject,
  input: unknown,
  db = database(),
) {
  const manifest = parseSyntheticCleanupManifest(input);
  validateAuthenticatedSubject(subject, manifest);
  return db.transaction(
    async (tx) => {
      await validateMaintenanceActor(tx, manifest);
      const rows = await loadCandidateRows(tx, manifest);
      verifyCandidateRows(manifest, rows);
      return {
        verified: true,
        manifestId: manifest.manifestId,
        candidateCounts: candidateCounts(rows),
        tableDigests: manifest.tableDigests,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read write" },
  );
}

export async function findSyntheticCleanupReceipt(
  subject: AuthorisationSubject,
  input: unknown,
  db = database(),
) {
  const manifest = parseSyntheticCleanupManifest(input);
  validateAuthenticatedSubject(subject, manifest);
  const [receipt] = await db
    .select()
    .from(schema.syntheticCleanupReceipts)
    .where(
      and(
        eq(
          schema.syntheticCleanupReceipts.organisationId,
          manifest.organisationId,
        ),
        eq(schema.syntheticCleanupReceipts.manifestId, manifest.manifestId),
      ),
    )
    .limit(1);
  if (receipt && receipt.manifestDigest !== manifest.digest) {
    throw new Error("Completed cleanup manifest digest changed");
  }
  return receipt ?? null;
}

export async function listSyntheticCleanupObjectDeletionAttempts(
  subject: AuthorisationSubject,
  input: unknown,
  db = database(),
) {
  const manifest = parseSyntheticCleanupManifest(input);
  validateAuthenticatedSubject(subject, manifest);
  return db
    .select()
    .from(schema.syntheticCleanupObjectDeletionAttempts)
    .where(
      and(
        eq(
          schema.syntheticCleanupObjectDeletionAttempts.organisationId,
          manifest.organisationId,
        ),
        eq(
          schema.syntheticCleanupObjectDeletionAttempts.manifestId,
          manifest.manifestId,
        ),
      ),
    );
}

function pendingObjectVersions(
  manifest: SyntheticCleanupManifest,
  attempts: ReadonlyArray<{
    evidenceId: string;
    versionId: string;
    result: string;
  }>,
) {
  const completed = new Set(
    attempts
      .filter(
        (attempt) =>
          attempt.result === "succeeded" ||
          attempt.result === "observed_missing",
      )
      .map((attempt) => `${attempt.evidenceId}:${attempt.versionId}`),
  );
  return manifest.objectStorageObjects.filter(
    (object) => !completed.has(`${object.evidenceId}:${object.versionId}`),
  );
}

function objectInventoryDigest(objects: readonly SyntheticCleanupObject[]) {
  return sha256(
    canonical(
      [...objects].sort((left, right) =>
        left.evidenceId.localeCompare(right.evidenceId),
      ),
    ),
  );
}

export async function requestSyntheticCleanupObjectRetryApproval(
  subject: AuthorisationSubject,
  input: unknown,
  traceId: string,
  db = database(),
) {
  const retry = SyntheticCleanupObjectRetrySchema.parse(input);
  const manifest = parseSyntheticCleanupManifest(retry.manifest);
  validateAuthenticatedSubject(subject, manifest);
  return db.transaction(
    async (tx) => {
      await validateMaintenanceActor(tx, manifest);
      const [receipt] = await tx
        .select({ digest: schema.syntheticCleanupReceipts.manifestDigest })
        .from(schema.syntheticCleanupReceipts)
        .where(
          and(
            eq(
              schema.syntheticCleanupReceipts.organisationId,
              manifest.organisationId,
            ),
            eq(schema.syntheticCleanupReceipts.manifestId, manifest.manifestId),
          ),
        )
        .limit(1)
        .for("update");
      if (!receipt || receipt.digest !== manifest.digest) {
        throw new Error("Cleanup receipt is unavailable for retry");
      }
      const attempts = await tx
        .select({
          evidenceId: schema.syntheticCleanupObjectDeletionAttempts.evidenceId,
          versionId: schema.syntheticCleanupObjectDeletionAttempts.versionId,
          result: schema.syntheticCleanupObjectDeletionAttempts.result,
        })
        .from(schema.syntheticCleanupObjectDeletionAttempts)
        .where(
          and(
            eq(
              schema.syntheticCleanupObjectDeletionAttempts.organisationId,
              manifest.organisationId,
            ),
            eq(
              schema.syntheticCleanupObjectDeletionAttempts.manifestId,
              manifest.manifestId,
            ),
          ),
        )
        .for("update");
      const pending = pendingObjectVersions(manifest, attempts);
      if (!pending.length) {
        throw new Error("Cleanup has no pending object versions");
      }
      const pendingDigest = objectInventoryDigest(pending);
      const [prior] = await tx
        .select({
          actionType: schema.approvals.actionType,
          target: schema.approvals.target,
        })
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.organisationId, manifest.organisationId),
            eq(schema.approvals.id, retry.retryApprovalId),
          ),
        )
        .limit(1)
        .for("update");
      if (prior) {
        const target = z
          .object({
            manifestId: z.uuid(),
            manifestDigest: digest,
            pendingObjectDigest: digest,
          })
          .safeParse(prior.target);
        if (
          prior.actionType !==
            "maintenance.synthetic-cleanup.object-delete-retry" ||
          !target.success ||
          target.data.manifestId !== manifest.manifestId ||
          target.data.manifestDigest !== manifest.digest ||
          target.data.pendingObjectDigest !== pendingDigest
        ) {
          throw new Error("Cleanup object retry approval ID is already bound");
        }
        return {
          requested: false,
          retryApprovalId: retry.retryApprovalId,
          pendingObjectVersions: pending.length,
          pendingObjectDigest: pendingDigest,
        };
      }
      const action = "maintenance.synthetic-cleanup.object-delete-retry";
      const policy = actionApprovalPolicy[action];
      await tx.insert(schema.approvals).values({
        id: retry.retryApprovalId,
        organisationId: manifest.organisationId,
        requestingActorId: manifest.maintenanceActorId,
        actionType: action,
        target: {
          manifestId: manifest.manifestId,
          manifestDigest: manifest.digest,
          pendingObjectDigest: pendingDigest,
        },
        riskSummary: `Retry or reconcile ${pending.length} exact immutable cleanup object versions.`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        requiredCapability: policy.capability,
        requiredApprovalCount: policy.approvalCount,
        idempotencyKey: `maintenance.synthetic-cleanup:${manifest.manifestId}:object-retry:${retry.retryApprovalId}`,
      });
      await appendAuditEvent(tx, {
        organisationId: manifest.organisationId,
        actorId: manifest.maintenanceActorId,
        actorType: "human",
        action: "maintenance.synthetic_cleanup.object_retry_requested",
        targetType: "cleanup_manifest",
        targetId: manifest.manifestId,
        metadata: {
          retryApprovalId: retry.retryApprovalId,
          pendingObjectDigest: pendingDigest,
          pendingObjectVersions: pending.length,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: manifest.organisationId,
        eventType: "maintenance.synthetic_cleanup.object_retry_requested",
        aggregateType: "cleanup_manifest",
        aggregateId: manifest.manifestId,
        queueName: "muster-outbox",
        payload: {
          manifestId: manifest.manifestId,
          retryApprovalId: retry.retryApprovalId,
          pendingObjectDigest: pendingDigest,
        },
        idempotencyKey: `maintenance.synthetic-cleanup:${manifest.manifestId}:object-retry:${retry.retryApprovalId}:requested`,
        traceId,
      });
      return {
        requested: true,
        retryApprovalId: retry.retryApprovalId,
        pendingObjectVersions: pending.length,
        pendingObjectDigest: pendingDigest,
      };
    },
    { isolationLevel: "serializable", accessMode: "read write" },
  );
}

export async function authoriseSyntheticCleanupObjectRetry(
  subject: AuthorisationSubject,
  input: unknown,
  traceId: string,
  db = database(),
) {
  const retry = SyntheticCleanupObjectRetrySchema.parse(input);
  const manifest = parseSyntheticCleanupManifest(retry.manifest);
  validateAuthenticatedSubject(subject, manifest);
  return db.transaction(
    async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${retry.retryApprovalId}, 0))`,
      );
      await validateMaintenanceActor(tx, manifest);
      const [receipt] = await tx
        .select({ digest: schema.syntheticCleanupReceipts.manifestDigest })
        .from(schema.syntheticCleanupReceipts)
        .where(
          and(
            eq(
              schema.syntheticCleanupReceipts.organisationId,
              manifest.organisationId,
            ),
            eq(schema.syntheticCleanupReceipts.manifestId, manifest.manifestId),
          ),
        )
        .limit(1)
        .for("update");
      if (!receipt || receipt.digest !== manifest.digest) {
        throw new Error("Cleanup receipt is unavailable for retry");
      }
      const attempts = await tx
        .select({
          evidenceId: schema.syntheticCleanupObjectDeletionAttempts.evidenceId,
          versionId: schema.syntheticCleanupObjectDeletionAttempts.versionId,
          result: schema.syntheticCleanupObjectDeletionAttempts.result,
        })
        .from(schema.syntheticCleanupObjectDeletionAttempts)
        .where(
          and(
            eq(
              schema.syntheticCleanupObjectDeletionAttempts.organisationId,
              manifest.organisationId,
            ),
            eq(
              schema.syntheticCleanupObjectDeletionAttempts.manifestId,
              manifest.manifestId,
            ),
          ),
        )
        .for("update");
      const pending = pendingObjectVersions(manifest, attempts);
      if (!pending.length) {
        throw new Error("Cleanup has no pending object versions");
      }
      const pendingDigest = objectInventoryDigest(pending);
      const [approval] = await tx
        .select()
        .from(schema.approvals)
        .where(
          and(
            eq(schema.approvals.organisationId, manifest.organisationId),
            eq(schema.approvals.id, retry.retryApprovalId),
          ),
        )
        .limit(1)
        .for("update");
      const target = z
        .object({
          manifestId: z.uuid(),
          manifestDigest: digest,
          pendingObjectDigest: digest,
        })
        .safeParse(approval?.target);
      const decisions = z
        .array(
          z.object({
            actorId: z.uuid(),
            status: z.enum(["approved", "rejected"]),
          }),
        )
        .safeParse(approval?.decisions);
      const action = "maintenance.synthetic-cleanup.object-delete-retry";
      if (
        !approval ||
        approval.status !== "approved" ||
        approval.actionType !== action ||
        approval.requiredCapability !== "administration.manage" ||
        approval.requiredApprovalCount !==
          actionApprovalPolicy[action].approvalCount ||
        approval.requestingActorId !== manifest.maintenanceActorId ||
        approval.expiresAt <= new Date() ||
        approval.executedAt !== null ||
        !target.success ||
        target.data.manifestId !== manifest.manifestId ||
        target.data.manifestDigest !== manifest.digest ||
        target.data.pendingObjectDigest !== pendingDigest ||
        !decisions.success
      ) {
        throw new Error("Executable cleanup object retry approval is missing");
      }
      assertExecutableApproval(action, decisions.data);
      const approvedActorIds = [
        ...new Set(
          decisions.data
            .filter((decision) => decision.status === "approved")
            .map((decision) => decision.actorId),
        ),
      ];
      if (approvedActorIds.includes(manifest.maintenanceActorId)) {
        throw new Error(
          "Cleanup object retry requires an independent approver",
        );
      }
      const approvers = await tx
        .select({
          id: schema.actors.id,
          status: schema.actors.status,
          capabilities: schema.actors.capabilityAssignments,
        })
        .from(schema.actors)
        .where(
          and(
            eq(schema.actors.organisationId, manifest.organisationId),
            inArray(schema.actors.id, approvedActorIds),
          ),
        )
        .for("update");
      if (
        approvers.length !== approvedActorIds.length ||
        approvers.some((approver) => {
          const capabilities = z
            .array(z.string())
            .safeParse(approver.capabilities);
          return (
            approver.status !== "active" ||
            !capabilities.success ||
            !capabilities.data.includes("administration.manage")
          );
        })
      ) {
        throw new Error("Cleanup object retry approver capability was revoked");
      }
      const [executed] = await tx
        .update(schema.approvals)
        .set({ status: "executed", executedAt: new Date() })
        .where(
          and(
            eq(schema.approvals.organisationId, manifest.organisationId),
            eq(schema.approvals.id, retry.retryApprovalId),
            eq(schema.approvals.status, "approved"),
          ),
        )
        .returning({ id: schema.approvals.id });
      if (!executed) {
        throw new Error("Cleanup object retry approval execution changed");
      }
      await appendAuditEvent(tx, {
        organisationId: manifest.organisationId,
        actorId: manifest.maintenanceActorId,
        actorType: "human",
        action: "maintenance.synthetic_cleanup.object_retry_authorised",
        targetType: "cleanup_manifest",
        targetId: manifest.manifestId,
        metadata: {
          retryApprovalId: retry.retryApprovalId,
          pendingObjectDigest: pendingDigest,
          pendingObjectVersions: pending.length,
        },
        traceId,
      });
      await writeOutbox(tx, {
        organisationId: manifest.organisationId,
        eventType: "maintenance.synthetic_cleanup.object_retry_authorised",
        aggregateType: "cleanup_manifest",
        aggregateId: manifest.manifestId,
        queueName: "muster-outbox",
        payload: {
          manifestId: manifest.manifestId,
          retryApprovalId: retry.retryApprovalId,
          pendingObjectDigest: pendingDigest,
        },
        idempotencyKey: `maintenance.synthetic-cleanup:${manifest.manifestId}:object-retry:${retry.retryApprovalId}:authorised`,
        traceId,
      });
      if (pending.length) {
        await writeOutbox(tx, {
          organisationId: manifest.organisationId,
          eventType: "maintenance.synthetic_cleanup.object_delete.queued",
          aggregateType: "cleanup_object_retry_approval",
          aggregateId: retry.retryApprovalId,
          queueName: "muster-maintenance",
          payload: {
            manifestId: manifest.manifestId,
            authorizationApprovalId: retry.retryApprovalId,
          },
          idempotencyKey: `maintenance.synthetic-cleanup:${manifest.manifestId}:object-retry:${retry.retryApprovalId}:queued`,
          traceId,
        });
      }
      return { authorised: true, pendingObjects: pending };
    },
    { isolationLevel: "serializable", accessMode: "read write" },
  );
}

export async function recordSyntheticCleanupObjectDeletionAttempt(
  subject: AuthorisationSubject,
  input: unknown,
  object: SyntheticCleanupObject,
  authorizationApprovalId: string,
  result: "started" | "succeeded" | "failed" | "observed_missing",
  traceId: string,
  errorCode?: string,
  db = database(),
) {
  const manifest = parseSyntheticCleanupManifest(input);
  validateAuthenticatedSubject(subject, manifest);
  const expected = manifest.objectStorageObjects.find(
    (candidate) => candidate.evidenceId === object.evidenceId,
  );
  if (!expected || canonical(expected) !== canonical(object)) {
    throw new Error("Cleanup deletion attempt object is not manifest-bound");
  }
  return db.transaction(async (tx) => {
    const [receipt] = await tx
      .select({
        digest: schema.syntheticCleanupReceipts.manifestDigest,
        approvalId: schema.syntheticCleanupReceipts.approvalId,
      })
      .from(schema.syntheticCleanupReceipts)
      .where(
        and(
          eq(
            schema.syntheticCleanupReceipts.organisationId,
            manifest.organisationId,
          ),
          eq(schema.syntheticCleanupReceipts.manifestId, manifest.manifestId),
        ),
      )
      .limit(1);
    if (!receipt || receipt.digest !== manifest.digest) {
      throw new Error("Cleanup receipt is unavailable for object deletion");
    }
    const [approval] = await tx
      .select({
        id: schema.approvals.id,
        actionType: schema.approvals.actionType,
        requestingActorId: schema.approvals.requestingActorId,
        status: schema.approvals.status,
        target: schema.approvals.target,
      })
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.organisationId, manifest.organisationId),
          eq(schema.approvals.id, authorizationApprovalId),
        ),
      )
      .limit(1);
    const originalTarget = z
      .object({ manifestId: z.uuid(), digest })
      .safeParse(approval?.target);
    const retryTarget = z
      .object({ manifestId: z.uuid(), manifestDigest: digest })
      .safeParse(approval?.target);
    const originalApproval =
      approval?.id === receipt.approvalId &&
      approval.actionType === "maintenance.synthetic-cleanup" &&
      originalTarget.success &&
      originalTarget.data.manifestId === manifest.manifestId &&
      originalTarget.data.digest === manifest.digest;
    const retryApproval =
      approval?.actionType ===
        "maintenance.synthetic-cleanup.object-delete-retry" &&
      retryTarget.success &&
      retryTarget.data.manifestId === manifest.manifestId &&
      retryTarget.data.manifestDigest === manifest.digest;
    if (
      !approval ||
      approval.status !== "executed" ||
      approval.requestingActorId !== manifest.maintenanceActorId ||
      (!originalApproval && !retryApproval)
    ) {
      throw new Error("Cleanup object deletion approval is not executable");
    }
    const [attempt] = await tx
      .insert(schema.syntheticCleanupObjectDeletionAttempts)
      .values({
        id: newId(),
        manifestId: manifest.manifestId,
        organisationId: manifest.organisationId,
        evidenceId: object.evidenceId,
        versionId: object.versionId,
        authorizationApprovalId,
        result,
        errorCode: errorCode?.slice(0, 200),
        attemptedByActorId: subject.actorId,
        traceId,
      })
      .returning();
    if (!attempt) throw new Error("Cleanup deletion attempt was not recorded");
    return attempt;
  });
}

export async function applySyntheticCleanup(
  subject: AuthorisationSubject,
  input: unknown,
  traceId: string,
  db = database(),
) {
  const manifest = parseSyntheticCleanupManifest(input);
  validateAuthenticatedSubject(subject, manifest);
  try {
    return await db.transaction(
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${manifest.manifestId}, 0))`,
        );
        const [prior] = await tx
          .select()
          .from(schema.syntheticCleanupReceipts)
          .where(
            and(
              eq(
                schema.syntheticCleanupReceipts.organisationId,
                manifest.organisationId,
              ),
              eq(
                schema.syntheticCleanupReceipts.manifestId,
                manifest.manifestId,
              ),
            ),
          )
          .limit(1);
        if (prior) {
          if (prior.manifestDigest !== manifest.digest) {
            throw new Error("Completed cleanup manifest digest changed");
          }
          return {
            applied: false,
            manifestId: manifest.manifestId,
            receipt: prior,
          };
        }

        const now = new Date();
        await validateMaintenanceActor(tx, manifest);
        await validateExecutableApproval(tx, manifest, now);
        const rows = await loadCandidateRows(tx, manifest);
        verifyCandidateRows(manifest, rows);
        const counts = candidateCounts(rows);
        const idempotencyKey = `maintenance.synthetic-cleanup:${manifest.manifestId}`;

        await applyCandidateTransitions(tx, manifest, now, idempotencyKey);
        const postRows = await loadCandidateRows(tx, manifest);
        const postDigests = verifyPostCandidateStates(
          manifest,
          rows,
          postRows,
          now,
        );
        await verifyMessageRevisions(tx, manifest, rows, idempotencyKey);
        const executed = await tx
          .update(schema.approvals)
          .set({ status: "executed", executedAt: now })
          .where(
            and(
              eq(schema.approvals.organisationId, manifest.organisationId),
              eq(schema.approvals.id, manifest.approvalId),
              eq(schema.approvals.status, "approved"),
            ),
          )
          .returning({ id: schema.approvals.id });
        if (executed.length !== 1) {
          throw new Error("Cleanup approval execution changed");
        }
        await tx.insert(schema.syntheticCleanupReceipts).values({
          manifestId: manifest.manifestId,
          organisationId: manifest.organisationId,
          approvalId: manifest.approvalId,
          maintenanceActorId: manifest.maintenanceActorId,
          manifestDigest: manifest.digest,
          manifest,
          candidateCounts: counts,
          preDigests: manifest.tableDigests,
          postDigests,
          objectStorageObjects: manifest.objectStorageObjects,
          traceId,
          appliedAt: now,
        });
        await appendAuditEvent(tx, {
          organisationId: manifest.organisationId,
          actorId: manifest.maintenanceActorId,
          actorType: "human",
          action: "maintenance.synthetic_cleanup.applied",
          targetType: "cleanup_manifest",
          targetId: manifest.manifestId,
          metadata: {
            approvalId: manifest.approvalId,
            digest: manifest.digest,
            candidateCounts: counts,
            preDigests: manifest.tableDigests,
            postDigests,
            objectStorageObjectCount: manifest.objectStorageObjects.length,
          },
          traceId,
        });
        await writeOutbox(tx, {
          organisationId: manifest.organisationId,
          eventType: "maintenance.synthetic_cleanup.applied",
          aggregateType: "cleanup_manifest",
          aggregateId: manifest.manifestId,
          queueName: "muster-outbox",
          payload: {
            manifestId: manifest.manifestId,
            digest: manifest.digest,
            candidateCounts: counts,
            objectStorageObjects: manifest.objectStorageObjects,
          },
          idempotencyKey,
          traceId,
        });
        if (manifest.objectStorageObjects.length) {
          await writeOutbox(tx, {
            organisationId: manifest.organisationId,
            eventType: "maintenance.synthetic_cleanup.object_delete.queued",
            aggregateType: "cleanup_manifest",
            aggregateId: manifest.manifestId,
            queueName: "muster-maintenance",
            payload: {
              manifestId: manifest.manifestId,
              authorizationApprovalId: manifest.approvalId,
            },
            idempotencyKey: `${idempotencyKey}:object-delete:queued`,
            traceId,
          });
        }
        return {
          applied: true,
          manifestId: manifest.manifestId,
          candidateCounts: counts,
          preDigests: manifest.tableDigests,
          postDigests,
          objectStorageObjects: manifest.objectStorageObjects,
        };
      },
      { isolationLevel: "serializable", accessMode: "read write" },
    );
  } catch (error) {
    const cause =
      error && typeof error === "object" && "cause" in error
        ? (error as { cause?: unknown }).cause
        : undefined;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? (cause as { code?: unknown }).code
        : undefined;
    if (code === "40001") {
      const receipt = await findSyntheticCleanupReceipt(subject, manifest, db);
      if (receipt) {
        return {
          applied: false,
          manifestId: manifest.manifestId,
          receipt,
        };
      }
    }
    throw error;
  }
}
