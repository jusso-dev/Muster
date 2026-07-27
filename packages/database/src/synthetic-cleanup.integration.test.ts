import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  applySyntheticCleanup,
  authoriseSyntheticCleanupObjectRetry,
  captureSyntheticCleanupManifest,
  parseSyntheticCleanupManifest,
  requestSyntheticCleanupApproval,
  requestSyntheticCleanupObjectRetryApproval,
  recordSyntheticCleanupObjectDeletionAttempt,
  type SyntheticCleanupPlan,
} from "./synthetic-cleanup.ts";
import { closeDatabase, database } from "./index.ts";
import * as schema from "./schema.ts";

const integration = process.env.MUSTER_INTEGRATION_TESTS === "true";
const describeIntegration = integration ? describe.sequential : describe.skip;

const organisationId = "019fa300-0000-7000-8000-000000000001";
const otherOrganisationId = "019fa300-0000-7000-8000-000000000002";
const maintenanceActorId = "019fa300-0000-7000-8000-000000000003";
const approverActorId = "019fa300-0000-7000-8000-000000000004";
const syntheticActorId = "019fa300-0000-7000-8000-000000000005";
const directRoomId = "019fa300-0000-7000-8000-000000000006";
const candidateRoomId = "019fa300-0000-7000-8000-000000000007";
const candidateTaskId = "019fa300-0000-7000-8000-000000000008";
const heldEvidenceId = "019fa300-0000-7000-8000-000000000009";
const candidateEvidenceId = "019fa300-0000-7000-8000-000000000010";
const otherRoomId = "019fa300-0000-7000-8000-000000000011";
const guardedRoomId = "019fa300-0000-7000-8000-000000000013";
const protectedAgentId = "019fa300-0000-7000-8000-000000000014";
const otherHumanActorId = "019fa300-0000-7000-8000-000000000012";
const unprovenRoomId = "019fa300-0000-7000-8000-000000000015";
const provenance = {
  candidateRoom: "019fa303-0000-7000-8000-000000000001",
  guardedRoom: "019fa303-0000-7000-8000-000000000002",
  candidateTask: "019fa303-0000-7000-8000-000000000003",
  heldEvidence: "019fa303-0000-7000-8000-000000000004",
  candidateEvidence: "019fa303-0000-7000-8000-000000000005",
  syntheticActor: "019fa303-0000-7000-8000-000000000006",
} as const;
const protectedMessageIds = [
  "019fa05a-fff0-76ce-9084-bf0707206d15",
  "019fa05b-c62c-7368-8166-a23b68e3057f",
  "019fa19f-335e-708e-9ce3-be4083921691",
  "019fa19f-5c96-7402-8784-0324bb98d48c",
] as const;
const operatorSubject = {
  actorId: maintenanceActorId,
  organisationId,
  capabilities: new Set(["administration.manage"] as const),
};

function basePlan(
  suffix: string,
  overrides: Partial<SyntheticCleanupPlan> = {},
): SyntheticCleanupPlan {
  return {
    version: 2,
    manifestId: `019fa301-0000-7000-8000-${suffix.padStart(12, "0")}`,
    approvalId: `019fa302-0000-7000-8000-${suffix.padStart(12, "0")}`,
    organisationId,
    maintenanceActorId,
    generatedAt: "2026-07-27T00:00:00.000Z",
    archiveRoomIds: [],
    archiveTaskIds: [],
    archiveHuntIds: [],
    archiveIntegrationIds: [],
    archiveResearchWatchlistIds: [],
    archiveReportManifestIds: [],
    archiveReportScheduleIds: [],
    hideMessageIds: [],
    retireEvidenceIds: [],
    rejectAgentMemoryIds: [],
    retireActorIds: [],
    selectionEvidence: [],
    objectStorageObjects: [],
    ...overrides,
  };
}

