import { describe, expect, it } from "vitest";
import {
  assertCleanupObjectContent,
  assertCleanupObjectVersion,
  canReconcileMissingObject,
} from "./synthetic-cleanup-object.ts";

const object = {
  evidenceId: "019fa500-0000-7000-8000-000000000001",
  bucket: "muster-evidence",
  key: "synthetic/evidence.bin",
  versionId: "immutable-version-1",
  etag: "synthetic-etag",
  size: 42,
  sha256: "a".repeat(64),
  legalHold: false as const,
  objectLockMetadata: {},
};

describe("synthetic cleanup object worker", () => {
  it("accepts only the exact unlocked immutable version", () => {
    expect(() =>
      assertCleanupObjectVersion(object, {
        versionId: object.versionId,
        etag: object.etag,
        size: object.size,
        legalHold: false,
        objectLockMetadata: {},
      }),
    ).not.toThrow();
  });

  it.each([
    null,
    {
      versionId: "replacement-version",
      etag: object.etag,
      size: object.size,
      legalHold: false,
      objectLockMetadata: {},
    },
    {
      versionId: object.versionId,
      etag: object.etag,
      size: object.size,
      legalHold: true,
      objectLockMetadata: {},
    },
  ])("rejects missing, replaced, or held versions", (actual) => {
    expect(() => assertCleanupObjectVersion(object, actual)).toThrow(
      "metadata changed or is locked",
    );
  });

  it("reconciles missing only after a started attempt or fresh retry approval", () => {
    expect(
      canReconcileMissingObject(
        "cleanup_manifest",
        object,
        "019fa500-0000-7000-8000-000000000002",
        [],
      ),
    ).toBe(false);
    expect(
      canReconcileMissingObject(
        "cleanup_manifest",
        object,
        "019fa500-0000-7000-8000-000000000002",
        [
          {
            evidenceId: object.evidenceId,
            versionId: object.versionId,
            authorizationApprovalId: "019fa500-0000-7000-8000-000000000002",
            result: "started",
          },
        ],
      ),
    ).toBe(true);
    expect(
      canReconcileMissingObject(
        "cleanup_object_retry_approval",
        object,
        "019fa500-0000-7000-8000-000000000003",
        [],
      ),
    ).toBe(true);
  });

  it("requires the exact version bytes before deletion", () => {
    const body = new TextEncoder().encode("synthetic cleanup bytes");
    const expected = {
      size: body.byteLength,
      sha256:
        "14891e06ce2b55d8366b303bda6a77dfdae4ea662102e96b08f767b61458eae2",
    };
    expect(() => assertCleanupObjectContent(expected, body)).not.toThrow();
    expect(() =>
      assertCleanupObjectContent(expected, new TextEncoder().encode("changed")),
    ).toThrow("content digest changed");
  });
});
