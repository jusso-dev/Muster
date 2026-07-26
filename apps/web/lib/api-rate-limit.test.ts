import { describe, expect, it, vi } from "vitest";
import { enforceApiRateLimit } from "./api-rate-limit.ts";

describe("API rate limiting", () => {
  it("rejects counters above the fixed-window limit", async () => {
    const redis = {
      eval: vi.fn().mockResolvedValue([31, 42]),
    };
    await expect(
      enforceApiRateLimit("synthetic", 30, 60, redis),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("fails open when Redis is unavailable", async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error("Synthetic Redis outage")),
    };
    await expect(
      enforceApiRateLimit("synthetic", 30, 60, redis),
    ).resolves.toBeUndefined();
  });
});
