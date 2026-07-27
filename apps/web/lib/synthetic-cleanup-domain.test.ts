import { afterEach, describe, expect, it, vi } from "vitest";
import * as database from "@muster/database";
import {
  syntheticCleanupManifestDigest,
  syntheticCleanupTableDigest,
  syntheticCleanupTableKeys,
  type SyntheticCleanupManifest,
  type SyntheticCleanupPlan,
} from "@muster/database";
import { SyntheticCleanupDomainService } from "./synthetic-cleanup-domain.ts";

const evidenceId = "019fa400-0000-7000-8000-000000000001";
const plan: SyntheticCleanupPlan = {
  version: 2,
  manifestId: "019fa400-0000-7000-8000-000000000002",
  approvalId: "019fa400-0000-7000-8000-000000000003",
  organisationId: "019fa400-0000-7000-8000-000000000004",
  maintenanceActorId: "019fa400-0000-7000-8000-000000000005",
  generatedAt: "2026-07-27T00:00:00.000Z",
  archiveRoomIds: [],
  archiveTaskIds: [],
  archiveHuntIds: [],
  archiveIntegrationIds: [],
  archiveResearchWatchlistIds: [],
  archiveReportManifestIds: [],
  archiveReportScheduleIds: [],
  hideMessageIds: [],
  retireEvidenceIds: [evidenceId],
  rejectAgentMemoryIds: [],
  retireActorIds: [],
  selectionEvidence: [
    {
      table: "evidence",
      recordId: evidenceId,
      provenanceId: "019fa400-0000-7000-8000-000000000006",
    },
  ],
  objectStorageObjects: [
    {
      evidenceId,
      bucket: "muster-evidence",
      key: `synthetic/${evidenceId}`,
      versionId: "synthetic-version-1",
      etag: "synthetic-etag",
      size: 42,
      sha256: "a".repeat(64),
      legalHold: false,
      objectLockMetadata: {},
    },
  ],
};

function manifest(): SyntheticCleanupManifest {
  const tableDigests = Object.fromEntries(
    syntheticCleanupTableKeys.map((table) => [
      table,
      syntheticCleanupTableDigest([]),
    ]),
  ) as SyntheticCleanupManifest["tableDigests"];
  const unsigned = { ...plan, tableDigests };
  return {
    ...unsigned,
    digest: syntheticCleanupManifestDigest(unsigned),
  };
}

const subject = {
  actorId: plan.maintenanceActorId,
  organisationId: plan.organisationId,
  capabilities: new Set(["administration.manage"] as const),
};

describe("synthetic cleanup maintenance endpoint", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects an unauthorised subject before capture work", async () => {
    const capture = vi.spyOn(database, "captureSyntheticCleanupManifest");
    await expect(
      new SyntheticCleanupDomainService().execute(
        { ...subject, capabilities: new Set() },
        { mode: "capture", payload: plan },
        "trace-forbidden",
      ),
    ).rejects.toThrow("Missing capability");
    expect(capture).not.toHaveBeenCalled();
  });

  it("rejects a tampered manifest before database or external work", async () => {
    const verify = vi.spyOn(database, "verifySyntheticCleanup");
    await expect(
      new SyntheticCleanupDomainService().execute(
        subject,
        {
          mode: "verify",
          payload: { ...manifest(), generatedAt: "2026-07-27T01:00:00.000Z" },
        },
        "trace-tampered",
      ),
    ).rejects.toThrow("digest mismatch");
    expect(verify).not.toHaveBeenCalled();
  });

  it("queues object deletion instead of doing storage work in HTTP", async () => {
    const captured = manifest();
    vi.spyOn(database, "findSyntheticCleanupReceipt").mockResolvedValueOnce(
      null,
    );
    vi.spyOn(database, "applySyntheticCleanup").mockResolvedValueOnce({
      applied: true,
      manifestId: captured.manifestId,
      objectStorageObjects: captured.objectStorageObjects,
    } as never);
    await expect(
      new SyntheticCleanupDomainService().execute(
        subject,
        { mode: "apply", payload: captured },
        "trace-apply",
      ),
    ).resolves.toMatchObject({
      applied: true,
      objectDeletionQueued: true,
      pendingObjectVersions: 1,
    });
  });

  it("reports receipt outcomes without requeueing deletion", async () => {
    const captured = manifest();
    vi.spyOn(database, "findSyntheticCleanupReceipt").mockResolvedValueOnce({
      manifestId: captured.manifestId,
    } as never);
    vi.spyOn(database, "applySyntheticCleanup").mockResolvedValueOnce({
      applied: false,
      manifestId: captured.manifestId,
      receipt: { manifestId: captured.manifestId },
    } as never);
    vi.spyOn(
      database,
      "listSyntheticCleanupObjectDeletionAttempts",
    ).mockResolvedValueOnce([
      {
        evidenceId,
        versionId: "synthetic-version-1",
        result: "succeeded",
      },
    ] as never);
    await expect(
      new SyntheticCleanupDomainService().execute(
        subject,
        { mode: "apply", payload: captured },
        "trace-replay",
      ),
    ).resolves.toMatchObject({
      applied: false,
      objectDeletionQueued: false,
      deletedOrReconciledObjectVersions: 1,
      pendingObjectVersions: 0,
    });
  });

  it("queues only a freshly authorised retry", async () => {
    const captured = manifest();
    vi.spyOn(
      database,
      "authoriseSyntheticCleanupObjectRetry",
    ).mockResolvedValueOnce({
      authorised: true,
      pendingObjects: captured.objectStorageObjects,
    });
    await expect(
      new SyntheticCleanupDomainService().execute(
        subject,
        {
          mode: "retry_object_deletion",
          payload: {
            manifest: captured,
            retryApprovalId: "019fa400-0000-7000-8000-000000000099",
          },
        },
        "trace-retry",
      ),
    ).resolves.toMatchObject({
      authorised: true,
      objectDeletionQueued: true,
    });
  });
});
