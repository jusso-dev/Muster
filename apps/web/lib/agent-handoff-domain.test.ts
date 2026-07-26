import { describe, expect, it } from "vitest";
import {
  AGENT_HANDOFF_MAX_ARTIFACTS,
  AGENT_HANDOFF_OUTCOME_MAX,
  buildAgentHandoff,
  type HandoffEvidenceRecord,
  type HandoffEventRecord,
  type HandoffRunRecord,
  type HandoffTaskRecord,
} from "./agent-handoff-domain";

const organisationId = "org-a";
const roomId = "room-a";
const runId = "019c9dc6-7c2e-7ca4-9b9d-a6645896a001";
const completedAt = new Date("2026-07-26T21:00:00.000Z");

function task(values: Partial<HandoffTaskRecord> = {}): HandoffTaskRecord {
  return {
    id: "task-a",
    organisationId,
    title: "Review synthetic endpoint activity",
    description: "Determine whether the endpoint activity needs escalation.",
    roomId,
    agentRunId: runId,
    agentRunStatus: "completed",
    ...values,
  };
}

function run(values: Partial<HandoffRunRecord> = {}): HandoffRunRecord {
  return {
    id: runId,
    organisationId,
    roomId,
    status: "completed",
    request: { humanRequest: "Review the synthetic endpoint activity." },
    structuredOutput: {
      summary: "No malicious activity was found.",
      evidenceReferences: [],
    },
    failureCode: null,
    error: null,
    cancellationReason: null,
    startedAt: new Date(completedAt.getTime() - 60_000),
    completedAt,
    ...values,
  };
}

function event(values: Partial<HandoffEventRecord> = {}): HandoffEventRecord {
  return {
    organisationId,
    runId,
    eventType: "verification_passed",
    message: "Synthetic checks passed against retained evidence.",
    createdAt: completedAt,
    ...values,
  };
}

function evidence(
  id: string,
  values: Partial<HandoffEvidenceRecord> = {},
): HandoffEvidenceRecord {
  return {
    id,
    organisationId,
    relatedRoomId: roomId,
    fileName: `synthetic-${id.slice(-4)}.json`,
    mimeType: "application/json",
    scanState: "clean",
    retentionState: "active",
    ...values,
  };
}

describe("completed agent handoff", () => {
  it.each([
    ["completed", {}, {}, "completed"],
    [
      "partial",
      { agentRunStatus: "completed" },
      {
        status: "completed",
        structuredOutput: {
          disposition: "partial",
          summary: "One source was unavailable.",
        },
      },
      "partial",
    ],
    [
      "failed",
      { agentRunStatus: "failed" },
      {
        status: "failed",
        structuredOutput: null,
        error: "Synthetic execution failed.",
      },
      "failed",
    ],
    [
      "cancelled",
      { agentRunStatus: "cancelled" },
      {
        status: "cancelled",
        structuredOutput: null,
        cancellationReason: "Cancelled by synthetic operator.",
      },
      "cancelled",
    ],
    [
      "blocked",
      { agentRunStatus: "failed" },
      {
        status: "failed",
        structuredOutput: null,
        failureCode: "blocked_approval",
        error: "Approval is required.",
      },
      "blocked",
    ],
  ])(
    "reduces %s to a truthful distinct disposition",
    (_label, taskChanges, runChanges, expected) => {
      expect(
        buildAgentHandoff(
          organisationId,
          task(taskChanges),
          run(runChanges),
          [],
          [],
        )?.disposition,
      ).toBe(expected);
    },
  );

  it("never claims verification without a persisted verification event", () => {
    const withoutEvidence = buildAgentHandoff(
      organisationId,
      task(),
      run(),
      [],
      [],
    );
    expect(withoutEvidence?.verificationSummary).toBe(
      "No persisted verification evidence was recorded.",
    );

    const verified = buildAgentHandoff(
      organisationId,
      task(),
      run(),
      [event()],
      [],
    );
    expect(verified?.verificationSummary).toContain("Persisted verification:");
  });

  it("bounds artifact links and excludes foreign, mismatched, and unsafe evidence", () => {
    const ids = Array.from(
      { length: AGENT_HANDOFF_MAX_ARTIFACTS + 4 },
      (_, index) =>
        `019c9dc6-7c2e-7ca4-9b9d-${String(index + 1).padStart(12, "0")}`,
    );
    const output = {
      summary: "Synthetic evidence bundle completed.",
      evidenceReferences: ids.map((id) => ({
        type: "muster.evidence",
        reference: id,
        sha256: null,
      })),
    };
    const records = [
      ...ids.map((id) => evidence(id)),
      evidence(ids[0]!, { organisationId: "org-b" }),
      evidence(ids[1]!, { relatedRoomId: "room-b" }),
      evidence(ids[2]!, { scanState: "failed" }),
    ];

    const result = buildAgentHandoff(
      organisationId,
      task(),
      run({ structuredOutput: output }),
      [],
      records,
    );

    expect(result?.artifacts).toHaveLength(AGENT_HANDOFF_MAX_ARTIFACTS);
    expect(
      result?.artifacts.every(({ href }) =>
        href.startsWith("/api/v1/evidence/"),
      ),
    ).toBe(true);
    expect(result?.artifacts.some(({ href }) => href.startsWith("http"))).toBe(
      false,
    );
  });

  it("redacts secrets, removes control text, and bounds untrusted output", () => {
    const canary = "synthetic-handoff-secret";
    const result = buildAgentHandoff(
      organisationId,
      task(),
      run({
        structuredOutput: {
          summary: `Authorization: Bearer ${canary}\u202e ${"x".repeat(1_000)}`,
          evidenceReferences: [],
        },
      }),
      [],
      [],
    );

    expect(result?.outcome).toContain("[REDACTED]");
    expect(result?.outcome).not.toContain(canary);
    expect(result?.outcome).not.toContain("\u202e");
    expect(result?.outcome.length).toBeLessThanOrEqual(
      AGENT_HANDOFF_OUTCOME_MAX,
    );
  });

  it("falls back for malformed, oversized, stale, or mismatched completed data", () => {
    const cases: Array<[HandoffTaskRecord, HandoffRunRecord]> = [
      [task(), run({ structuredOutput: "legacy output" })],
      [
        task(),
        run({
          structuredOutput: {
            summary: "x".repeat(40_000),
            evidenceReferences: [],
          },
        }),
      ],
      [task({ agentRunStatus: "running" }), run()],
      [task(), run({ roomId: "room-b" })],
    ];

    for (const [candidateTask, candidateRun] of cases) {
      expect(
        buildAgentHandoff(organisationId, candidateTask, candidateRun, [], []),
      ).toBeNull();
    }
  });

  it("refuses cross-tenant task, run, event, and evidence records", () => {
    expect(
      buildAgentHandoff(
        organisationId,
        task({ organisationId: "org-b" }),
        run(),
        [],
        [],
      ),
    ).toBeNull();
    expect(
      buildAgentHandoff(
        organisationId,
        task(),
        run({ organisationId: "org-b" }),
        [],
        [],
      ),
    ).toBeNull();

    const result = buildAgentHandoff(
      organisationId,
      task(),
      run(),
      [event({ organisationId: "org-b" })],
      [
        evidence("019c9dc6-7c2e-7ca4-9b9d-000000000009", {
          organisationId: "org-b",
        }),
      ],
    );
    expect(result?.verificationSummary).toBe(
      "No persisted verification evidence was recorded.",
    );
    expect(result?.artifacts).toEqual([]);
  });
});
