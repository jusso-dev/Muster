import { Annotation } from "@langchain/langgraph";
import type { ModelMessage, ModelUsage } from "../model/types.ts";

/**
 * Graph state is execution state only. It never holds connector secrets,
 * capability sets, approval decisions or anything else PostgreSQL is
 * authoritative for — those are re-read through ports at each step so a
 * resumed run cannot act on a stale permission snapshot.
 */

export type PendingToolCall = {
  toolCallId: string;
  toolName: string;
  /** Schema-validated arguments. Never the raw model output. */
  arguments: unknown;
  argumentsHash: string;
  capability: string;
  classification: string;
  approvalAction: string | null;
  approvalId: string | null;
};

export type ToolAuthorisationOutcome =
  | "allowed"
  | "approval_required"
  | "denied"
  | null;

/**
 * Messages append by default. Context compaction replaces the window
 * wholesale, which the reducer expresses explicitly rather than by mutating
 * a previously checkpointed array.
 */
export type MessagesUpdate =
  | readonly ModelMessage[]
  | { replaceWith: readonly ModelMessage[] };

function reduceMessages(
  current: readonly ModelMessage[],
  update: MessagesUpdate,
): readonly ModelMessage[] {
  if (Array.isArray(update)) return [...current, ...update];
  if ("replaceWith" in update) return [...update.replaceWith];
  return current;
}

export const RuntimeStateAnnotation = Annotation.Root({
  humanRequest: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  outputSchema: Annotation<string>({
    reducer: (_current, update) => update,
    default: () => "",
  }),
  messages: Annotation<readonly ModelMessage[], MessagesUpdate>({
    reducer: reduceMessages,
    default: () => [],
  }),
  /** Bounded summary of everything compaction dropped from the window. */
  contextSummary: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  memoryTitles: Annotation<readonly string[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  /** Model/tool turns taken so far, bounded by the agent's step ceiling. */
  stepCount: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),
  /** Consecutive schema-invalid final responses; bounded before failing. */
  invalidOutputAttempts: Annotation<number>({
    reducer: (current, update) => (update === 0 ? 0 : current + update),
    default: () => 0,
  }),
  pendingToolCall: Annotation<PendingToolCall | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  toolAuthorisation: Annotation<ToolAuthorisationOutcome>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  /** Why the last proposed tool call was refused, phrased for the model. */
  denialReason: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  pendingApprovalId: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  finalContent: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  usage: Annotation<ModelUsage>({
    reducer: (current, update) => ({
      inputTokens: current.inputTokens + update.inputTokens,
      outputTokens: current.outputTokens + update.outputTokens,
    }),
    default: () => ({ inputTokens: 0, outputTokens: 0 }),
  }),
  estimatedCostCents: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),
  proposedMemories: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  /** Set once the graph has produced a validated, persisted result. */
  settled: Annotation<boolean>({
    reducer: (_current, update) => update,
    default: () => false,
  }),
});

export type RuntimeState = typeof RuntimeStateAnnotation.State;
export type RuntimeStateUpdate = typeof RuntimeStateAnnotation.Update;

/** Rough token estimate. Deliberately provider-neutral and pessimistic. */
export function estimateTokens(messages: readonly ModelMessage[]): number {
  let characters = 0;
  for (const message of messages) characters += message.content.length + 16;
  return Math.ceil(characters / 4);
}