describeIntegration("synthetic cleanup transaction", () => {
  beforeAll(async () => {
    const db = database();
    await db.insert(schema.organisations).values([
      {
        id: organisationId,
        name: "Synthetic Cleanup Integration",
        slug: `synthetic-cleanup-${organisationId}`,
      },
      {
        id: otherOrganisationId,
        name: "Protected Other Organisation",
        slug: `synthetic-cleanup-${otherOrganisationId}`,
      },
    ]);
    await db.insert(schema.actors).values([
      {
        id: maintenanceActorId,
        organisationId,
        actorType: "human",
        displayName: "Synthetic Maintenance Operator",
        identityReference: `synthetic-maintenance:${maintenanceActorId}`,
        capabilityAssignments: ["administration.manage"],
      },
      {
        id: approverActorId,
        organisationId,
        actorType: "human",
        displayName: "Synthetic Cleanup Approver",
        identityReference: `synthetic-approver:${approverActorId}`,
        capabilityAssignments: ["administration.manage"],
      },
      {
        id: syntheticActorId,
        organisationId,
        actorType: "human",
        displayName: "Synthetic Retired User",
        identityReference: `synthetic-user:${syntheticActorId}`,
        capabilityAssignments: [],
      },
      {
        id: protectedAgentId,
        organisationId: otherOrganisationId,
        actorType: "agent",
        displayName: "Protected Synthetic Agent",
        identityReference: `agent:protected-fixture:${protectedAgentId}`,
        capabilityAssignments: [],
      },
      {
        id: otherHumanActorId,
        organisationId: otherOrganisationId,
        actorType: "human",
        displayName: "Protected Other User",
        capabilityAssignments: [],
      },
    ]);
    await db.insert(schema.rooms).values([
      {
        id: directRoomId,
        organisationId: otherOrganisationId,
        name: `protected-direct-${directRoomId}`,
        slug: `protected-direct-${directRoomId}`,
        displayName: "Protected direct room",
        roomType: "direct",
        visibility: "private",
        createdByActorId: otherHumanActorId,
      },
      {
        id: candidateRoomId,
        organisationId,
        name: `synthetic-room-${candidateRoomId}`,
        slug: `synthetic-room-${candidateRoomId}`,
        displayName: "Synthetic cleanup room",
        roomType: "operations",
        createdByActorId: maintenanceActorId,
      },
      {
        id: guardedRoomId,
        organisationId,
        name: `synthetic-guarded-room-${guardedRoomId}`,
        slug: `synthetic-guarded-room-${guardedRoomId}`,
        displayName: "Synthetic guarded cleanup room",
        roomType: "operations",
        createdByActorId: maintenanceActorId,
      },
      {
        id: unprovenRoomId,
        organisationId,
        name: `demo-customer-room-${unprovenRoomId}`,
        slug: `demo-customer-room-${unprovenRoomId}`,
        displayName: "Genuine customer test coordination",
        roomType: "operations",
        visibility: "private",
        createdByActorId: maintenanceActorId,
      },
    ]);
    await db.insert(schema.messages).values(
      protectedMessageIds.map((id) => ({
        id,
        organisationId: otherOrganisationId,
        roomId: directRoomId,
        authorActorId: otherHumanActorId,
        messageType: "text" as const,
        document: { type: "doc", content: [] },
        plainText: `Protected genuine fixture ${id}`,
        idempotencyKey: `protected-fixture:${id}`,
      })),
    );
    await db.insert(schema.roomMemberships).values([
      {
        organisationId: otherOrganisationId,
        roomId: directRoomId,
        actorId: otherHumanActorId,
        membershipRole: "owner",
      },
      {
        organisationId: otherOrganisationId,
        roomId: directRoomId,
        actorId: protectedAgentId,
        membershipRole: "agent_member",
      },
    ]);
    await db.insert(schema.tasks).values({
      id: candidateTaskId,
      organisationId,
      title: "Synthetic completed cleanup task",
      status: "done",
      createdByActorId: maintenanceActorId,
      idempotencyKey: `synthetic-cleanup-task:${candidateTaskId}`,
      completedAt: new Date("2026-07-27T00:00:00.000Z"),
    });
    await db.insert(schema.evidence).values([
      {
        id: heldEvidenceId,
        organisationId,
        fileName: "synthetic-held.bin",
        mimeType: "application/octet-stream",
        size: 1,
        sha256: "b".repeat(64),
        uploadedByActorId: maintenanceActorId,
        classification: "internal",
        source: "synthetic integration fixture",
        storageKey: `synthetic/${heldEvidenceId}`,
        legalHold: true,
      },
      {
        id: candidateEvidenceId,
        organisationId,
        fileName: "synthetic-candidate.bin",
        mimeType: "application/octet-stream",
        size: 1,
        sha256: "c".repeat(64),
        uploadedByActorId: maintenanceActorId,
        classification: "internal",
        source: "synthetic integration fixture",
        storageKey: `synthetic/${candidateEvidenceId}`,
      },
    ]);
    await db.insert(schema.rooms).values({
      id: otherRoomId,
      organisationId: otherOrganisationId,
      name: `protected-other-${otherRoomId}`,
      slug: `protected-other-${otherRoomId}`,
      displayName: "Protected other room",
      roomType: "operations",
      createdByActorId: otherHumanActorId,
    });
    await db.insert(schema.syntheticArtifactProvenance).values([
      {
        id: provenance.candidateRoom,
        organisationId,
        artifactTable: "rooms",
        artifactId: candidateRoomId,
        sourceKind: "test_fixture",
        sourceReference: "synthetic-cleanup-integration",
        recordedByActorId: maintenanceActorId,
      },
      {
        id: provenance.guardedRoom,
        organisationId,
        artifactTable: "rooms",
        artifactId: guardedRoomId,
        sourceKind: "test_fixture",
        sourceReference: "synthetic-cleanup-integration",
        recordedByActorId: maintenanceActorId,
      },
      {
        id: provenance.candidateTask,
        organisationId,
        artifactTable: "tasks",
        artifactId: candidateTaskId,
        sourceKind: "test_fixture",
        sourceReference: "synthetic-cleanup-integration",
        recordedByActorId: maintenanceActorId,
      },
      {
        id: provenance.heldEvidence,
        organisationId,
        artifactTable: "evidence",
        artifactId: heldEvidenceId,
        sourceKind: "test_fixture",
        sourceReference: "synthetic-cleanup-integration",
        recordedByActorId: maintenanceActorId,
      },
      {
        id: provenance.candidateEvidence,
        organisationId,
        artifactTable: "evidence",
        artifactId: candidateEvidenceId,
        sourceKind: "test_fixture",
        sourceReference: "synthetic-cleanup-integration",
        recordedByActorId: maintenanceActorId,
      },
      {
        id: provenance.syntheticActor,
        organisationId,
        artifactTable: "actors",
        artifactId: syntheticActorId,
        sourceKind: "test_fixture",
        sourceReference: "synthetic-cleanup-integration",
        recordedByActorId: maintenanceActorId,
      },
    ]);
  });

  afterAll(closeDatabase);

  it("fails closed for cross-organisation and legal-held candidates", async () => {
    await expect(
      captureSyntheticCleanupManifest(
        operatorSubject,
        basePlan("1", {
          archiveRoomIds: [otherRoomId],
          selectionEvidence: [
            {
              table: "rooms",
              recordId: otherRoomId,
              provenanceId: provenance.candidateRoom,
            },
          ],
        }),
      ),
    ).rejects.toThrow("candidate count or ownership changed");

    await expect(
      captureSyntheticCleanupManifest(
        operatorSubject,
        basePlan("2", {
          retireEvidenceIds: [heldEvidenceId],
          selectionEvidence: [
            {
              table: "evidence",
              recordId: heldEvidenceId,
              provenanceId: provenance.heldEvidence,
            },
          ],
          objectStorageObjects: [
            {
              evidenceId: heldEvidenceId,
              bucket: "synthetic-evidence",
              key: `synthetic/${heldEvidenceId}`,
              versionId: "synthetic-version-held",
              etag: "synthetic-etag-held",
              size: 1,
              sha256: "b".repeat(64),
              legalHold: false,
              objectLockMetadata: {},
            },
          ],
        }),
      ),
    ).rejects.toThrow("held or already retired");

    await expect(
      captureSyntheticCleanupManifest(
        operatorSubject,
        basePlan("5", {
          archiveRoomIds: [unprovenRoomId],
          selectionEvidence: [
            {
              table: "rooms",
              recordId: unprovenRoomId,
              provenanceId: provenance.guardedRoom,
            },
          ],
        }),
      ),
    ).rejects.toThrow("lacks exact append-only synthetic provenance");

    const [held] = await database()
      .select({ state: schema.evidence.retentionState })
      .from(schema.evidence)
      .where(eq(schema.evidence.id, heldEvidenceId));
    expect(held?.state).toBe("active");
  });

  it("does not mutate for pending, stale, or capability-revoked approval", async () => {
    const manifest = await captureSyntheticCleanupManifest(
      operatorSubject,
      basePlan("4", {
        archiveRoomIds: [guardedRoomId],
        selectionEvidence: [
          {
            table: "rooms",
            recordId: guardedRoomId,
            provenanceId: provenance.guardedRoom,
          },
        ],
      }),
    );
    const otherAdminSubject = {
      actorId: approverActorId,
      organisationId,
      capabilities: new Set(["administration.manage"] as const),
    };
    await expect(
      requestSyntheticCleanupApproval(
        otherAdminSubject,
        manifest,
        "trace-cleanup-impersonated-request",
      ),
    ).rejects.toThrow("Missing capability");
    await requestSyntheticCleanupApproval(
      operatorSubject,
      manifest,
      "trace-cleanup-guard-request",
    );
    await expect(
      applySyntheticCleanup(
        otherAdminSubject,
        manifest,
        "trace-cleanup-impersonated-apply",
      ),
    ).rejects.toThrow("Missing capability");
    await expect(
      applySyntheticCleanup(operatorSubject, manifest, "trace-cleanup-pending"),
    ).rejects.toThrow("approval is missing");

    await database()
      .update(schema.approvals)
      .set({
        status: "approved",
        decisions: [
          {
            actorId: maintenanceActorId,
            status: "approved",
            reason: "Invalid self approval",
            decidedAt: "2026-07-27T00:01:00.000Z",
          },
        ],
      })
      .where(eq(schema.approvals.id, manifest.approvalId));
    await expect(
      applySyntheticCleanup(
        operatorSubject,
        manifest,
        "trace-cleanup-self-approved",
      ),
    ).rejects.toThrow("independent approver");

    await database()
      .update(schema.approvals)
      .set({
        decisions: [
          {
            actorId: approverActorId,
            status: "approved",
            reason: "Exact guarded fixture reviewed",
            decidedAt: "2026-07-27T00:02:00.000Z",
          },
        ],
      })
      .where(eq(schema.approvals.id, manifest.approvalId));
    await database()
      .update(schema.actors)
      .set({ capabilityAssignments: [] })
      .where(eq(schema.actors.id, approverActorId));
    await expect(
      applySyntheticCleanup(operatorSubject, manifest, "trace-cleanup-revoked"),
    ).rejects.toThrow("capability was revoked");

    await database()
      .update(schema.actors)
      .set({ capabilityAssignments: ["administration.manage"] })
      .where(eq(schema.actors.id, approverActorId));
    await database()
      .update(schema.approvals)
      .set({
        target: { manifestId: manifest.manifestId, digest: "d".repeat(64) },
      })
      .where(eq(schema.approvals.id, manifest.approvalId));
    await expect(
      applySyntheticCleanup(
        operatorSubject,
        manifest,
        "trace-cleanup-target-drift",
      ),
    ).rejects.toThrow("approval is missing");

    await database()
      .update(schema.approvals)
      .set({
        target: {
          manifestId: manifest.manifestId,
          digest: manifest.digest,
        },
      })
      .where(eq(schema.approvals.id, manifest.approvalId));
    await database()
      .update(schema.rooms)
      .set({ topic: "Changed after exact manifest capture" })
      .where(eq(schema.rooms.id, guardedRoomId));
    await expect(
      applySyntheticCleanup(
        operatorSubject,
        manifest,
        "trace-cleanup-prestate-drift",
      ),
    ).rejects.toThrow("pre-state digest changed");
    await database()
      .update(schema.rooms)
      .set({ topic: "" })
      .where(eq(schema.rooms.id, guardedRoomId));
    await database()
      .update(schema.approvals)
      .set({ expiresAt: new Date("2026-07-26T00:00:00.000Z") })
      .where(eq(schema.approvals.id, manifest.approvalId));
    await expect(
      applySyntheticCleanup(operatorSubject, manifest, "trace-cleanup-expired"),
    ).rejects.toThrow("approval is missing");

    const [room, receipt] = await Promise.all([
      database()
        .select({ archivedAt: schema.rooms.archivedAt })
        .from(schema.rooms)
        .where(eq(schema.rooms.id, guardedRoomId)),
      database()
        .select()
        .from(schema.syntheticCleanupReceipts)
        .where(
          eq(schema.syntheticCleanupReceipts.manifestId, manifest.manifestId),
        ),
    ]);
    expect(room[0]?.archivedAt).toBeNull();
    expect(receipt).toHaveLength(0);
  });

  it("applies the exact approved manifest once and preserves receipt/history", async () => {
    const manifest = await captureSyntheticCleanupManifest(
      operatorSubject,
      basePlan("3", {
        archiveRoomIds: [candidateRoomId],
        archiveTaskIds: [candidateTaskId],
        retireEvidenceIds: [candidateEvidenceId],
        retireActorIds: [syntheticActorId],
        selectionEvidence: [
          {
            table: "rooms",
            recordId: candidateRoomId,
            provenanceId: provenance.candidateRoom,
          },
          {
            table: "tasks",
            recordId: candidateTaskId,
            provenanceId: provenance.candidateTask,
          },
          {
            table: "evidence",
            recordId: candidateEvidenceId,
            provenanceId: provenance.candidateEvidence,
          },
          {
            table: "actors",
            recordId: syntheticActorId,
            provenanceId: provenance.syntheticActor,
          },
        ],
        objectStorageObjects: [
          {
            evidenceId: candidateEvidenceId,
            bucket: "synthetic-evidence",
            key: `synthetic/${candidateEvidenceId}`,
            versionId: "synthetic-version-1",
            etag: "synthetic-etag",
            size: 1,
            sha256: "c".repeat(64),
            legalHold: false,
            objectLockMetadata: {},
          },
        ],
      }),
    );
    const requested = await requestSyntheticCleanupApproval(
      operatorSubject,
      manifest,
      "trace-cleanup-request",
    );
    expect(requested).toMatchObject({ requested: true });
    const duplicateRequest = await requestSyntheticCleanupApproval(
      operatorSubject,
      manifest,
      "trace-cleanup-request-replay",
    );
    expect(duplicateRequest).toMatchObject({ requested: false });

    await database()
      .update(schema.approvals)
      .set({
        status: "approved",
        decisions: [
          {
            actorId: approverActorId,
            status: "approved",
            reason: "Exact synthetic fixture reviewed",
            decidedAt: "2026-07-27T00:01:00.000Z",
          },
        ],
        decisionAt: new Date("2026-07-27T00:01:00.000Z"),
      })
      .where(
        and(
          eq(schema.approvals.organisationId, organisationId),
          eq(schema.approvals.id, manifest.approvalId),
        ),
      );

    const concurrentResults = await Promise.all([
      applySyntheticCleanup(operatorSubject, manifest, "trace-cleanup-apply-a"),
      applySyntheticCleanup(operatorSubject, manifest, "trace-cleanup-apply-b"),
    ]);
    expect(concurrentResults.map((result) => result.applied).sort()).toEqual([
      false,
      true,
    ]);
    expect(concurrentResults.find((result) => result.applied)).toMatchObject({
      applied: true,
      candidateCounts: {
        rooms: 1,
        tasks: 1,
        evidence: 1,
        actors: 1,
      },
    });

    const [
      room,
      task,
      evidence,
      actor,
      approval,
      receipts,
      audits,
      outbox,
      protectedMessages,
    ] = await Promise.all([
      database()
        .select({ archivedAt: schema.rooms.archivedAt })
        .from(schema.rooms)
        .where(eq(schema.rooms.id, candidateRoomId)),
      database()
        .select({ archivedAt: schema.tasks.archivedAt })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, candidateTaskId)),
      database()
        .select({ state: schema.evidence.retentionState })
        .from(schema.evidence)
        .where(eq(schema.evidence.id, candidateEvidenceId)),
      database()
        .select({ status: schema.actors.status })
        .from(schema.actors)
        .where(eq(schema.actors.id, syntheticActorId)),
      database()
        .select({
          status: schema.approvals.status,
          executedAt: schema.approvals.executedAt,
        })
        .from(schema.approvals)
        .where(eq(schema.approvals.id, manifest.approvalId)),
      database()
        .select()
        .from(schema.syntheticCleanupReceipts)
        .where(
          eq(schema.syntheticCleanupReceipts.manifestId, manifest.manifestId),
        ),
      database()
        .select()
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.organisationId, organisationId),
            eq(schema.auditEvents.targetId, manifest.manifestId),
          ),
        ),
      database()
        .select()
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.organisationId, organisationId),
            eq(schema.outboxEvents.aggregateId, manifest.manifestId),
          ),
        ),
      database()
        .select({
          id: schema.messages.id,
          deletedAt: schema.messages.deletedAt,
        })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.organisationId, otherOrganisationId),
            inArray(schema.messages.id, [...protectedMessageIds]),
          ),
        ),
    ]);
    expect(room[0]?.archivedAt).toBeInstanceOf(Date);
    expect(task[0]?.archivedAt).toBeInstanceOf(Date);
    expect(evidence[0]?.state).toBe("retired");
    expect(actor[0]?.status).toBe("inactive");
    expect(approval[0]).toMatchObject({ status: "executed" });
    expect(approval[0]?.executedAt).toBeInstanceOf(Date);
    expect(receipts).toHaveLength(1);
    expect(audits).toHaveLength(2);
    expect(outbox).toHaveLength(3);
    expect(outbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queueName: "muster-maintenance",
          eventType: "maintenance.synthetic_cleanup.object_delete.queued",
          aggregateId: manifest.manifestId,
        }),
      ]),
    );
    expect(protectedMessages).toHaveLength(4);
    expect(
      protectedMessages.every((message) => message.deletedAt === null),
    ).toBe(true);

    let mutationError: unknown;
    try {
      await database()
        .update(schema.syntheticCleanupReceipts)
        .set({ traceId: "tampered" })
        .where(
          eq(schema.syntheticCleanupReceipts.manifestId, manifest.manifestId),
        );
    } catch (error) {
      mutationError = error;
    }
    expect(mutationError).toBeInstanceOf(Error);
    expect(
      `${String(mutationError)} ${String(
        (mutationError as { cause?: unknown }).cause,
      )}`,
    ).toContain("append-only");
    let deleteError: unknown;
    try {
      await database()
        .delete(schema.syntheticCleanupReceipts)
        .where(
          eq(schema.syntheticCleanupReceipts.manifestId, manifest.manifestId),
        );
    } catch (error) {
      deleteError = error;
    }
    expect(
      `${String(deleteError)} ${String(
        (deleteError as { cause?: unknown }).cause,
      )}`,
    ).toContain("append-only");

    await database()
      .insert(schema.syntheticCleanupObjectDeletionAttempts)
      .values({
        id: "019fa304-0000-7000-8000-000000000001",
        manifestId: manifest.manifestId,
        organisationId,
        evidenceId: candidateEvidenceId,
        versionId: "synthetic-version-1",
        authorizationApprovalId: manifest.approvalId,
        result: "started",
        attemptedByActorId: maintenanceActorId,
        traceId: "trace-object-attempt",
      });
    let attemptMutationError: unknown;
    try {
      await database()
        .update(schema.syntheticCleanupObjectDeletionAttempts)
        .set({ result: "succeeded" })
        .where(
          eq(
            schema.syntheticCleanupObjectDeletionAttempts.manifestId,
            manifest.manifestId,
          ),
        );
    } catch (error) {
      attemptMutationError = error;
    }
    expect(
      `${String(attemptMutationError)} ${String(
        (attemptMutationError as { cause?: unknown }).cause,
      )}`,
    ).toContain("append-only");

    let provenanceMutationError: unknown;
    try {
      await database()
        .delete(schema.syntheticArtifactProvenance)
        .where(
          eq(schema.syntheticArtifactProvenance.id, provenance.candidateRoom),
        );
    } catch (error) {
      provenanceMutationError = error;
    }
    expect(
      `${String(provenanceMutationError)} ${String(
        (provenanceMutationError as { cause?: unknown }).cause,
      )}`,
    ).toContain("append-only");
  });

  it("requires a fresh independent approval to reconcile a pending object", async () => {
    const [receipt] = await database()
      .select({ manifest: schema.syntheticCleanupReceipts.manifest })
      .from(schema.syntheticCleanupReceipts)
      .where(
        eq(
          schema.syntheticCleanupReceipts.manifestId,
          "019fa301-0000-7000-8000-000000000003",
        ),
      );
    const manifest = parseSyntheticCleanupManifest(receipt?.manifest);
    const retryApprovalId = "019fa302-0000-7000-8000-000000000099";
    const retry = { manifest, retryApprovalId };
    const requested = await requestSyntheticCleanupObjectRetryApproval(
      operatorSubject,
      retry,
      "trace-object-retry-request",
    );
    expect(requested).toMatchObject({
      requested: true,
      pendingObjectVersions: 1,
    });
    await expect(
      authoriseSyntheticCleanupObjectRetry(
        operatorSubject,
        retry,
        "trace-object-retry-pending",
      ),
    ).rejects.toThrow("approval is missing");
    await expect(
      recordSyntheticCleanupObjectDeletionAttempt(
        operatorSubject,
        manifest,
        manifest.objectStorageObjects[0]!,
        retryApprovalId,
        "observed_missing",
        "trace-object-retry-unapproved-outcome",
      ),
    ).rejects.toThrow("approval is not executable");
    await database()
      .update(schema.approvals)
      .set({
        status: "approved",
        decisions: [
          {
            actorId: approverActorId,
            status: "approved",
            reason: "Exact pending immutable object version reviewed",
            decidedAt: "2026-07-27T00:03:00.000Z",
          },
        ],
        decisionAt: new Date("2026-07-27T00:03:00.000Z"),
      })
      .where(eq(schema.approvals.id, retryApprovalId));
    const authorised = await authoriseSyntheticCleanupObjectRetry(
      operatorSubject,
      retry,
      "trace-object-retry-authorise",
    );
    expect(authorised).toMatchObject({
      authorised: true,
      pendingObjects: [{ evidenceId: candidateEvidenceId }],
    });
    await recordSyntheticCleanupObjectDeletionAttempt(
      operatorSubject,
      manifest,
      manifest.objectStorageObjects[0]!,
      retryApprovalId,
      "observed_missing",
      "trace-object-retry-observed-missing",
    );
    const [attempt, retryJob] = await Promise.all([
      database()
        .select({
          authorizationApprovalId:
            schema.syntheticCleanupObjectDeletionAttempts
              .authorizationApprovalId,
          result: schema.syntheticCleanupObjectDeletionAttempts.result,
        })
        .from(schema.syntheticCleanupObjectDeletionAttempts)
        .where(
          and(
            eq(
              schema.syntheticCleanupObjectDeletionAttempts.manifestId,
              manifest.manifestId,
            ),
            eq(
              schema.syntheticCleanupObjectDeletionAttempts.result,
              "observed_missing",
            ),
          ),
        ),
      database()
        .select({
          aggregateType: schema.outboxEvents.aggregateType,
          aggregateId: schema.outboxEvents.aggregateId,
          queueName: schema.outboxEvents.queueName,
        })
        .from(schema.outboxEvents)
        .where(
          and(
            eq(schema.outboxEvents.organisationId, organisationId),
            eq(
              schema.outboxEvents.idempotencyKey,
              `maintenance.synthetic-cleanup:${manifest.manifestId}:object-retry:${retryApprovalId}:queued`,
            ),
          ),
        ),
    ]);
    expect(attempt[0]).toEqual({
      authorizationApprovalId: retryApprovalId,
      result: "observed_missing",
    });
    expect(retryJob[0]).toEqual({
      aggregateType: "cleanup_object_retry_approval",
      aggregateId: retryApprovalId,
      queueName: "muster-maintenance",
    });
    await expect(
      requestSyntheticCleanupObjectRetryApproval(
        operatorSubject,
        {
          manifest,
          retryApprovalId: "019fa302-0000-7000-8000-000000000100",
        },
        "trace-object-retry-empty",
      ),
    ).rejects.toThrow("no pending object versions");
  });
});
