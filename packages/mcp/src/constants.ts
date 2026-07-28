/** Read-only tools. Default installation scopes. */
export const MCP_READ_TOOL_NAMES = [
  "muster_get_status",
  "muster_list_capabilities",
  "muster_search_kelpie_cases",
  "muster_get_kelpie_case",
  "muster_search_knowledge",
  "muster_get_knowledge",
  "muster_list_invocations",
] as const;

/**
 * Write/proposal tools. Opt-in via installation scopes — never granted by default.
 */
export const MCP_WRITE_TOOL_NAMES = [
  "muster_propose_kelpie_action",
  "muster_get_action_status",
  "muster_propose_knowledge",
  "muster_export_audit",
] as const;

export const MCP_TOOL_NAMES = [
  ...MCP_READ_TOOL_NAMES,
  ...MCP_WRITE_TOOL_NAMES,
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
export type McpReadToolName = (typeof MCP_READ_TOOL_NAMES)[number];
export type McpWriteToolName = (typeof MCP_WRITE_TOOL_NAMES)[number];

export const MCP_TOOL_VERSIONS: Record<McpToolName, string> = {
  muster_get_status: "1.0.0",
  muster_list_capabilities: "1.0.0",
  muster_search_kelpie_cases: "1.0.0",
  muster_get_kelpie_case: "1.0.0",
  muster_search_knowledge: "1.0.0",
  muster_get_knowledge: "1.0.0",
  muster_propose_kelpie_action: "1.0.0",
  muster_get_action_status: "1.0.0",
  muster_propose_knowledge: "1.0.0",
  muster_list_invocations: "1.0.0",
  muster_export_audit: "1.0.0",
};

export const MCP_SERVER_NAME = "muster";
export const MCP_SERVER_VERSION = "0.4.0";
