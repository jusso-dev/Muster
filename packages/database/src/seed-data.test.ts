import { describe, expect, it } from "vitest";
import { demoDirectRoomSeeds, demoIds } from "./seed-data.ts";

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
});
