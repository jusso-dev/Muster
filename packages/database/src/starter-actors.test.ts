import { describe, expect, it } from "vitest";
import { capabilities, starterRoleCapabilities } from "@muster/authz";
import { starterActorSeeds, starterIds } from "./seed-data.ts";

const seeds = starterActorSeeds("admin@muster.local");
const administrator = seeds.find(
  (seed) => seed.id === starterIds.actors.jordan,
);
const agents = seeds.filter((seed) => seed.actorType === "agent");

describe("bootstrap starter actors", () => {
  it("grants the administrator every declared capability", () => {
    // Bootstrap overwrites capability_assignments on every boot, so a
    // capability missing here is a capability the administrator permanently
    // loses, migration backfill included.
    expect(administrator).toBeDefined();
    expect(new Set(administrator?.capabilityAssignments)).toEqual(
      new Set(capabilities),
    );
    expect(new Set(administrator?.capabilityAssignments)).toEqual(
      new Set(starterRoleCapabilities.administrator),
    );
  });

  it("assigns only declared capabilities to every starter actor", () => {
    const declared = new Set<string>(capabilities);
    const undeclared = seeds.flatMap((seed) =>
      seed.capabilityAssignments.filter(
        (capability) => !declared.has(capability),
      ),
    );
    expect(undeclared).toEqual([]);
  });

  it("keeps starter agents below administrator privilege", () => {
    expect(agents).toHaveLength(3);
    for (const agent of agents) {
      expect(agent.capabilityAssignments).not.toContain(
        "administration.manage",
      );
      expect(agent.capabilityAssignments.length).toBeLessThan(
        capabilities.length,
      );
    }
  });

  it("takes the administrator identity from the configured email", () => {
    expect(starterActorSeeds("operator@example.test")[0]).toMatchObject({
      actorType: "human",
      identityReference: "operator@example.test",
    });
  });
});
