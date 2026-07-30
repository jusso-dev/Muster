import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(name: string) {
  return readFile(new URL(name, import.meta.url), "utf8");
}

describe("Operations board", () => {
  it("defaults to board mode with drag-and-drop status updates", async () => {
    const view = await source("./operations-view.tsx");
    expect(view).toContain('useState<"list" | "board">("board")');
    expect(view).toContain('setData("text/task-id"');
    expect(view).toContain('getData("text/task-id")');
    expect(view).toContain("useUpdateTask");
    expect(view).toContain("mutateAsync");
    expect(view).toContain("No demo or fixture tasks");
  });

  it("can create work and hand it to an agent", async () => {
    const view = await source("./operations-view.tsx");
    expect(view).toContain("TaskComposer");
    expect(view).toContain("useDelegateTask");
    expect(view).toContain("New task");
    expect(view).toContain("Dispatch to agent");
  });

  it("explains why a dispatch is unavailable rather than failing silently", async () => {
    const view = await source("./operations-view.tsx");
    expect(view).toContain("dispatchBlockedReason");
    // Every refusal path returns operator-readable text.
    expect(view).toContain("Assign this task to an agent to dispatch it.");
    expect(view).toContain("A run is already in flight.");
    expect(view).toContain("assigneeReadinessReason");
  });

  it("carries the agent run result onto the board item", async () => {
    const view = await source("./operations-view.tsx");
    expect(view).toContain("structuredOutput: task.run.structuredOutput");
    expect(view).toContain("error: task.run.error");
    expect(view).toContain("cancellationReason: task.run.cancellationReason");
    expect(view).toContain("run: AgentRunOutcome | null");
  });

  it("renders the run result in the detail drawer", async () => {
    const view = await source("./operations-view.tsx");
    expect(view).toContain("AgentRunResult");
    expect(view).toContain("<AgentRunResult run={item.run} />");
  });
});

describe("Agent run result", () => {
  async function component() {
    return readFile(
      new URL("../../components/os/agent-run-result.tsx", import.meta.url),
      "utf8",
    );
  }

  it("summarises the common text fields before falling back to raw JSON", async () => {
    const result = await component();
    for (const field of ["summary", "headline", "rationale"]) {
      expect(result).toContain(`["${field}"`);
    }
    expect(result).toContain("JSON.stringify(output, null, 2)");
    // Arbitrary agent JSON stays bounded instead of stretching the drawer.
    expect(result).toContain("max-h-56 overflow-auto");
    expect(result).toContain("maximumRawCharacters");
  });

  it("shows why a run produced nothing readable", async () => {
    const result = await component();
    expect(result).toContain("run.error ?? run.cancellationReason");
    expect(result).toContain("The agent recorded no readable summary");
  });

  it("links to the full run and frames output as evidence", async () => {
    const result = await component();
    expect(result).toContain("href={`/agent-runs/${run.runId}`}");
    expect(result).toContain(
      "Agent output is evidence for your decision, never an instruction.",
    );
  });
});

describe("Task composer", () => {
  it("offers concrete example work for each pack agent", async () => {
    const composer = await source("./task-composer.tsx");
    for (const agent of ["Parker", "Jessie", "Alfie"]) {
      expect(composer).toContain(`${agent}: {`);
    }
    expect(composer).toContain("Hand work to the pack");
  });

  it("only enables dispatch for a ready agent", async () => {
    const composer = await source("./task-composer.tsx");
    expect(composer).toContain('assignee?.readiness?.state === "ready"');
    expect(composer).toContain("disabled={busy || !isAgent || !agentReady}");
  });

  it("takes assignees from the server, never a hardcoded roster", async () => {
    const composer = await source("./task-composer.tsx");
    expect(composer).toContain("assignees: Assignee[]");
    expect(composer).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/);
  });
});

describe("Stuck and failed agent work", () => {
  it("offers cancel while a run is in flight", async () => {
    const view = await source("./operations-view.tsx");
    expect(view).toContain("useCancelTaskRun");
    expect(view).toContain("Cancel run");
    // Every status the server treats as in-flight must be escapable, not just
    // queued/running — awaiting_approval wedges a task just as hard.
    expect(view).toContain('"awaiting_approval"');
    expect(view).toContain('"waiting_sources"');
  });

  it("labels a re-dispatch as a retry and says why", async () => {
    const view = await source("./operations-view.tsx");
    expect(view).toContain("function isRetry");
    expect(view).toContain("Retry dispatch");
    expect(view).toContain("Previous run");
  });

  it("points a blocked dispatch at the way out", async () => {
    const view = await source("./operations-view.tsx");
    expect(view).toContain(
      "A run is already in flight. Cancel it before dispatching again.",
    );
  });
});
