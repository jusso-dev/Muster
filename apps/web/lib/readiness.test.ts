import { describe, expect, it, vi } from "vitest";
import { runReadinessChecks } from "./readiness.ts";

describe("readiness checks", () => {
  it("reports every healthy serving dependency", async () => {
    const report = await runReadinessChecks([
      { name: "postgresql", check: vi.fn().mockResolvedValue(undefined) },
      { name: "redis", check: vi.fn().mockResolvedValue(undefined) },
      { name: "object_storage", check: vi.fn().mockResolvedValue(undefined) },
      { name: "agent_gateway", check: vi.fn().mockResolvedValue(undefined) },
    ]);

    expect(report).toEqual({
      status: "ready",
      dependencies: [
        { name: "postgresql", status: "ready" },
        { name: "redis", status: "ready" },
        { name: "object_storage", status: "ready" },
        { name: "agent_gateway", status: "ready" },
      ],
    });
  });

  it("returns a degraded report without exposing dependency errors", async () => {
    const report = await runReadinessChecks([
      { name: "postgresql", check: vi.fn().mockResolvedValue(undefined) },
      {
        name: "object_storage",
        check: vi.fn().mockRejectedValue(new Error("credential=must-not-leak")),
      },
    ]);

    expect(report).toEqual({
      status: "degraded",
      dependencies: [
        { name: "postgresql", status: "ready" },
        { name: "object_storage", status: "unavailable" },
      ],
    });
    expect(JSON.stringify(report)).not.toContain("credential=");
  });

  it("bounds stalled dependencies", async () => {
    const report = await runReadinessChecks(
      [
        {
          name: "redis",
          check: () => new Promise<void>(() => undefined),
        },
      ],
      10,
    );

    expect(report).toEqual({
      status: "degraded",
      dependencies: [{ name: "redis", status: "unavailable" }],
    });
  });
});
