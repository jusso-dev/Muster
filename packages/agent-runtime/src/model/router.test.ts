import { describe, expect, it } from "vitest";
import { AgentRuntimeError } from "../errors.ts";
import { createModelRouter, defaultProviders } from "./router.ts";
import { ModelPolicySchema } from "./types.ts";
import type {
  ModelClass,
  ModelPolicy,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "./types.ts";

function policy(overrides: Partial<ModelPolicy> = {}): ModelPolicy {
  return ModelPolicySchema.parse({ preferred: "general-medium", ...overrides });
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    policy: policy(),
    messages: [],
    tools: [],
    responseSchema: {},
    ...overrides,
  };
}

function response(modelId: string): ModelResponse {
  return {
    toolCalls: [],
    content: `reply from ${modelId}`,
    usage: { inputTokens: 1, outputTokens: 1 },
    estimatedCostCents: 0,
    modelId,
  };
}

type FakeProviderConfig = {
  id: string;
  classes: readonly ModelClass[];
  local?: boolean;
  configured?: boolean;
  generate?: (req: ModelRequest) => Promise<ModelResponse>;
};

function fakeProvider(config: FakeProviderConfig): ModelProvider & {
  callCount: () => number;
} {
  let calls = 0;
  const generateImpl =
    config.generate ??
    (async () => {
      return response(config.id);
    });
  return {
    kind: "scripted",
    id: config.id,
    local: config.local ?? false,
    classes: config.classes,
    configured: () => config.configured ?? true,
    generate: async (req) => {
      calls += 1;
      return generateImpl(req);
    },
    callCount: () => calls,
  };
}

describe("createModelRouter.resolve", () => {
  it("picks the first configured provider matching the preferred class", () => {
    const preferred = fakeProvider({ id: "preferred", classes: ["general-medium"] });
    const other = fakeProvider({ id: "other", classes: ["general-medium"] });
    const router = createModelRouter({ providers: [preferred, other] });
    expect(router.resolve(policy())).toBe(preferred);
  });

  it("falls back when no provider matches the preferred class", () => {
    const fallback = fakeProvider({ id: "fallback", classes: ["fast-small"] });
    const router = createModelRouter({ providers: [fallback] });
    const result = router.resolve(
      policy({ preferred: "reasoning-large", fallback: "fast-small" }),
    );
    expect(result).toBe(fallback);
  });

  it("excludes local providers when allowLocal is false", () => {
    const local = fakeProvider({
      id: "local",
      classes: ["general-medium"],
      local: true,
    });
    const remote = fakeProvider({ id: "remote", classes: ["general-medium"] });
    const router = createModelRouter({ providers: [local, remote] });
    expect(router.resolve(policy({ allowLocal: false }))).toBe(remote);
  });

  it("includes local providers when allowLocal is true", () => {
    const local = fakeProvider({
      id: "local",
      classes: ["general-medium"],
      local: true,
    });
    const router = createModelRouter({ providers: [local] });
    expect(router.resolve(policy({ allowLocal: true }))).toBe(local);
  });

  it("skips providers that report configured() as false", () => {
    const unconfigured = fakeProvider({
      id: "unconfigured",
      classes: ["general-medium"],
      configured: false,
    });
    const configured = fakeProvider({ id: "configured", classes: ["general-medium"] });
    const router = createModelRouter({ providers: [unconfigured, configured] });
    expect(router.resolve(policy())).toBe(configured);
  });

  it("throws no_model_policy_match when neither preferred nor fallback resolves", () => {
    const router = createModelRouter({ providers: [] });
    expect(() =>
      router.resolve(policy({ preferred: "reasoning-large", fallback: "fast-small" })),
    ).toThrowError(AgentRuntimeError);
    try {
      router.resolve(policy({ preferred: "reasoning-large", fallback: "fast-small" }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentRuntimeError);
      expect((error as AgentRuntimeError).code).toBe("no_model_policy_match");
    }
  });

  it("throws no_model_policy_match when the only match is local and allowLocal is false", () => {
    const local = fakeProvider({
      id: "local",
      classes: ["general-medium"],
      local: true,
    });
    const router = createModelRouter({ providers: [local] });
    try {
      router.resolve(policy({ allowLocal: false }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentRuntimeError);
      expect((error as AgentRuntimeError).code).toBe("no_model_policy_match");
    }
  });
});

describe("createModelRouter.generate", () => {
  it("returns the resolved provider's response on success", async () => {
    const provider = fakeProvider({ id: "primary", classes: ["general-medium"] });
    const router = createModelRouter({ providers: [provider] });
    const result = await router.generate(request());
    expect(result.modelId).toBe("primary");
  });

  it("falls through to the next eligible provider on a transient failure", async () => {
    const first = fakeProvider({
      id: "first",
      classes: ["general-medium"],
      generate: async () => {
        throw new AgentRuntimeError("rate limited", "model_provider_unavailable");
      },
    });
    const second = fakeProvider({ id: "second", classes: ["general-medium"] });
    const router = createModelRouter({ providers: [first, second] });
    const result = await router.generate(request());
    expect(result.modelId).toBe("second");
    expect(second.callCount()).toBe(1);
  });

  it("throws model_provider_unavailable once both the primary and its single retry are exhausted", async () => {
    const first = fakeProvider({
      id: "first",
      classes: ["general-medium"],
      generate: async () => {
        throw new AgentRuntimeError("down", "model_provider_unavailable");
      },
    });
    const second = fakeProvider({
      id: "second",
      classes: ["general-medium"],
      generate: async () => {
        throw new AgentRuntimeError("also down", "model_provider_unavailable");
      },
    });
    const router = createModelRouter({ providers: [first, second] });
    try {
      await router.generate(request());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentRuntimeError);
      expect((error as AgentRuntimeError).code).toBe("model_provider_unavailable");
    }
  });

  it("does not retry a non-transient failure", async () => {
    const first = fakeProvider({
      id: "first",
      classes: ["general-medium"],
      generate: async () => {
        throw new AgentRuntimeError("bad request", "model_provider_not_configured");
      },
    });
    const second = fakeProvider({ id: "second", classes: ["general-medium"] });
    const router = createModelRouter({ providers: [first, second] });
    try {
      await router.generate(request());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentRuntimeError);
      expect((error as AgentRuntimeError).code).toBe("model_provider_not_configured");
    }
    expect(second.callCount()).toBe(0);
  });

  it("throws no_model_policy_match without attempting a call when nothing is eligible", async () => {
    const router = createModelRouter({ providers: [] });
    await expect(router.generate(request())).rejects.toMatchObject({
      code: "no_model_policy_match",
    });
  });
});

describe("defaultProviders", () => {
  it("builds the real provider list from an env-shaped object without touching process.env", () => {
    const providers = defaultProviders({
      MUSTER_MODEL_ANTHROPIC_API_KEY: "test-key",
    });
    expect(providers.map((p) => p.kind).sort()).toEqual(
      ["anthropic", "ollama", "openai-compatible", "openrouter"].sort(),
    );
    const anthropic = providers.find((p) => p.kind === "anthropic");
    expect(anthropic?.configured()).toBe(true);
    const openAiCompatible = providers.find((p) => p.kind === "openai-compatible");
    expect(openAiCompatible?.configured()).toBe(false);
    const ollama = providers.find((p) => p.kind === "ollama");
    expect(ollama?.local).toBe(true);
    expect(ollama?.configured()).toBe(true);
  });
});
