import type { ModelClass, ModelProvider } from "../types.ts";
import type { ModelProviderEnv } from "../router.ts";
import {
  createOpenAiStyleProvider,
  resolveClassModels,
  type OpenAiProviderOptions,
} from "./openai-compatible.ts";

/** OpenRouter is OpenAI chat-completions-shaped, so it reuses that adapter. */
export const OPENROUTER_DEFAULT_MODELS: Record<ModelClass, string> = {
  "reasoning-large": "anthropic/claude-opus-5",
  "general-medium": "anthropic/claude-sonnet-5",
  "fast-small": "meta-llama/llama-3.2-3b-instruct",
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function createOpenRouterProvider(
  env: ModelProviderEnv,
  options: OpenAiProviderOptions = {},
): ModelProvider {
  const classModels = resolveClassModels(
    env,
    "MUSTER_MODEL_OPENROUTER",
    OPENROUTER_DEFAULT_MODELS,
  );
  return createOpenAiStyleProvider({
    id: "openrouter",
    kind: "openrouter",
    local: false,
    baseUrl: env.MUSTER_MODEL_OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL,
    apiKey: env.MUSTER_MODEL_OPENROUTER_API_KEY,
    requiresApiKey: true,
    classModels,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  });
}
