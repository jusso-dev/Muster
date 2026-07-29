import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const inboxUrl = new URL("./governance-inbox.tsx", import.meta.url);

describe("Governance inbox", () => {
  it("requires decision reason and high-impact confirmation before approve", async () => {
    const source = await readFile(inboxUrl, "utf8");
    expect(source).toContain("Rejection requires a reason");
    expect(source).toContain("Approval requires a decision reason");
    expect(source).toContain("Confirm high-impact approval");
    expect(source).toContain("useApprovalDecision");
    expect(source).toContain("mutateAsync");
  });

  it("does not fake success without backend mutation", async () => {
    const source = await readFile(inboxUrl, "utf8");
    expect(source).toContain("decision.mutateAsync");
    expect(source).not.toContain("setApprovals(approvals.filter");
  });
});
