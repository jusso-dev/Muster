import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * A plainly delegated task (no hunt, no report) previously had no settle
 * path: the run finished but the task stayed "in progress / queued" forever.
 */
describe("delegated task settlement", () => {
  it("settles the task on every terminal run outcome", async () => {
    const source = await readFile(
      new URL("./runtime.ts", import.meta.url),
      "utf8",
    );
    const calls = source.match(/settleDelegatedTask\(/g) ?? [];
    // One definition plus completed, failed, and cancelled call sites.
    expect(calls.length).toBe(4);
    for (const outcome of ["completed", "failed", "cancelled"]) {
      expect(
        source.includes(`"${outcome}",\n        now,`) ||
          source.includes(`"${outcome}", now)`),
        `no settle for ${outcome}`,
      ).toBe(true);
    }
  });

  it("never overwrites a task another path already settled", async () => {
    const source = await readFile(
      new URL("./runtime.ts", import.meta.url),
      "utf8",
    );
    const helper = source.slice(
      source.indexOf("async function settleDelegatedTask"),
      source.indexOf("export class DurableAgentRuntime"),
    );
    expect(helper).toContain(
      'inArray(schema.tasks.agentRunStatus, ["queued", "running"])',
    );
    expect(helper).toContain("eq(schema.tasks.organisationId, organisationId)");
    expect(helper).toContain("eq(schema.tasks.agentRunId, runId)");
  });
});
