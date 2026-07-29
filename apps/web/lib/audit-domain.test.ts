import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("audit domain", () => {
  it("requires administration.manage and org scopes every query", async () => {
    const source = await readFile(
      new URL("./audit-domain.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'requireCapability(subject, "administration.manage")',
    );
    expect(source).toContain(
      "eq(schema.auditEvents.organisationId, subject.organisationId)",
    );
    expect(source).toContain("redactForObservation");
    expect(source).toContain(".max(200)");
  });
});
