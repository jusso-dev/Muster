import { describe, expect, it } from "vitest";
import { buildParkerManifest, CreateParkerReportSchema } from "./parker-report-domain";

const at = (minute: number) => new Date(`2026-07-01T00:${String(minute).padStart(2, "0")}:00.000Z`);

describe("Parker report aggregates", () => {
  it("keeps exact metrics, unavailable values, and reproducible sources", () => {
    const manifest = buildParkerManifest(
      CreateParkerReportSchema.parse({ roomId: "00000000-0000-4000-8000-000000000001", audience: "executive", timezone: "Australia/Sydney", period: { from: at(0), to: at(59) }, idempotencyKey: "parker-known-dataset" }),
      {
        alerts: [
          { id: "a", receivedAt: at(0), investigationId: "i", correlationKey: "same" },
          { id: "b", receivedAt: at(1), investigationId: "i", correlationKey: "same" },
        ] as never,
        investigations: [{ id: "i", createdAt: at(10), closedAt: at(40) }] as never,
        approvals: [{ requestedAt: at(2), decisionAt: at(22) }] as never,
        agentRuns: [{ startedAt: at(3), completedAt: at(4), status: "failed" }, { startedAt: at(5), completedAt: at(6), status: "completed" }] as never,
        workflowRuns: [{ startedAt: at(7), completedAt: at(8), status: "failed" }] as never,
      },
    );
    const values = Object.fromEntries(manifest.values.map((value) => [value.key, value]));
    expect(values.mtta).toMatchObject({ state: "unavailable", value: null });
    expect(values.time_to_investigation).toMatchObject({ value: 9.5, sampleSize: 2 });
    expect(values.approval_wait).toMatchObject({ value: 20 });
    expect(values.mttr).toMatchObject({ value: 30 });
    expect(values.recurrence_rate).toMatchObject({ value: 100 });
    expect(values.agent_failure_rate).toMatchObject({ value: 50 });
    expect(values.workflow_failure_rate).toMatchObject({ value: 100 });
    expect(manifest.sourceReferences).toHaveLength(5);
    expect(manifest.classification).toBe("internal");
  });

  it("uses not applicable instead of inventing empty-period metrics", () => {
    const manifest = buildParkerManifest(
      CreateParkerReportSchema.parse({ roomId: "00000000-0000-4000-8000-000000000001", period: { from: at(0), to: at(1) }, idempotencyKey: "parker-empty-period" }),
      { alerts: [], investigations: [], approvals: [], agentRuns: [], workflowRuns: [] } as never,
    );
    expect(manifest.values.find((value) => value.key === "mttr")).toMatchObject({ state: "not_applicable", value: null });
  });

  it("uses a half-open period, preserves an IANA timezone, and omits sensitive evidence", () => {
    const input = CreateParkerReportSchema.parse({
      roomId: "00000000-0000-4000-8000-000000000001",
      audience: "analyst",
      timezone: "Australia/Sydney",
      period: { from: at(0), to: at(1) },
      idempotencyKey: "parker-period-boundary",
    });
    const manifest = buildParkerManifest(input, {
      alerts: [{ id: "outside", receivedAt: at(1), correlationKey: "sensitive-correlation-key" }],
      investigations: [],
      approvals: [],
      agentRuns: [],
      workflowRuns: [],
    } as never);

    expect(manifest.period).toMatchObject({ timezone: "Australia/Sydney" });
    expect(manifest.classification).toBe("restricted");
    expect(manifest.values.find((value) => value.key === "recurrence_rate")).toMatchObject({ state: "not_applicable", sampleSize: 0 });
    expect(manifest.narrative).not.toContain("sensitive-correlation-key");
    expect(() => CreateParkerReportSchema.parse({ ...input, timezone: "not/a-timezone" })).toThrow("IANA timezone");
  });
});
