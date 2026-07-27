import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AgentHarnessInvokeSchema } from "@muster/contracts";
import {
  normaliseSlackConversation,
  slackResultBlocks,
  signSlackOAuthState,
  verifySlackOAuthState,
  verifySlackRequest,
} from "./index";

describe("Slack governed harness boundary", () => {
  it("accepts only fresh, correctly signed Slack requests", () => {
    const now = 1_700_000_000_000;
    const timestamp = String(now / 1_000);
    const raw = '{"type":"event_callback"}';
    const signature = `v0=${createHmac("sha256", "test-secret")
      .update(`v0:${timestamp}:${raw}`)
      .digest("hex")}`;

    expect(verifySlackRequest(raw, timestamp, signature, "test-secret", now)).toBe(true);
    expect(verifySlackRequest(raw, timestamp, signature, "wrong-secret", now)).toBe(false);
    expect(verifySlackRequest(raw, timestamp, signature, "test-secret", now + 300_001)).toBe(false);
  });

  it("binds OAuth state to a signed, unexpired actor and organisation", () => {
    const original = process.env.SLACK_OAUTH_STATE_SECRET;
    process.env.SLACK_OAUTH_STATE_SECRET = "state-secret";
    const state = signSlackOAuthState({
      organisationId: "00000000-0000-4000-8000-000000000001",
      actorId: "00000000-0000-4000-8000-000000000002",
      expiresAt: Date.now() + 60_000,
    });
    expect(verifySlackOAuthState(state).actorId).toBe(
      "00000000-0000-4000-8000-000000000002",
    );
    expect(() => verifySlackOAuthState(`${state}x`)).toThrow("Invalid Slack OAuth state");
    if (original === undefined) delete process.env.SLACK_OAUTH_STATE_SECRET;
    else process.env.SLACK_OAUTH_STATE_SECRET = original;
  });

  it("normalises Slack Assistant lifecycle context without trusting its text", () => {
    const conversation = normaliseSlackConversation({
      event: {
        type: "assistant_thread_context_changed",
        assistant_thread: {
          user_id: "U123",
          channel_id: "D123",
          thread_ts: "1729999327.187299",
          context: { channel_id: "C456", team_id: "T789" },
        },
      },
    });
    expect(conversation.slackUserId).toBe("U123");
    expect(conversation.channelId).toBe("D123");
    expect(conversation.threadTs).toBe("1729999327.187299");
    expect(conversation.assistantThread?.context?.channel_id).toBe("C456");
  });

  it("renders bounded typed results with governed Slack actions", () => {
    const queued = slackResultBlocks("Jessie", "queued", { runId: "run-1" });
    const queuedActions = queued.find((block) => block.type === "actions") as {
      elements: Array<{ action_id: string }>;
    };
    expect(queuedActions.elements.map((element) => element.action_id)).toContain("muster.cancel");

    const failed = slackResultBlocks("Jessie", "failed", {
      runId: "run-1",
      summary: "Bounded synthetic failure",
      confidence: 0.8,
      gaps: ["No connector evidence"],
      approvalId: "00000000-0000-4000-8000-000000000003",
    });
    const failedActions = failed.find((block) => block.type === "actions") as {
      elements: Array<{ action_id: string }>;
    };
    expect(failedActions.elements.map((element) => element.action_id)).toContain("muster.retry");
    expect(failedActions.elements.map((element) => element.action_id)).toContain("muster.approval.view");
    expect(JSON.stringify(failed)).not.toContain("connector-token");

    const escaped = slackResultBlocks("Jessie", "completed", {
      summary: "External <@U123> & <https://untrusted.example|link>",
    });
    expect(JSON.stringify(escaped)).toContain("&lt;@U123&gt;");
    expect(JSON.stringify(escaped)).not.toContain("<@U123>");
  });

  it("keeps Hermes, MCP, CLI, and HTTP invocations on one portable contract", () => {
    for (const mode of ["hermes", "mcp", "cli", "http"] as const) {
      expect(
        AgentHarnessInvokeSchema.parse({
          agentKey: "Synthetic Agent",
          mode,
          input: { prompt: "Synthetic bounded request" },
        }).mode,
      ).toBe(mode);
    }
  });
});
