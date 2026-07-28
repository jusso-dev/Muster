import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentHarnessInvokeSchema } from "@muster/contracts";
import {
  missingSlackBotScopes,
  normaliseSlackAgentRouteText,
  normaliseSlackConversation,
  requiredSlackBotScopes,
  selectSlackExposedAgent,
  SlackRateLimitError,
  slackAgentMessageIdentity,
  slackApi,
  slackHarnessMetrics,
  slackResultBlocks,
  signSlackOAuthState,
  verifySlackOAuthState,
  verifySlackRequest,
} from "./index";

describe("Slack agent routing", () => {
  const eligible = [
    {
      agent: { name: "Parker" },
      exposure: { isDefault: true },
    },
    {
      agent: { name: "Jessie" },
      exposure: { isDefault: false },
    },
    {
      agent: { name: "Alfie" },
      exposure: { isDefault: false },
    },
  ] as const;

  it("routes natural greetings and explicit phrases to the named agent", () => {
    expect(selectSlackExposedAgent(eligible, "Hey Jessie you there")?.agent.name).toBe(
      "Jessie",
    );
    expect(selectSlackExposedAgent(eligible, "hi alfie")?.agent.name).toBe("Alfie");
    expect(
      selectSlackExposedAgent(eligible, "Jessie What Kelpie cases are open?")
        ?.agent.name,
    ).toBe("Jessie");
    expect(selectSlackExposedAgent(eligible, "use Alfie for research")?.agent.name).toBe(
      "Alfie",
    );
    expect(
      selectSlackExposedAgent(eligible, "talk to Jessie about UniFi")?.agent.name,
    ).toBe("Jessie");
    expect(
      selectSlackExposedAgent(eligible, "can I chat with Alfie please")?.agent.name,
    ).toBe("Alfie");
    expect(
      selectSlackExposedAgent(eligible, "<@U0BOT> hey Jessie — status?")?.agent.name,
    ).toBe("Jessie");
  });

  it("falls back to the default agent when no name is addressed", () => {
    expect(selectSlackExposedAgent(eligible, "hello")?.agent.name).toBe("Parker");
    expect(
      selectSlackExposedAgent(eligible, "what can you help me with")?.agent.name,
    ).toBe("Parker");
  });

  it("routes talk/chat-with phrases to the first named agent", () => {
    expect(
      selectSlackExposedAgent(eligible, "can i talk with jessie or alfie")
        ?.agent.name,
    ).toBe("Jessie");
  });

  it("normalises Slack mention markup before matching", () => {
    expect(normaliseSlackAgentRouteText("<@U123> Jessie hello")).toBe("Jessie hello");
  });

  it("presents each agent under its own Slack username", () => {
    expect(slackAgentMessageIdentity("Jessie").username).toBe("Jessie");
    expect(slackAgentMessageIdentity("Alfie").username).toBe("Alfie");
    expect(slackAgentMessageIdentity("Parker").username).toBe("Parker");
    expect(requiredSlackBotScopes).toContain("chat:write.customize");
  });
});

describe("Slack governed harness boundary", () => {
  const originalPublicUrl = process.env.MUSTER_PUBLIC_URL;

  afterEach(() => {
    if (originalPublicUrl === undefined) delete process.env.MUSTER_PUBLIC_URL;
    else process.env.MUSTER_PUBLIC_URL = originalPublicUrl;
  });

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

  it("requires every least-privilege Slack bot scope", () => {
    expect(missingSlackBotScopes(requiredSlackBotScopes)).toEqual([]);
    expect(
      missingSlackBotScopes(
        requiredSlackBotScopes.filter((scope) => scope !== "commands"),
      ),
    ).toEqual(["commands"]);
  });

  it("honours Retry-After once before a successful Slack API retry", async () => {
    const before = slackHarnessMetrics().apiRateLimits;
    const sleep = vi.fn(async () => undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { ok: false, error: "ratelimited" },
          { status: 429, headers: { "retry-after": "2" } },
        ),
      )
      .mockResolvedValueOnce(Response.json({ ok: true, ts: "1.2" }));

    await expect(
      slackApi(
        "xoxb-synthetic",
        "chat.postMessage",
        { channel: "C-synthetic" },
        { fetch: fetcher, sleep },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(slackHarnessMetrics().apiRateLimits).toBe(before + 1);
  });

  it("rejects unsafe or repeated Slack API rate-limit delays", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { ok: false, error: "ratelimited" },
        { status: 429, headers: { "retry-after": "45" } },
      ),
    );

    await expect(
      slackApi(
        "xoxb-synthetic",
        "chat.update",
        { channel: "C-synthetic" },
        { fetch: fetcher, sleep, maximumRetryAfterMs: 30_000 },
      ),
    ).rejects.toBeInstanceOf(SlackRateLimitError);
    expect(sleep).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
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
    process.env.MUSTER_PUBLIC_URL = "https://muster.example";
    const queued = slackResultBlocks("Jessie", "queued", { runId: "run-1" });
    const queuedActions = queued.find((block) => block.type === "actions") as {
      elements: Array<{ action_id: string; url?: string }>;
    };
    expect(queuedActions.elements.map((element) => element.action_id)).toContain("muster.cancel");
    expect(
      queuedActions.elements.find(
        (element) => element.action_id === "muster.view_in_muster",
      )?.url,
    ).toBe("https://muster.example/agent-runs/run-1");

    const failed = slackResultBlocks("Jessie", "failed", {
      runId: "run-1",
      summary: "Bounded synthetic failure",
      confidence: 0.8,
      gaps: ["No connector evidence"],
      recommendedNextSteps: [
        "Review <@U123> findings",
        "Collect bounded endpoint context",
      ],
      evidenceReferences: [
        {
          type: "evidence",
          reference: "00000000-0000-4000-8000-000000000004",
        },
        {
          type: "external",
          reference: "https://untrusted.example/evidence",
        },
      ],
      approvalId: "00000000-0000-4000-8000-000000000003",
    });
    const failedActions = failed.find((block) => block.type === "actions") as {
      elements: Array<{ action_id: string }>;
    };
    expect(failedActions.elements.map((element) => element.action_id)).toContain("muster.retry");
    expect(failedActions.elements.map((element) => element.action_id)).toContain("muster.approval.view");
    expect(JSON.stringify(failed)).toContain(
      "https://muster.example/api/v1/evidence/00000000-0000-4000-8000-000000000004",
    );
    expect(JSON.stringify(failed)).toContain("Actions / next steps");
    expect(JSON.stringify(failed)).toContain("Review &lt;@U123&gt; findings");
    expect(JSON.stringify(failed)).not.toContain("https://untrusted.example");
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
