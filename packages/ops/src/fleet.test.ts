import { describe, expect, it } from "vitest";
import { getFleetSnapshot } from "./services/fleet.ts";
import type { TawnyClient } from "./clients/tawny.ts";

describe("getFleetSnapshot", () => {
  it("classifies offline and stale hosts", async () => {
    const now = new Date("2026-08-03T12:00:00.000Z");
    const tawny = {
      listAgents: async () => [
        {
          id: "a1",
          hostname: "edge-1",
          status: "online",
          last_seen_at: "2026-08-03T11:55:00.000Z",
        },
        {
          id: "a2",
          hostname: "edge-2",
          status: "online",
          // 20 minutes before now → stale at 15m threshold
          last_seen_at: "2026-08-03T11:40:00.000Z",
        },
        {
          id: "a3",
          hostname: "edge-3",
          status: "offline",
          last_seen_at: "2026-08-01T00:00:00.000Z",
        },
      ],
      listAlerts: async () => [
        { agent_id: "a2", title: "noise" },
        { agent_id: "a2", title: "more" },
      ],
    } as unknown as TawnyClient;

    const snap = await getFleetSnapshot(
      tawny,
      { fleetStaleMinutes: 15 },
      now,
    );
    expect(snap.totals.hosts).toBe(3);
    expect(snap.hosts.find((h) => h.id === "a1")?.status).toBe("online");
    expect(snap.hosts.find((h) => h.id === "a2")?.status).toBe("stale");
    expect(snap.hosts.find((h) => h.id === "a2")?.openAlertCount).toBe(2);
    expect(snap.hosts.find((h) => h.id === "a3")?.status).toBe("offline");
  });
});
