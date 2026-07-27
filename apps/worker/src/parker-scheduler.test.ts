import { describe, expect, it } from "vitest";
import { nextScheduledReportRun } from "./parker-scheduler";

describe("Parker scheduler", () => {
  it("advances deterministic weekly and monthly occurrences", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    expect(nextScheduledReportRun("weekly", now).toISOString()).toBe("2026-07-08T00:00:00.000Z");
    expect(nextScheduledReportRun("monthly", now).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});
