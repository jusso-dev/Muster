import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const viewUrl = new URL("./agents-view.tsx", import.meta.url);

describe("Agent directory", () => {
  it("describes agents, not humans", async () => {
    const source = await readFile(viewUrl, "utf8");
    expect(source).toContain(
      'description="Permission-scoped agents with governed learning"',
    );
    expect(source).not.toContain("human collaborators");
  });

  it("offers no affordance for agent creation, which has no API", async () => {
    const source = await readFile(viewUrl, "utf8");
    expect(source).not.toContain("New agent");
  });
});

describe("Agent detail", () => {
  it("routes work assignment to the operations board", async () => {
    const source = await readFile(viewUrl, "utf8");
    expect(source).toContain('href="/operations"');
    expect(source).toContain("Assign work");
    expect(source).not.toContain("Invoke");
  });

  it("keeps every remaining disabled control tied to live state", async () => {
    const source = await readFile(viewUrl, "utf8");
    for (const match of source.matchAll(/disabled(?:={([^}]*)})?/g)) {
      expect(match[1], "permanently disabled control").toBeTruthy();
    }
  });
});
