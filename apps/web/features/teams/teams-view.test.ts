import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source() {
  return readFile(new URL("./teams-view.tsx", import.meta.url), "utf8");
}

describe("Teams directory", () => {
  it("only groups by team when the directory actually records one", async () => {
    const view = await source();
    expect(view).toContain('groupedBy: "team"');
    expect(view).toContain('groupedBy: "actorType"');
    expect(view).toContain("entries.some((entry) => entry.team?.trim())");
    // The old view bucketed every teamless actor under "Unassigned", which on
    // real data was the entire organisation.
    expect(view).not.toContain('"Unassigned"');
  });

  it("falls back to the actor split, which is real server data", async () => {
    const view = await source();
    expect(view).toContain("ACTOR_TYPE_LABELS");
    expect(view).toContain('human: "People"');
    expect(view).toContain('agent: "Pack agents"');
    expect(view).toContain('system: "System actors"');
    expect(view).toContain("entry.actorType === actorType");
    // Empty actor types are dropped rather than shown as zero-member groups.
    expect(view).toContain("filter((group) => group.members.length > 0)");
  });

  it("describes what it renders instead of promising team structure", async () => {
    const view = await source();
    expect(view).toContain("by actor type where it does not");
    expect(view).toContain("No directory entry carries a team");
    expect(view).toContain("nothing here invents one");
    expect(view).toContain("No directory members visible");
  });

  it("reads the governed directory and counts actor types exactly", async () => {
    const view = await source();
    expect(view).toContain("useDirectory");
    expect(view).not.toContain("FIXTURE_TEAMS");
    // System actors must never be reported as humans by subtraction.
    expect(view).not.toContain("total - agents");
    expect(view).toContain('entry.actorType === "human"');
  });
});
