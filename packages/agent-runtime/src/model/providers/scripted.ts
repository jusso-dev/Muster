import { AgentRuntimeError } from "../../errors.ts";
import { modelClasses } from "../types.ts";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ModelToolProposal,
  ModelUsage,
} from "../types.ts";

/**
 * One offline, deterministic model turn. Omitted fields fall back to the
 * `ModelResponse` defaults (no tool calls, no content, zero usage/cost).
 * A tool-call turn followed by a content turn expresses the common
 * "propose a tool, then answer from its result" agent loop without any
 * network access.
 */
export type ScriptedTurn = {
  content?: string | null;
  toolCalls?: readonly ModelToolProposal[];
  usage?: ModelUsage;
  estimatedCostCents?: number;
  modelId?: string;
};

export type ScriptedProviderOptions = { id?: string };

/**
 * Fully offline `ModelProvider` for tests and demos. Serves every model
 * class, is always configured, and never touches the network. Turns are
 * served strictly in order; calling `generate` past the end of the script
 * throws a clear `AgentRuntimeError` rather than looping or returning stale
 * data.
 */
export function createScriptedProvider(
  script: readonly ScriptedTurn[],
  options: ScriptedProviderOptions = {},
): ModelProvider {
  const id = options.id ?? "scripted";
  let cursor = 0;

  function configured(): boolean {
    return true;
  }

  async function generate(_request: ModelRequest): Promise<ModelResponse> {
    const turn = script[cursor];
    if (!turn) {
      throw new AgentRuntimeError(
        `Scripted model provider "${id}" script exhausted after serving ${cursor} turn(s).`,
        "model_provider_unavailable",
        { providerId: id, turnsServed: cursor },
      );
    }
    cursor += 1;
    return {
      toolCalls: turn.toolCalls ?? [],
      content: turn.content ?? null,
      usage: turn.usage ?? { inputTokens: 0, outputTokens: 0 },
      estimatedCostCents: turn.estimatedCostCents ?? 0,
      modelId: turn.modelId ?? id,
    };
  }

  return {
    kind: "scripted",
    id,
    local: true,
    classes: modelClasses,
    configured,
    generate,
  };
}
