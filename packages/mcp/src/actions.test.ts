import { describe, expect, it } from "vitest";
import { McpKelpieActionProposalSchema } from "./actions.ts";
import {
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
} from "./constants.ts";

describe("MCP write/proposal surface", () => {
  it("keeps write tools opt-in and separate from default read scopes", () => {
    expect(MCP_READ_TOOL_NAMES).toContain("muster_get_status");
    expect(MCP_READ_TOOL_NAMES).toContain("muster_list_missions");
    expect(MCP_READ_TOOL_NAMES).toContain("muster_search_kelpie_cases");
    expect(MCP_READ_TOOL_NAMES).toContain("muster_list_tawny_endpoints");
    expect(MCP_READ_TOOL_NAMES).toContain("muster_list_tawny_alerts");
    expect(MCP_READ_TOOL_NAMES).toContain("muster_run_tawny_hunt");
    expect(MCP_READ_TOOL_NAMES).toContain("muster_get_brolga_context");
    expect(MCP_WRITE_TOOL_NAMES).toContain("muster_propose_kelpie_action");
    expect(MCP_WRITE_TOOL_NAMES).toContain("muster_accept_mission_run");
    expect(MCP_TOOL_NAMES).toEqual([
      ...MCP_READ_TOOL_NAMES,
      ...MCP_WRITE_TOOL_NAMES,
    ]);
    for (const tool of MCP_WRITE_TOOL_NAMES)
      expect(MCP_READ_TOOL_NAMES).not.toContain(tool);
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
