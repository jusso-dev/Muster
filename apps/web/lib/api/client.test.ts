import { describe, expect, it } from "vitest";
import { ApiClientError } from "./client";

describe("ApiClientError", () => {
  it("preserves problem details for UI error states", () => {
    const error = new ApiClientError(
      403,
      "Forbidden",
      "Missing capability",
      "trace-1",
    );
    expect(error.status).toBe(403);
    expect(error.title).toBe("Forbidden");
    expect(error.detail).toBe("Missing capability");
    expect(error.traceId).toBe("trace-1");
    expect(error.message).toBe("Missing capability");
  });
});
