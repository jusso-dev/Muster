import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(name: string) {
  return readFile(new URL(name, import.meta.url), "utf8");
}

describe("agent detail tabs", () => {
  it("only lists tabs that render their own content", async () => {
    const view = await source("./agents-view.tsx");
    expect(view).toContain(
      'const agentTabs = ["Overview", "Tools", "Rooms", "Permissions", "Learning"];',
    );
    // Every listed tab must have a branch, or it silently shows Overview again.
    for (const tab of ["tools", "rooms", "permissions", "learning"]) {
      expect(view).toContain(`"${tab}"`);
    }
    // Still unbuilt: absent rather than falling through to Overview.
    for (const dead of ['"Instructions"', '"Evaluations"', '"Versions"']) {
      expect(view).not.toContain(dead);
    }
  });
});

describe("agent profile", () => {
  it("reports the gap between declared requirements and real grants", async () => {
    const domain = await source("../lib/agent-profile-domain.ts");
    // The governance-critical field: required but not held means every run
    // touching it fails, and nothing else in the product surfaces that.
    expect(domain).toContain("missing:");
    expect(domain).toContain("surplus:");
    expect(domain).toContain("unknown:");
    const panel = await source("./agent-profile-panels.tsx");
    expect(panel).toContain("Declared requirements this agent does not hold");
  });

  it("scopes every read to the caller's organisation", async () => {
    const domain = await source("../lib/agent-profile-domain.ts");
    const froms =
      (domain.match(/\.from\(schema\./g)?.length ?? 0) -
      // innerJoin targets are constrained by their join predicate.
      (domain.match(/\.innerJoin\(/g)?.length ?? 0);
    const scoped =
      domain.match(/organisationId, organisationId\)/g)?.length ?? 0;
    expect(froms).toBeGreaterThan(0);
    expect(scoped).toBeGreaterThanOrEqual(froms);
  });

  it("surfaces tools called outside the declared envelope", async () => {
    const domain = await source("../lib/agent-profile-domain.ts");
    expect(domain).toContain("...allowedTools, ...usage.map");
    const panel = await source("./agent-profile-panels.tsx");
    expect(panel).toContain("unregistered");
  });

  it("is read-only: no grant or revoke path in the UI", async () => {
    const panel = await source("./agent-profile-panels.tsx");
    expect(panel).not.toContain("apiPost");
    expect(panel).not.toContain("useMutation");
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
