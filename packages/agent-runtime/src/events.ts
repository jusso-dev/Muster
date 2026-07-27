import { redactObservationText } from "@muster/config";
import { z } from "zod";

/**
 * The runtime emits a closed set of progress events. Hidden chain-of-thought,
 * raw model reasoning and raw tool payloads are never event fields: the union
 * below is the entire vocabulary, and {@link sanitiseRuntimeEvent} strips any
 * key a node adds that is not part of it.
 */
export const AgentRuntimeEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.queued") }),
  z.object({ type: z.literal("run.started") }),
  z.object({ type: z.literal("model.started") }),
  z.object({ type: z.literal("model.completed") }),
  z.object({ type: z.literal("tool.proposed"), toolKey: z.string().max(200) }),
  z.object({
    type: z.literal("tool.approval_required"),
    approvalId: z.string().max(200),
  }),
  z.object({ type: z.literal("tool.started"), toolCallId: z.string().max(200) }),
  z.object({
    type: z.literal("tool.progress"),
    toolCallId: z.string().max(200),
    summary: z.string().max(2_000),
  }),
  z.object({
    type: z.literal("tool.completed"),
    toolCallId: z.string().max(200),
  }),
  z.object({ type: z.literal("tool.failed"), toolCallId: z.string().max(200) }),
  z.object({ type: z.literal("memory.proposed"), count: z.number().int().min(0) }),
  z.object({ type: z.literal("run.completed") }),
  z.object({ type: z.literal("run.failed") }),
  z.object({ type: z.literal("run.cancelled") }),
]);

export type AgentRuntimeEventPayload = z.infer<
  typeof AgentRuntimeEventPayloadSchema
>;

export type AgentRuntimeEventType = AgentRuntimeEventPayload["type"];

export const agentRuntimeEventTypes = [
  "run.queued",
  "run.started",
  "model.started",
  "model.completed",
  "tool.proposed",
  "tool.approval_required",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "tool.failed",
  "memory.proposed",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const satisfies readonly AgentRuntimeEventType[];

export type AgentRuntimeEvent = AgentRuntimeEventPayload & {
  /** Authoritative run this event belongs to. */
  runId: string;
  organisationId: string;
  /** Monotonic per-run ordering for resumable streams. */
  sequence: number;
  occurredAt: string;
};

const allowedKeys: Record<AgentRuntimeEventType, readonly string[]> = {
  "run.queued": [],
  "run.started": [],
  "model.started": [],
  "model.completed": [],
  "tool.proposed": ["toolKey"],
  "tool.approval_required": ["approvalId"],
  "tool.started": ["toolCallId"],
  "tool.progress": ["toolCallId", "summary"],
  "tool.completed": ["toolCallId"],
  "tool.failed": ["toolCallId"],
  "memory.proposed": ["count"],
  "run.completed": [],
  "run.failed": [],
  "run.cancelled": [],
};

/**
 * Reduce an arbitrary candidate event to exactly the fields its type allows.
 * Any additional field — a reasoning trace, a raw tool result, a prompt — is
 * dropped before the event can reach a stream, a room timeline or Slack.
 */
export function sanitiseRuntimeEvent(candidate: unknown): AgentRuntimeEvent {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Runtime event must be an object");
  }
  const record = candidate as Record<string, unknown>;
  const type = record["type"];
  if (typeof type !== "string" || !(type in allowedKeys)) {
    throw new Error(`Unknown runtime event type: ${String(type)}`);
  }
  const eventType = type as AgentRuntimeEventType;
  const payload: Record<string, unknown> = { type: eventType };
  for (const key of allowedKeys[eventType]) {
    if (key in record) payload[key] = record[key];
  }
  if (
    eventType === "tool.progress" &&
    typeof payload["summary"] === "string"
  ) {
    payload["summary"] = redactObservationText(payload["summary"]).slice(
      0,
      2_000,
    );
  }
  const parsed = AgentRuntimeEventPayloadSchema.parse(payload);
  const runId = record["runId"];
  const organisationId = record["organisationId"];
  const sequence = record["sequence"];
  const occurredAt = record["occurredAt"];
  return {
    ...parsed,
    runId: typeof runId === "string" ? runId : "",
    organisationId: typeof organisationId === "string" ? organisationId : "",
    sequence: typeof sequence === "number" ? sequence : 0,
    occurredAt:
      typeof occurredAt === "string" ? occurredAt : new Date(0).toISOString(),
  };
}

/** Terminal events end a run's stream. */
export function isTerminalRuntimeEvent(
  event: Pick<AgentRuntimeEvent, "type">,
): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled"
  );
}
