import { describe, expect, it } from "vitest";
import { readinessResponse } from "./route.ts";

describe("GET /api/v1/ready", () => {
  it("returns non-2xx when a required dependency is unavailable", async () => {
    const response = readinessResponse({
      status: "degraded",
      dependencies: [
        { name: "postgresql", status: "ready" },
        { name: "redis", status: "unavailable" },
      ],
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      dependencies: [
        { name: "postgresql", status: "ready" },
        { name: "redis", status: "unavailable" },
      ],
    });
  });
});
