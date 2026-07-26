import { describe, expect, it } from "vitest";
import { problemResponse } from "./api-context";

describe("problemResponse", () => {
  it("conceals room membership failures as not found", async () => {
    const response = problemResponse(
      new Error("Room membership required"),
      "trace-room-membership",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      title: "Not found",
      detail: "Room not found.",
      traceId: "trace-room-membership",
    });
  });

  it("keeps ordinary domain validation failures as bad requests", async () => {
    const response = problemResponse(
      new Error("Invalid transition"),
      "trace-validation",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      title: "Request failed",
      detail: "Invalid transition",
    });
  });
});
