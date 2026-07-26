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

  it("redacts secret-shaped error details and trace identifiers", async () => {
    const canary = "synthetic-problem-secret-31";
    const response = problemResponse(
      new Error(`Authorization: Bearer ${canary}`),
      `password=${canary}`,
    );
    const body = JSON.stringify(await response.json());

    expect(body).not.toContain(canary);
    expect(body).toContain("[REDACTED]");
  });
});
