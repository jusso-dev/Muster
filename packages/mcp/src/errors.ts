export type McpToolErrorCode =
  | "forbidden"
  | "not_configured"
  | "not_found"
  | "invalid_input"
  | "rate_limited"
  | "timeout"
  | "upstream_error";

export class McpToolError extends Error {
  override readonly name = "McpToolError";
  constructor(
    readonly code: McpToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}
