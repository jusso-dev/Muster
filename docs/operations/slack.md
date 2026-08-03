# Connecting a Slack bot

Muster does not embed Slack. Your bot (or a Mastra Slack host) calls Muster over HTTP.

## Option A — Existing Slack bot (recommended)

1. Deploy Muster ops (`apps/ops`) with upstream tokens and `MUSTER_OPS_TOKEN`.  
2. Ensure the bot process can reach the ops URL (private network or tunnel).  
3. On each mention or DM, call the agent endpoint:

```http
POST /api/v1/agent/generate
Authorization: Bearer <MUSTER_OPS_TOKEN>
Content-Type: application/json

{ "message": "<user text from Slack>" }
```

4. Post `text` from the JSON response back to the channel.

Example (TypeScript sketch):

```ts
const res = await fetch(`${process.env.MUSTER_OPS_URL}/api/v1/agent/generate`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.MUSTER_OPS_TOKEN}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ message: event.text }),
});
const { text } = await res.json();
await say(text);
```

You can also call structured routes without an LLM:

| Intent | Call |
|--------|------|
| Fleet status | `GET /api/v1/fleet` |
| Open cases | `GET /api/v1/cases/open` |
| TI lookup | `POST /api/v1/ti/lookup` |
| Digest | `GET /api/v1/briefing` |

## Option B — New Slack app (manual)

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps).  
2. Add bot scopes as needed, for example:  
   `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`.  
3. Install to the workspace; copy the **Bot User OAuth Token**.  
4. Use **Socket Mode** (easy behind a firewall) or public Request URLs for Events API.  
5. Subscribe to `app_mention` and/or `message.im`.  
6. Run a small bridge process that forwards text to Muster as in Option A.  

## Option C — Mastra Slack channel

Mastra can host Slack connectivity via `@mastra/slack` (`SlackProvider`). In that model you import the same tools from `apps/ops/src/mastra` into a Mastra process that owns the Slack connection. See [Mastra documentation](https://mastra.ai/docs).

## Example prompts

- “Which hosts are offline or stale?”  
- “List open cases that need attention and any MTTR signal.”  
- “Look up TI on 203.0.113.10.”  
- “Give me an ops briefing.”  

## Safety

- Scope the Slack app to private ops channels when possible.  
- Do not put upstream API tokens in Slack; only the Muster bearer token belongs in the bot.  
- Muster tools are read-oriented; do not treat agent replies as executed response actions.  
