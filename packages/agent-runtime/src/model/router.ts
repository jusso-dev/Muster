import { AgentRuntimeError, isRetryable } from "../errors.ts";
import type {
  ModelPolicy,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelRouter,
} from "./types.ts";
import { createAnthropicProvider } from "./providers/anthropic.ts";
import { createOllamaProvider } from "./providers/ollama.ts";
import { createOpenAICompatibleProvider } from "./providers/openai-compatible.ts";
import { createOpenRouterProvider } from "./providers/openrouter.ts";

/**
 * Shape of `process.env`. Provider factories take this rather than reading
 * `process.env` directly so callers (and tests) fully control configuration
 * and no provider file has a module-load-time side effect.
 */
export type ModelProviderEnv = Record<string, string | undefined>;

export type ModelRouterOptions = {
  /** Providers in priority order; earlier entries win ties within a tier. */
  providers: readonly ModelProvider[];
};

/**
 * Builds the real provider list from an env-shaped object. Never reads
 * `process.env` itself so module import has no side effects and tests never
 * touch real environment state.
 */
export function defaultProviders(
  env: ModelProviderEnv,
  options: { fetchImpl?: typeof fetch } = {},
): ModelProvider[] {
  const fetchOptions = options.fetchImpl
    ? { fetchImpl: options.fetchImpl }
    : {};
  return [
    createAnthropicProvider(env, fetchOptions),
    createOpenAICompatibleProvider(env, fetchOptions),
    createOpenRouterProvider(env, fetchOptions),
    createOllamaProvider(env, fetchOptions),
  ];
}

function matchesClass(provider: ModelProvider, className: string): boolean {
  return provider.classes.some((cls) => cls === className);
}

function isEligible(
  provider: ModelProvider,
  policy: ModelPolicy,
  className: string,
): boolean {
  if (!matchesClass(provider, className)) return false;
  if (provider.local && !policy.allowLocal) return false;
  return provider.configured();
}

/**
 * Ordered candidates for a policy: every eligible provider matching
 * `preferred` first, then any additional eligible providers matching
 * `fallback` that were not already included. `resolve()` only ever needs the
 * head of this list; `generate()` uses the rest for its single retry hop.
 */
function candidatesFor(
  providers: readonly ModelProvider[],
  policy: ModelPolicy,
): ModelProvider[] {
  const preferred = providers.filter((p) =>
    isEligible(p, policy, policy.preferred),
  );
  if (!policy.fallback) return preferred;
  const fallback = providers.filter(
    (p) => isEligible(p, policy, policy.fallback ?? "") && !preferred.includes(p),
  );
  return [...preferred, ...fallback];
}

function noMatchError(policy: ModelPolicy): AgentRuntimeError {
  const tiers = policy.fallback
    ? `"${policy.preferred}" or fallback "${policy.fallback}"`
    : `"${policy.preferred}"`;
  return new AgentRuntimeError(
    `No configured model provider matches policy ${tiers}.`,
    "no_model_policy_match",
    { preferred: policy.preferred, fallback: policy.fallback },
  );
}

export function createModelRouter(options: ModelRouterOptions): ModelRouter {
  const providers = options.providers;

  function resolve(policy: ModelPolicy): ModelProvider {
    const candidate = candidatesFor(providers, policy)[0];
    if (!candidate) throw noMatchError(policy);
    return candidate;
  }

  async function generate(request: ModelRequest): Promise<ModelResponse> {
    const candidates = candidatesFor(providers, request.policy);
    const first = candidates[0];
    if (!first) throw noMatchError(request.policy);

    try {
      return await first.generate(request);
    } catch (error) {
      if (!isRetryable(error)) throw error;

      const second = candidates[1];
      if (!second) {
        throw new AgentRuntimeError(
          `Model provider "${first.id}" is unavailable and no fallback provider is eligible for policy "${request.policy.preferred}".`,
          "model_provider_unavailable",
          { providerId: first.id, preferred: request.policy.preferred },
        );
      }

      try {
        return await second.generate(request);
      } catch (secondError) {
        if (!isRetryable(secondError)) throw secondError;
        throw new AgentRuntimeError(
          `Model providers "${first.id}" and "${second.id}" are both unavailable for policy "${request.policy.preferred}".`,
          "model_provider_unavailable",
          { providerIds: [first.id, second.id], preferred: request.policy.preferred },
        );
      }
    }
  }

  return { resolve, generate };
}
