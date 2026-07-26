import { describe, expect, it } from "vitest";
import { TawnyHuntResponseSchema } from "./index.ts";

describe("TawnyHuntResponseSchema", () => {
  it("accepts numeric event IDs returned by Tawny", () => {
    const response = TawnyHuntResponseSchema.parse({
      match_count: 1,
      matches: [
        {
          event_id: 42,
          agent_id: "018f55d8-c4c7-7c3e-88ef-000000000001",
          hostname: "SYNTHETIC-01",
          event_type: "process",
          occurred_at: "2026-07-26T06:21:08Z",
          received_at: "2026-07-26T06:21:10Z",
          payload: {},
        },
      ],
      warnings: [],
    });

    expect(response.matches[0]?.eventId).toBe(42);
  });
});
