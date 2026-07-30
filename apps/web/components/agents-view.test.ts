import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const viewUrl = new URL("./agents-view.tsx", import.meta.url);

describe("Agent directory", () => {
  it("describes agents, not humans", async () => {
    const source = await readFile(viewUrl, "utf8");
    expect(source).toContain("Permission-scoped pack agents");
    expect(source).not.toContain("human collaborators");
  });

  it("offers onboard agent via the governed API", async () => {
    const source = await readFile(viewUrl, "utf8");
    expect(source).toContain("Onboard agent");
    expect(source).toContain('method: "POST"');
    expect(source).toContain("/api/v1/agents");
    expect(source).toContain("agents.manage");
  });

  it("explains how Kelpie, Tawny, and Brolga data is reached", async () => {
    const source = await readFile(viewUrl, "utf8");
    expect(source).toContain("muster_search_kelpie_cases");
    expect(source).toContain("muster_list_tawny_endpoints");
    expect(source).toContain("muster_get_brolga_context");
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
