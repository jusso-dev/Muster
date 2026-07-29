import { describe, expect, it } from "vitest";
import { FIXTURE_CAPABILITY_PACKS } from "./capabilities";
import { FIXTURE_TEAMS } from "./teams";

describe("fixture adapters", () => {
  it("marks capability packs as fixture origin", () => {
    expect(FIXTURE_CAPABILITY_PACKS.length).toBeGreaterThanOrEqual(5);
    for (const pack of FIXTURE_CAPABILITY_PACKS) {
      expect(pack.origin).toBe("fixture");
      expect(pack.id.startsWith("fixture:")).toBe(true);
    }
  });

  it("marks teams as fixture origin and not system constants", () => {
    expect(FIXTURE_TEAMS.length).toBeGreaterThanOrEqual(5);
    for (const team of FIXTURE_TEAMS) {
      expect(team.origin).toBe("fixture");
      expect(team.id.startsWith("fixture:")).toBe(true);
    }
  });
});
