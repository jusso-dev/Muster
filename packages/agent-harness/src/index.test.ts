import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
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
});
