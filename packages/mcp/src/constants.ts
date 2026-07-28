export const MCP_TOOL_NAMES = [
  "muster_get_status",
  "muster_list_capabilities",
  "muster_search_kelpie_cases",
  "muster_get_kelpie_case",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const MCP_TOOL_VERSIONS: Record<McpToolName, string> = {
  muster_get_status: "1.0.0",
  muster_list_capabilities: "1.0.0",
  muster_search_kelpie_cases: "1.0.0",
  muster_get_kelpie_case: "1.0.0",
};

export const MCP_SERVER_NAME = "muster";
export const MCP_SERVER_VERSION = "0.1.0";
