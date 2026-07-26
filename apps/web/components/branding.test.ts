import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import manifest from "../app/manifest";

const iconSizes = [16, 32, 48, 96, 180, 192, 512] as const;

function pngDimensions(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe("Muster product branding", () => {
  it.each(iconSizes)("provides an exact %d px product icon", async (size) => {
    const bytes = await readFile(
      new URL(`../public/icons/muster-${size}.png`, import.meta.url),
    );
    expect(pngDimensions(bytes)).toEqual({ width: size, height: size });
  });

  it("publishes installable PWA icon metadata", () => {
    const metadata = manifest();
    expect(metadata.display).toBe("standalone");
    expect(metadata.icons).toEqual([
      {
        src: "/icons/muster-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/muster-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ]);
  });

  it("has no stale product-logo references or manual M marks", async () => {
    const files = [
      "../app/layout.tsx",
      "../app/login/page.tsx",
      "../app/offline/page.tsx",
      "../components/app-shell.tsx",
      "../proxy.ts",
      "../../../README.md",
    ];
    const source = (
      await Promise.all(
        files.map((file) => readFile(new URL(file, import.meta.url), "utf8")),
      )
    ).join("\n");

    expect(source).not.toContain("/muster-logo.png");
    expect(source).not.toMatch(/>\s*M\s*</);
    expect(source).toContain("Muster shield and tree logo");
    expect(source).toContain("docs/images/muster-security-workspace.png");
  });
});
