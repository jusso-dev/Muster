import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(name: string) {
  return readFile(new URL(name, import.meta.url), "utf8");
}

describe("agent detail tabs", () => {
  it("only lists tabs that render their own content", async () => {
    const view = await source("./agents-view.tsx");
    expect(view).toContain('const agentTabs = ["Overview", "Learning"];');
    // Every listed tab must have a branch, or it silently shows Overview again.
    for (const dead of [
      '"Instructions"',
      '"Tools"',
      '"Permissions"',
      '"Rooms"',
      '"Evaluations"',
      '"Versions"',
    ]) {
      expect(view).not.toContain(`  ${dead},`);
    }
  });
});

describe("agent run detail", () => {
  it("shows why a run failed instead of only its status", async () => {
    const view = await source("./agent-run-view.tsx");
    expect(view).toContain("failureCode");
    expect(view).toContain("cancellationReason");
    expect(view).toContain("AgentRunResult");
  });

  it("renders the execution timeline the route already exposed", async () => {
    const view = await source("./agent-run-view.tsx");
    expect(view).toContain("/timeline");
    expect(view).toContain("Execution timeline");
    const route = await source(
      "../app/api/v1/agent-runs/[id]/timeline/route.ts",
    );
    expect(route).toContain("failureCode: schema.agentRuns.failureCode");
    expect(route).toContain("error: schema.agentRuns.error");
  });

  it("uses the OS shell and does not link to itself", async () => {
    const view = await source("./agent-run-view.tsx");
    expect(view).toContain("CompanyOsShell");
    expect(view).toContain("PageBody");
    expect(view).not.toContain("OpsShell");
    expect(view).toContain("showFullRunLink={false}");
  });
});
