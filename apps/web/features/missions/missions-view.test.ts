import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const viewUrl = new URL("./missions-view.tsx", import.meta.url);

describe("Missions UI control", () => {
  it("offers create/edit/archive with revision notes", async () => {
    const source = await readFile(viewUrl, "utf8");
    expect(source).toContain("New mission");
    expect(source).toContain("Save new revision");
    expect(source).toContain("Archive");
    expect(source).toContain("changeSummary");
    expect(source).toContain("workflows.manage");
  });

  it("still documents Hermes MCP as an alternate write path", async () => {
    const source = await readFile(viewUrl, "utf8");
    expect(source).toContain("muster_accept_mission_run");
    expect(source).toContain("muster_upsert_mission");
  });
});
