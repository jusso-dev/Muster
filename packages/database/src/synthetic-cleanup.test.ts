import { describe, expect, it } from "vitest";
import {
  parseSyntheticCleanupManifest,
  protectedDirectMessageIds,
  syntheticCleanupManifestDigest,
  syntheticCleanupTableDigest,
  syntheticCleanupTableKeys,
  type SyntheticCleanupManifest,
} from "./synthetic-cleanup.ts";

const emptyDigest = syntheticCleanupTableDigest([]);
const provenanceId = "019fa210-0000-7000-8000-000000000099";
const unsigned: Omit<SyntheticCleanupManifest, "digest"> = {
  version: 2,
  manifestId: "019fa210-0000-7000-8000-000000000001",
  approvalId: "019fa210-0000-7000-8000-000000000002",
  organisationId: "019fa210-0000-7000-8000-000000000003",
  maintenanceActorId: "019fa210-0000-7000-8000-000000000004",
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
  tableDigests: Object.fromEntries(
    syntheticCleanupTableKeys.map((table) => [table, emptyDigest]),
  ) as SyntheticCleanupManifest["tableDigests"],
};

function manifest(
  overrides: Partial<Omit<SyntheticCleanupManifest, "digest">> = {},
) {
  const value = {
    ...unsigned,
    ...overrides,
  } as Omit<SyntheticCleanupManifest, "digest">;
  return { ...value, digest: syntheticCleanupManifestDigest(value) };
}

describe("synthetic cleanup manifest", () => {
  it("accepts exact digest-bound candidates and proof", () => {
    const roomId = "019fa210-0000-7000-8000-000000000005";
    const value = manifest({
      archiveRoomIds: [roomId],
      selectionEvidence: [
        {
          table: "rooms",
          recordId: roomId,
          provenanceId,
        },
      ],
    });

    expect(parseSyntheticCleanupManifest(value)).toMatchObject({
      manifestId: unsigned.manifestId,
      archiveRoomIds: [roomId],
    });
  });

  it("rejects tampering", () => {
    expect(() =>
      parseSyntheticCleanupManifest({
        ...manifest(),
        generatedAt: "2026-07-27T01:00:00.000Z",
      }),
    ).toThrow("digest mismatch");
  });

  it("requires proof for every candidate and no unrelated proof", () => {
    const roomId = "019fa210-0000-7000-8000-000000000005";
    expect(() =>
      parseSyntheticCleanupManifest(manifest({ archiveRoomIds: [roomId] })),
    ).toThrow("exactly cover every candidate");

    expect(() =>
      parseSyntheticCleanupManifest(
        manifest({
          selectionEvidence: [
            {
              table: "rooms",
              recordId: roomId,
              provenanceId,
            },
          ],
        }),
      ),
    ).toThrow("exactly cover every candidate");
  });

  it("preserves genuine direct messages", () => {
    const protectedId = protectedDirectMessageIds[0];
    const value = manifest({
      hideMessageIds: [protectedId],
      selectionEvidence: [
        {
          table: "messages",
          recordId: protectedId,
          provenanceId,
        },
      ],
    });
    expect(() => parseSyntheticCleanupManifest(value)).toThrow(
      "protected direct message",
    );
  });

  it("cannot retire the authorised maintenance actor", () => {
    const value = manifest({
      retireActorIds: [unsigned.maintenanceActorId],
      selectionEvidence: [
        {
          table: "actors",
          recordId: unsigned.maintenanceActorId,
          provenanceId,
        },
      ],
    });
    expect(() => parseSyntheticCleanupManifest(value)).toThrow(
      "maintenance actor",
    );
  });

  it("binds object deletion inventory to selected evidence", () => {
    const evidenceId = "019fa210-0000-7000-8000-000000000006";
    expect(() =>
      parseSyntheticCleanupManifest(
        manifest({
          objectStorageObjects: [
            {
              evidenceId,
              bucket: "muster-evidence",
              key: "org/evidence.bin",
              versionId: "synthetic-version-1",
              etag: "synthetic-etag",
              size: 1,
              sha256: "a".repeat(64),
              legalHold: false,
              objectLockMetadata: {},
            },
          ],
        }),
      ),
    ).toThrow("selected evidence");
  });

  it.each(["unversioned", "null"])(
    "rejects mutable object version sentinel %s",
    (versionId) => {
      const evidenceId = "019fa210-0000-7000-8000-000000000006";
      expect(() =>
        parseSyntheticCleanupManifest(
          manifest({
            retireEvidenceIds: [evidenceId],
            selectionEvidence: [
              { table: "evidence", recordId: evidenceId, provenanceId },
            ],
            objectStorageObjects: [
              {
                evidenceId,
                bucket: "muster-evidence",
                key: "org/evidence.bin",
                versionId,
                etag: "synthetic-etag",
                size: 1,
                sha256: "a".repeat(64),
                legalHold: false,
                objectLockMetadata: {},
              },
            ],
          }),
        ),
      ).toThrow("immutable object version");
    },
  );

  it("hashes candidate rows independently of query order", () => {
    const rows = [
      {
        id: "019fa210-0000-7000-8000-000000000008",
        updatedAt: new Date("2026-07-27T00:00:00.000Z"),
      },
      {
        id: "019fa210-0000-7000-8000-000000000007",
        updatedAt: new Date("2026-07-26T00:00:00.000Z"),
      },
    ];
    expect(syntheticCleanupTableDigest(rows)).toBe(
      syntheticCleanupTableDigest([...rows].reverse()),
    );
  });
});
