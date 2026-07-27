import { describe, expect, it } from "vitest";
import { demoDirectRoomSeeds, demoIds, starterIds } from "./seed-data.ts";

function leafIds(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(leafIds);
}

describe("demonstration direct rooms", () => {
  it("seeds every declared direct-room ID with its intended membership", () => {
    expect(demoDirectRoomSeeds.map((room) => room.id)).toEqual([
      demoIds.rooms.mayaDirect,
      demoIds.rooms.triageDirect,
      demoIds.rooms.tawnyDirect,
      demoIds.rooms.parkerDirect,
    ]);
    expect(new Set(demoDirectRoomSeeds.map((room) => room.id)).size).toBe(4);

    expect(demoDirectRoomSeeds.map((room) => room.members).flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: demoIds.actors.triage,
          membershipRole: "agent_member",
        }),
        expect.objectContaining({
          actorId: demoIds.actors.tawnyHunt,
          membershipRole: "agent_member",
        }),
        expect.objectContaining({
          actorId: demoIds.actors.threatIntel,
          membershipRole: "agent_member",
        }),
      ]),
    );
  });

  it("cannot target the clean-install bootstrap organisation", () => {
    const bootstrap = new Set(leafIds(starterIds));
    const demo = leafIds(demoIds);

    expect(demoIds.organisation).not.toBe(starterIds.organisation);
    expect(new Set(demo).size).toBe(demo.length);
    expect(demo.filter((id) => bootstrap.has(id))).toEqual([]);
  });
});
