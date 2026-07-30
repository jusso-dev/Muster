import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const viewUrl = new URL("./missions-view.tsx", import.meta.url);

describe("Missions empty state", () => {
  it("names the governed tool and the prerequisites for calling it", async () => {
    const source = await readFile(viewUrl, "utf8");
    expect(source).toContain("muster_upsert_mission");
    expect(source).toContain("workflows.manage");
    expect(source).toContain("create-installation");
    expect(source).toContain('href="/guides"');
  });

  it("does not offer a UI create path", async () => {
    const source = await readFile(viewUrl, "utf8");
    expect(source).toContain("no create path by design");
    expect(source).not.toContain("New mission");
    expect(source).not.toContain("useUpsertMission");
  });
});
