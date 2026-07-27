/**
 * Retry behaviour must distinguish transient infrastructure failure from
 * policy denial and invalid model output. The class of a failure decides
 * whether the graph retries, stops, or surfaces a governance outcome.
 */
export const runtimeFailureClasses = [
  "transient",
  "policy",
  "invalid_model_output",
  "permanent",
] as const;

export type RuntimeFailureClass = (typeof runtimeFailureClasses)[number];

export const runtimeFailureCodes = [
  "agent_kill_switch",
  "agent_inactive",
  "cancelled",
  "checkpoint_scope_violation",
  "graph_version_mismatch",
  "invalid_json",
  "invalid_model_output",
  "invalid_tool_arguments",
  "model_provider_unavailable",
  "model_provider_not_configured",
  "no_model_policy_match",
  "policy_denied",
  "runtime_error",
  "stale_run",
  "step_ceiling",
  "timeout",
  "tool_execution_failed",
  "tool_not_registered",
  "unknown_tool",
] as const;

export type RuntimeFailureCode = (typeof runtimeFailureCodes)[number];

const failureClassByCode: Record<RuntimeFailureCode, RuntimeFailureClass> = {
  agent_kill_switch: "policy",
  agent_inactive: "policy",
  cancelled: "permanent",
  checkpoint_scope_violation: "permanent",
  graph_version_mismatch: "permanent",
  invalid_json: "invalid_model_output",
  invalid_model_output: "invalid_model_output",
  invalid_tool_arguments: "invalid_model_output",
  model_provider_unavailable: "transient",
  model_provider_not_configured: "permanent",
  no_model_policy_match: "permanent",
  policy_denied: "policy",
  runtime_error: "transient",
  stale_run: "transient",
  step_ceiling: "permanent",
  timeout: "permanent",
  tool_execution_failed: "transient",
  tool_not_registered: "policy",
  unknown_tool: "policy",
};

export class AgentRuntimeError extends Error {
  readonly code: RuntimeFailureCode;
  readonly failureClass: RuntimeFailureClass;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: RuntimeFailureCode,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AgentRuntimeError";
    this.code = code;
    this.failureClass = failureClassByCode[code];
    this.details = details;
  }
}

export function isRetryable(error: unknown): boolean {
  return (
    error instanceof AgentRuntimeError && error.failureClass === "transient"
  );
}

export function failureClassOf(code: RuntimeFailureCode): RuntimeFailureClass {
  return failureClassByCode[code];
}
