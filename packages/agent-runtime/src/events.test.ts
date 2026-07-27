import { describe, expect, it } from "vitest";
import {
  agentRuntimeEventTypes,
  isTerminalRuntimeEvent,
  sanitiseRuntimeEvent,
  type AgentRuntimeEventType,
} from "./events.ts";

const CANARY = "SECRET_CHAIN_OF_THOUGHT";

/** Fields the allowed vocabulary requires for each event type. */
function requiredFieldsFor(type: AgentRuntimeEventType): Record<string, unknown> {
  switch (type) {
    case "tool.proposed":
      return { toolKey: "synthetic.tool" };
    case "tool.approval_required":
      return { approvalId: "approval-1" };
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return { toolCallId: "tool-call-1" };
    case "tool.progress":
      return { toolCallId: "tool-call-1", summary: "Synthetic progress." };
    case "memory.proposed":
      return { count: 1 };
    default:
      return {};
  }
}

describe("sanitiseRuntimeEvent", () => {
  it("strips reasoning, rawPrompt and modelThinking from a tool.completed candidate", () => {
    const result = sanitiseRuntimeEvent({
      type: "tool.completed",
      toolCallId: "t1",
      reasoning: CANARY,
      rawPrompt: "Some raw prompt text.",
      modelThinking: "Some hidden model thinking.",
    });
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(result).not.toHaveProperty("reasoning");
    expect(result).not.toHaveProperty("rawPrompt");
    expect(result).not.toHaveProperty("modelThinking");
    expect(result).toMatchObject({ type: "tool.completed", toolCallId: "t1" });
  });

  it("strips a chainOfThought canary from every event type in the vocabulary", () => {
    for (const type of agentRuntimeEventTypes) {
      const candidate = {
        type,
        ...requiredFieldsFor(type),
        chainOfThought: CANARY,
      };
      const result = sanitiseRuntimeEvent(candidate);
      expect(JSON.stringify(result)).not.toContain(CANARY);
      expect(result).not.toHaveProperty("chainOfThought");
    }
  });

  it("redacts a bearer token from a tool.progress summary", () => {
    const summary = `Fetched inventory. Authorization: Bearer abcdef123456 was used.`;
    const result = sanitiseRuntimeEvent({
      type: "tool.progress",
      toolCallId: "t1",
      summary,
    });
    expect(result.type).toBe("tool.progress");
    if (result.type === "tool.progress") {
      expect(result.summary).not.toContain("abcdef123456");
    }
  });

  it("truncates a tool.progress summary to 2000 characters", () => {
    const longSummary = `Authorization: Bearer abcdef123456 ${"x".repeat(3_000)}`;
    const result = sanitiseRuntimeEvent({
      type: "tool.progress",
      toolCallId: "t1",
      summary: longSummary,
    });
    expect(result.type).toBe("tool.progress");
    if (result.type === "tool.progress") {
      expect(result.summary).not.toContain("abcdef123456");
      expect(result.summary.length).toBeLessThanOrEqual(2_000);
    }
  });

  it("throws for an unknown event type", () => {
    expect(() => sanitiseRuntimeEvent({ type: "not.a.real.event" })).toThrow();
  });

  it("throws for a non-object candidate", () => {
    expect(() => sanitiseRuntimeEvent(null)).toThrow();
    expect(() => sanitiseRuntimeEvent("run.completed")).toThrow();
    expect(() => sanitiseRuntimeEvent(["run.completed"])).toThrow();
  });
});

describe("isTerminalRuntimeEvent", () => {
  it("is true for exactly run.completed, run.failed and run.cancelled", () => {
    const terminal = new Set(["run.completed", "run.failed", "run.cancelled"]);
    for (const type of agentRuntimeEventTypes) {
      expect(isTerminalRuntimeEvent({ type })).toBe(terminal.has(type));
    }
  });
});
