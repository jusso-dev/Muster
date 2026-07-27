import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  recordEvent: vi.fn(),
  verifySlackRequest: vi.fn(),
}));

vi.mock("@muster/agent-harness", () => ({
  verifySlackRequest: harness.verifySlackRequest,
  SlackGovernanceAdapter: class {
    recordEvent = harness.recordEvent;
  },
}));

import { POST as command } from "./commands/route.ts";
import { POST as event } from "./events/route.ts";
import { POST as interaction } from "./interactions/route.ts";

function request(body: string, headers: HeadersInit = {}) {
  return new Request("https://muster.example/api/v1/slack/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": "1700000000",
      "x-slack-signature": "v0=synthetic",
      ...headers,
    },
    body,
  });
}

describe("Slack signed ingress", () => {
  const originalSecret = process.env.SLACK_SIGNING_SECRET;

  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = "synthetic-signing-secret";
    harness.recordEvent.mockReset();
    harness.verifySlackRequest.mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SLACK_SIGNING_SECRET;
    else process.env.SLACK_SIGNING_SECRET = originalSecret;
  });

  it("rejects unsigned Events API payloads before parsing or persistence", async () => {
    harness.verifySlackRequest.mockReturnValue(false);
    const response = await event(request('{"type":"event_callback"}'));
    expect(response.status).toBe(401);
    expect(harness.recordEvent).not.toHaveBeenCalled();
  });

  it("answers only signed Slack URL verification without creating an inbox event", async () => {
    const response = await event(
      request('{"type":"url_verification","challenge":"synthetic-challenge"}'),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      challenge: "synthetic-challenge",
    });
    expect(harness.recordEvent).not.toHaveBeenCalled();
  });

  it("normalises a signed slash command into durable, direct-message ingress", async () => {
    const body = new URLSearchParams({
      team_id: "T-synthetic",
      user_id: "U-synthetic",
      channel_id: "D-synthetic",
      channel_name: "directmessage",
      trigger_id: "trigger-synthetic",
      text: "Jessie bounded synthetic request",
    }).toString();
    const response = await command(
      request(body, { "content-type": "application/x-www-form-urlencoded" }),
    );
    expect(response.status).toBe(200);
    expect(harness.recordEvent).toHaveBeenCalledWith(body, {
      type: "slash_command",
      team_id: "T-synthetic",
      event_id: "trigger-synthetic",
      event: {
        type: "slash_command",
        user: "U-synthetic",
        channel: "D-synthetic",
        channel_type: "im",
        text: "Jessie bounded synthetic request",
      },
    });
  });

  it("rejects malformed signed interaction bodies without invoking an adapter", async () => {
    const response = await interaction(
      request("not-a-slack-interaction", {
        "content-type": "application/x-www-form-urlencoded",
      }),
    );
    expect(response.status).toBe(400);
    expect(harness.recordEvent).not.toHaveBeenCalled();
  });
});
