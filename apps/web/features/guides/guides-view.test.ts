import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Guides", () => {
  it("documents real data boundaries and board usage", async () => {
    const source = await readFile(
      new URL("./guides-view.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("What Muster is");
    expect(source).toContain("drag");
    expect(source).toContain("No demo seed");
    expect(source).toContain("system of record");
  });
});
