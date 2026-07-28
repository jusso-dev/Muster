import { describe, expect, it } from "vitest";
import { McpKelpieActionProposalSchema } from "./actions.ts";
import {
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
} from "./constants.ts";

describe("MCP write/proposal surface", () => {
  it("keeps write tools opt-in and separate from default read scopes", () => {
    expect(MCP_READ_TOOL_NAMES).toEqual([
      "muster_get_status",
      "muster_list_capabilities",
      "muster_search_kelpie_cases",
      "muster_get_kelpie_case",
      "muster_search_knowledge",
      "muster_get_knowledge",
      "muster_list_invocations",
    ]);
    expect(MCP_WRITE_TOOL_NAMES).toEqual([
      "muster_propose_kelpie_action",
      "muster_get_action_status",
      "muster_propose_knowledge",
      "muster_export_audit",
    ]);
    expect(MCP_TOOL_NAMES).toEqual([
      ...MCP_READ_TOOL_NAMES,
      ...MCP_WRITE_TOOL_NAMES,
    ]);
  });

  it("accepts valid Kelpie proposals and rejects incomplete updates", () => {
    expect(
      McpKelpieActionProposalSchema.parse({
        operation: "kelpie.timeline.comment",
        idempotencyKey: "idem-12345678",
        caseId: "case-1",
        body: "comment body",
      }).operation,
    ).toBe("kelpie.timeline.comment");

    const created = McpKelpieActionProposalSchema.parse({
      operation: "kelpie.case.create",
      idempotencyKey: "idem-create-01",
      title: "Synthetic case",
    });
    expect(created.operation).toBe("kelpie.case.create");
    if (created.operation === "kelpie.case.create")
      expect(created.title).toBe("Synthetic case");

    expect(() =>
      McpKelpieActionProposalSchema.parse({
        operation: "kelpie.case.update",
        idempotencyKey: "idem-update-01",
        caseId: "case-1",
      }),
    ).toThrow();

    expect(() =>
      McpKelpieActionProposalSchema.parse({
        operation: "kelpie.timeline.comment",
        idempotencyKey: "short",
        caseId: "case-1",
        body: "x",
      }),
    ).toThrow();
  });
});
