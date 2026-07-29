import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { FIXTURE_CAPABILITY_PACKS } from "./capabilities";
import { FIXTURE_TEAMS } from "./teams";

describe("fixture adapters", () => {
  it("keeps fixtures marked fixture-only and out of product UI", async () => {
    expect(FIXTURE_CAPABILITY_PACKS.length).toBeGreaterThanOrEqual(5);
    for (const pack of FIXTURE_CAPABILITY_PACKS) {
      expect(pack.origin).toBe("fixture");
      expect(pack.id.startsWith("fixture:")).toBe(true);
    }
    expect(FIXTURE_TEAMS.length).toBeGreaterThanOrEqual(5);
    for (const team of FIXTURE_TEAMS) {
      expect(team.origin).toBe("fixture");
      expect(team.id.startsWith("fixture:")).toBe(true);
    }

    const teamsView = await readFile(
      new URL("../../../features/teams/teams-view.tsx", import.meta.url),
      "utf8",
    );
    const capsView = await readFile(
      new URL(
        "../../../features/capabilities/capabilities-view.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(teamsView).not.toContain("FIXTURE_TEAMS");
    expect(capsView).not.toContain("FIXTURE_CAPABILITY_PACKS");
    expect(teamsView).toContain("No teams configured");
    expect(capsView).toContain("No installed capabilities listed");
  });
});
