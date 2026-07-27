import { describe, expect, it } from "vitest";
import {
  parseSyntheticCleanupManifest,
  protectedDirectMessageIds,
  syntheticCleanupManifestDigest,
  type SyntheticCleanupManifest,
} from "./synthetic-cleanup.ts";

const unsigned: Omit<SyntheticCleanupManifest, "digest"> = {
  version: 1,
  manifestId: "019fa210-0000-7000-8000-000000000001",
  organisationId: "019fa210-0000-7000-8000-000000000002",
  maintenanceActorId: "019fa210-0000-7000-8000-000000000003",
  generatedAt: "2026-07-27T00:00:00.000Z",
  archiveRoomIds: [], hideMessageIds: [], retireEvidenceIds: [],
  rejectAgentMemoryIds: [], disableWatchlistIds: [], tableDigests: {},
};

function manifest(overrides: Partial<SyntheticCleanupManifest> = {}) {
  const value = { ...unsigned, ...overrides } as Omit<SyntheticCleanupManifest, "digest">;
  return { ...value, digest: syntheticCleanupManifestDigest(value) };
}

describe("synthetic cleanup manifest", () => {
  it("accepts exact, digest-bound candidates", () => {
    expect(parseSyntheticCleanupManifest(manifest())).toMatchObject(unsigned);
  });

  it("rejects tampering", () => {
    expect(() => parseSyntheticCleanupManifest({ ...manifest(), archiveRoomIds: ["019fa210-0000-7000-8000-000000000004"] })).toThrow("digest mismatch");
  });

  it("preserves genuine direct messages", () => {
    const value = manifest({ hideMessageIds: [protectedDirectMessageIds[0]] });
    expect(() => parseSyntheticCleanupManifest(value)).toThrow("protected direct message");
  });
});
