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
    expect(view).toContain("already has an active agent run");
    expect(view).toContain("assigneeReadinessReason");
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
