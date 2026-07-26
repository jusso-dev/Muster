import { describe, expect, it, vi } from "vitest";
import { publishRealtime } from "./realtime.ts";

describe("realtime publishing", () => {
  it("reports degraded delivery instead of rejecting durable writes", async () => {
    const publish = vi
      .fn()
      .mockRejectedValue(new Error("Synthetic Redis outage"));
    await expect(
      publishRealtime("synthetic-organisation", { type: "synthetic" }, () => ({
        status: "ready",
        connect: vi.fn().mockResolvedValue(undefined),
        publish,
      })),
    ).resolves.toBe(false);
  });
});
