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
  const encoded = new URLSearchParams(rawBody).get("payload");
  if (!encoded) return Response.json({ error: "invalid Slack interaction" }, { status: 400 });
  try {
    const payload = JSON.parse(encoded) as Record<string, unknown>;
    await new SlackGovernanceAdapter().recordEvent(rawBody, payload);
  } catch {
    // Slack requires a fast acknowledgement. The durable inbox carries retries
    // and operator-visible delivery health without exposing internals to Slack.
  }
  return Response.json({ ok: true });
}
