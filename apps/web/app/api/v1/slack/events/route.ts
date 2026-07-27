import { SlackGovernanceAdapter, verifySlackRequest } from "@muster/agent-harness";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (
    !signingSecret ||
    !verifySlackRequest(
      rawBody,
      request.headers.get("x-slack-request-timestamp"),
      request.headers.get("x-slack-signature"),
      signingSecret,
    )
  )
    return Response.json({ error: "invalid Slack signature" }, { status: 401 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid Slack payload" }, { status: 400 });
  }
  if (payload.type === "url_verification" && typeof payload.challenge === "string")
    return Response.json({ challenge: payload.challenge });
  try {
    await new SlackGovernanceAdapter().recordEvent(rawBody, payload);
  } catch {
    // Acknowledge retried or currently unmapped events. Installation health
    // records retain the authoritative failure path without leaking it to Slack.
  }
  return Response.json({ ok: true });
}
