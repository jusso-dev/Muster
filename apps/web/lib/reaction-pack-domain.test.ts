import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { AuthorisationSubject } from "@muster/authz";
import {
  inspectReactionAsset,
  ReactionPackDomain,
  reactionAssetMaximumBytes,
} from "./reaction-pack-domain.ts";

async function syntheticPng() {
  return new Uint8Array(
    await sharp({
      create: {
        width: 24,
        height: 16,
        channels: 4,
        background: { r: 28, g: 94, b: 80, alpha: 1 },
      },
    })
      .png()
      .toBuffer(),
  );
}

function input(body: Uint8Array) {
  return {
    packSlug: "synthetic-pack",
    packDisplayName: "Synthetic Pack",
    revision: 1,
    assetName: "steady",
    altText: "A steady synthetic shape",
    mimeType: "image/png",
    body,
  };
}

describe("reaction pack asset governance", () => {
  it("extracts verified metadata and pins the digest", async () => {
    const inspected = await inspectReactionAsset(input(await syntheticPng()));
    expect(inspected).toMatchObject({
      width: 24,
      height: 16,
      frameCount: 1,
    });
    expect(inspected.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects digest mismatch before object storage or persistence", async () => {
    await expect(
      inspectReactionAsset({
        ...input(await syntheticPng()),
        expectedSha256: "0".repeat(64),
      }),
    ).rejects.toMatchObject({
      status: 409,
      title: "Reaction digest mismatch",
    });
  });

  it("rejects oversized media before parsing untrusted content", async () => {
    await expect(
      inspectReactionAsset(
        input(new Uint8Array(reactionAssetMaximumBytes + 1)),
      ),
    ).rejects.toMatchObject({
      status: 413,
      title: "Reaction asset too large",
    });
  });

  it("rejects a declared MIME type that differs from inspected media", async () => {
    await expect(
      inspectReactionAsset({
        ...input(await syntheticPng()),
        mimeType: "image/gif",
      }),
    ).rejects.toMatchObject({
      status: 400,
      title: "Invalid reaction MIME type",
    });
  });

  it("checks administration capability before touching catalog storage", async () => {
    const subject: AuthorisationSubject = {
      organisationId: crypto.randomUUID(),
      actorId: crypto.randomUUID(),
      capabilities: new Set(["rooms.read"]),
    };
    const storage = {
      putObject: vi.fn(),
      getObject: vi.fn(),
    };
    await expect(
      new ReactionPackDomain({} as never, storage).createDraft(
        subject,
        input(await syntheticPng()),
        "synthetic-trace",
      ),
    ).rejects.toThrow("Missing capability: administration.manage");
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});
