import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("mission web domain", () => {
  it("scopes mission queries by organisation and workflows.read", async () => {
    const source = await readFile(
      new URL("./mission-web-domain.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('requireCapability(subject, "workflows.read")');
    expect(source).toContain(
      "eq(schema.governedMissions.organisationId, subject.organisationId)",
    );
    expect(source).toContain(
      "eq(schema.governedMissionRuns.organisationId, subject.organisationId)",
    );
  });
});
