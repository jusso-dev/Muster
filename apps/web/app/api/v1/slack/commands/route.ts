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
  const values = new URLSearchParams(rawBody);
  const teamId = values.get("team_id");
  const userId = values.get("user_id");
  const channelId = values.get("channel_id");
  if (!teamId || !userId || !channelId)
    return Response.json({ error: "invalid Slack command" }, { status: 400 });
  try {
    await new SlackGovernanceAdapter().recordEvent(rawBody, {
      type: "slash_command",
      team_id: teamId,
      event_id: values.get("trigger_id") ?? undefined,
      event: {
        type: "slash_command",
        user: userId,
        channel: channelId,
        channel_type: values.get("channel_name") === "directmessage" ? "im" : "channel",
        text: values.get("text") ?? "",
      },
    });
  } catch {
    // The signed request is acknowledged within Slack's deadline; outbox retry
    // and installation health hold the durable failure path.
  }
  return Response.json({ response_type: "ephemeral", text: "Muster accepted your request." });
}
