import { z } from "zod";

/**
 * Agent definitions select a model policy, never a provider. The registry
 * resolves a policy to whichever configured provider satisfies it, so an
 * agent keeps running when a provider is swapped, rate limited or removed.
 */
export const ModelPolicySchema = z.object({
  preferred: z.string().trim().min(1).max(120),
  fallback: z.string().trim().min(1).max(120).optional(),
  allowLocal: z.boolean().default(false),
  maxInputTokens: z.number().int().positive().max(2_000_000).default(64_000),
  maxOutputTokens: z.number().int().positive().max(200_000).default(8_000),
  temperature: z.number().min(0).max(2).optional(),
});

export type ModelPolicy = z.infer<typeof ModelPolicySchema>;

export const defaultModelPolicy: ModelPolicy = ModelPolicySchema.parse({
  preferred: "general-medium",
  allowLocal: true,
});

/** Capability classes an agent asks for, not vendor model names. */
export const modelClasses = [
  "reasoning-large",
  "general-medium",
  "fast-small",
] as const;

export type ModelClass = (typeof modelClasses)[number];

export const modelProviderKinds = [
  "openai-compatible",
  "anthropic",
  "ollama",
  "openrouter",
  "codex",
  "scripted",
] as const;

export type ModelProviderKind = (typeof modelProviderKinds)[number];

/**
 * Prompt parts keep the trust boundary explicit all the way to the provider.
 * Untrusted evidence and tool results can never be promoted into a system or
 * trusted-instruction position by a provider adapter.
 */
export const modelMessageRoles = [
  "system_policy",
  "trusted_instruction",
  "human_request",
  "agent_response",
  "untrusted_evidence",
  "tool_result",
] as const;

export type ModelMessageRole = (typeof modelMessageRoles)[number];

export type ModelMessage = {
  role: ModelMessageRole;
  content: string;
  /** Only set for `tool_result`; correlates to a reserved tool call. */
  toolCallId?: string;
};

export type ModelToolSpec = {
  name: string;
  description: string;
  /** JSON Schema derived from the registered zod schema, never model supplied. */
  parameters: Record<string, unknown>;
};

export type ModelRequest = {
  policy: ModelPolicy;
  messages: readonly ModelMessage[];
  tools: readonly ModelToolSpec[];
  /** JSON Schema the final response must satisfy when the model responds. */
  responseSchema: Record<string, unknown>;
  signal?: AbortSignal;
};

export type ModelToolProposal = {
  /** Raw, untrusted name as emitted by the model. Never dispatched directly. */
  name: string;
  /** Raw, untrusted arguments. Validated against the registered schema. */
  arguments: unknown;
  /** Provider-supplied correlation id, or a derived stable id. */
  toolCallId: string;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ModelResponse = {
  /** Exactly one of `toolCalls` (non-empty) or `content` is meaningful. */
  toolCalls: readonly ModelToolProposal[];
  content: string | null;
  usage: ModelUsage;
  estimatedCostCents: number;
  modelId: string;
};

export interface ModelProvider {
  readonly kind: ModelProviderKind;
  /** Stable provider identity used in run diagnostics. */
  readonly id: string;
  /** True when local inference — gated by `ModelPolicy.allowLocal`. */
  readonly local: boolean;
  /** Model classes this provider can serve. */
  readonly classes: readonly ModelClass[];
  /** False when required configuration is absent; never throws on secrets. */
  configured(): boolean;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export interface ModelRouter {
  /** Resolve a policy to a configured provider, honouring fallback order. */
  resolve(policy: ModelPolicy): ModelProvider;
  generate(request: ModelRequest): Promise<ModelResponse>;
}
