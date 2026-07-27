import { describe, expect, it } from "vitest";
import {
  finalResearchAttempt,
  researchRunIdempotencyKey,
  staleResearchEvidence,
} from "./research-scheduler.ts";

describe("Alfie research scheduling", () => {
  it("creates one durable idempotency key per cadence window", () => {
    const start = new Date("2026-07-27T00:00:00.000Z");
    expect(researchRunIdempotencyKey("watchlist", 60, start)).toBe(
      researchRunIdempotencyKey(
        "watchlist",
        60,
        new Date("2026-07-27T00:59:59.000Z"),
      ),
    );
    expect(researchRunIdempotencyKey("watchlist", 60, start)).not.toBe(
      researchRunIdempotencyKey(
        "watchlist",
        60,
        new Date("2026-07-27T01:00:00.000Z"),
      ),
    );
  });

  it("retries twice before recording terminal feed failure and excludes stale evidence", () => {
    expect(finalResearchAttempt(0, 3)).toBe(false);
    expect(finalResearchAttempt(1, 3)).toBe(false);
    expect(finalResearchAttempt(2, 3)).toBe(true);
    expect(
      staleResearchEvidence(
        new Date("2026-04-01T00:00:00.000Z"),
        new Date("2026-07-27T00:00:00.000Z"),
      ),
    ).toBe(true);
  });
});
