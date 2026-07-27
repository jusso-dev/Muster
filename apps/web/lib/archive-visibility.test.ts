import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function repositoryFile(path: string) {
  return readFileSync(new URL(path, `file://${repositoryRoot}/`), "utf8");
}

describe("archived synthetic artifact visibility", () => {
  it("excludes archived parent records from normal collection queries", () => {
    const collectionQueries = {
      "apps/web/app/api/v1/tasks/route.ts": "schema.tasks.archivedAt",
      "apps/web/app/api/v1/hunts/route.ts": "schema.huntRuns.archivedAt",
      "apps/web/lib/connector-domain.ts":
        "schema.integrationRecords.archivedAt",
      "apps/web/lib/alfie-research-domain.ts":
        "schema.researchWatchlists.archivedAt",
      "apps/web/app/api/v1/reports/route.ts":
        "schema.reportManifests.archivedAt",
      "apps/web/app/api/v1/reports/schedules/route.ts":
        "schema.reportSchedules.archivedAt",
    };

    for (const [path, column] of Object.entries(collectionQueries)) {
      expect(repositoryFile(path)).toContain(`isNull(${column})`);
    }
  });

  it("keeps inactive learning history behind an explicit managed option", () => {
    const domain = repositoryFile("apps/web/lib/agent-learning-domain.ts");
    const route = repositoryFile(
      "apps/web/app/api/v1/agents/[id]/learning/route.ts",
    );

    expect(domain).toContain("includeInactive?: boolean");
    expect(domain).toContain('ne(schema.agentMemories.status, "rejected")');
    expect(domain).toContain("gt(schema.agentMemories.expiresAt, now)");
    expect(route).toContain("includeInactive");
    expect(route).toContain('requireCapability(subject, "agents.manage")');
  });
});
