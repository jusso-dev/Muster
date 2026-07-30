import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(name: string) {
  return readFile(new URL(name, import.meta.url), "utf8");
}

/**
 * An expired approval used to be a permanent dead row: `decide` refused both
 * verdicts, and nothing ever moved it out of `pending`.
 */
describe("approval expiry", () => {
  it("refuses approval past the deadline but allows rejection", async () => {
    const domain = await source("./integration-action-domain.ts");
    expect(domain).toContain(
      'approval.expiresAt <= new Date() && decision.status !== "rejected"',
    );
    expect(domain).toContain("Reject it to close it out.");
  });

  it("transitions overdue rows to expired with an audit event", async () => {
    const domain = await source("./integration-action-domain.ts");
    expect(domain).toContain("async expireOverdue(");
    expect(domain).toContain('set({ status: "expired"');
    expect(domain).toContain("lte(schema.approvals.expiresAt, new Date())");
    expect(domain).toContain('action: "workflow.approval.expired"');
    // Expiry must run before the inbox is read, or the UI keeps offering
    // Approve on a request that can no longer be approved.
    expect(domain).toContain("await this.expireOverdue(subject.organisationId");
  });

  it("never counts an overdue approval as actionable on Command", async () => {
    const summary = await source("./command-summary-domain.ts");
    expect(summary).toContain("gt(schema.approvals.expiresAt, new Date())");
  });
});

describe("approval inbox controls", () => {
  it("drops Approve and offers a closing Reject once overdue", async () => {
    const view = await source("../features/approvals/governance-inbox.tsx");
    expect(view).toContain("const overdue = new Date(approval.expiresAt)");
    expect(view).toContain(
      'const closable = approval.status === "pending" && overdue',
    );
    expect(view).toContain("{closable ? null : (");
    expect(view).toContain('{closable ? "Reject and close" : "Reject"}');
    expect(view).toContain("can no longer be");
  });

  it("explains an expired outcome rather than saying only 'not pending'", async () => {
    const view = await source("../features/approvals/governance-inbox.tsx");
    expect(view).toContain('approval.status === "expired"');
    expect(view).toContain("Nothing was executed.");
  });
});
