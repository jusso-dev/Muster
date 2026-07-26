import { describe, expect, it } from "vitest";
import {
  AGENT_ACTIVITY_HEADLINE_MAX,
  latestCompletionByAgent,
  safeActivityHeadline,
  selectActiveRoomAgentRuns,
  type RoomAgentActivityRun,
} from "./agent-activity-domain";

const now = new Date("2026-07-26T20:00:00.000Z");

function run(
  values: Partial<RoomAgentActivityRun> & Pick<RoomAgentActivityRun, "id">,
): RoomAgentActivityRun {
  return {
    id: values.id,
    organisationId: values.organisationId ?? "org-a",
    roomId: values.roomId ?? "room-a",
    agentId: values.agentId ?? "agent-a",
    agentName: values.agentName ?? "Synthetic agent",
    agentAvatar: null,
    definitionStatus: values.definitionStatus ?? "active",
    killSwitch: values.killSwitch ?? false,
    status: values.status ?? "running",
    startedAt: values.startedAt ?? new Date(now.getTime() - 30_000),
    completedAt: values.completedAt ?? null,
    heartbeatAt: values.heartbeatAt ?? new Date(now.getTime() - 5_000),
    deadlineAt: values.deadlineAt ?? new Date(now.getTime() + 60_000),
    maximumRuntimeSeconds: values.maximumRuntimeSeconds ?? 300,
  };
}

describe("room agent activity", () => {
  it("selects one fresh active run per agent within organisation and room", () => {
    const selected = selectActiveRoomAgentRuns(
      [
        run({ id: "older", heartbeatAt: new Date(now.getTime() - 20_000) }),
        run({ id: "latest", heartbeatAt: new Date(now.getTime() - 2_000) }),
        run({ id: "other-org", organisationId: "org-b" }),
        run({ id: "other-room", roomId: "room-b" }),
        run({ id: "second-agent", agentId: "agent-b", status: "queued" }),
      ],
      { organisationId: "org-a", roomId: "room-a" },
      now,
    );

    expect(selected.map(({ id }) => id)).toEqual(["latest", "second-agent"]);
  });

  it("excludes stale, expired, stopped, failed, and kill-switched work", () => {
    const selected = selectActiveRoomAgentRuns(
      [
        run({
          id: "stale",
          heartbeatAt: new Date(now.getTime() - 121_000),
        }),
        run({
          id: "expired",
          deadlineAt: new Date(now.getTime() - 1),
        }),
        run({ id: "completed", status: "completed" }),
        run({ id: "stopped", definitionStatus: "stopped" }),
        run({ id: "kill-switch", killSwitch: true }),
      ],
      { organisationId: "org-a", roomId: "room-a" },
      now,
    );

    expect(selected).toEqual([]);
  });

  it("uses latest meaningful event and strips secret-shaped values", () => {
    const result = safeActivityHeadline([
      {
        runId: "run-a",
        eventType: "started",
        message: "Agent run claimed for execution",
        createdAt: new Date(now.getTime() + 2_000),
      },
      {
        runId: "run-a",
        eventType: "prompt_prepared",
        message: `Investigating synthetic signal api_key=do-not-show ${"x".repeat(300)}`,
        createdAt: new Date(now.getTime() + 1_000),
      },
    ]);

    expect(result.headline).toContain("[REDACTED]");
    expect(result.headline).not.toContain("do-not-show");
    expect(result.headline.length).toBeLessThanOrEqual(
      AGENT_ACTIVITY_HEADLINE_MAX,
    );
  });

  it("reports latest real completion for each scoped active agent", () => {
    const completions = latestCompletionByAgent(
      [
        run({
          id: "first",
          status: "completed",
          completedAt: new Date(now.getTime() - 60_000),
        }),
        run({
          id: "latest",
          status: "completed",
          completedAt: new Date(now.getTime() - 10_000),
        }),
        run({
          id: "unrelated",
          roomId: "room-b",
          status: "completed",
          completedAt: now,
        }),
      ],
      { organisationId: "org-a", roomId: "room-a" },
    );

    expect(completions.get("agent-a")?.toISOString()).toBe(
      new Date(now.getTime() - 10_000).toISOString(),
    );
  });
});
