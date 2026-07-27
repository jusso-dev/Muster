# Governed agent harnesses

Muster agents are exposed through `muster.agent-harness/v1`. Every adapter uses
the same organisation-scoped manifest, capability checks, approval model, durable
`agent_runs` record, outbox event, audit event, cancellation, and typed result.
Redis and BullMQ only execute the durable PostgreSQL state transition.

## Portable adapters

Fetch `GET /api/v1/agent-harness/manifests` to discover only agents the current
actor may invoke. Submit `POST /api/v1/agent-harness/invocations` with an
`Idempotency-Key` header and a body such as:

```json
{
  "agentKey": "Jessie",
  "mode": "http",
  "input": { "prompt": "Summarise this bounded investigation." }
}
```

Poll `GET /api/v1/agent-harness/runs/:id`; `DELETE` on that resource requests a
capability-checked cancellation. Hermes, MCP, and CLI adapters use the same
manifest and invocation shape, changing only `mode` to `hermes`, `mcp`, or `cli`.
Adapters must never pass prompts, connector tokens, or restricted evidence to a
different tenant.

## Slack

An organisation administrator starts OAuth at `GET /api/v1/slack/install`.
Muster requires `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`,
`SLACK_SIGNING_SECRET`, `SLACK_OAUTH_STATE_SECRET`, and
`CONNECTOR_ENCRYPTION_KEY`. Bot tokens and inbound payloads are encrypted before
they reach PostgreSQL; only hashes, bounded error text, and audit metadata are
available for operations.

Configure Slack as follows:

- Redirect URL: `/api/v1/slack/oauth/callback`
- Events URL: `/api/v1/slack/events`
- Interactivity URL: `/api/v1/slack/interactions`
- Slash command URL: `/api/v1/slack/commands`
- Bot scopes: `app_mentions:read`, `chat:write`, `commands`, and `im:history`
- Subscribe to app mentions and direct messages; add the Slack Assistant event
  subscriptions when Assistant Threads are enabled for the workspace.

Administrators map each Slack user to an active Muster human actor with
`POST /api/v1/slack/identities`, then expose approved agents and channel policy
using `PUT /api/v1/slack/exposures`. `GET /api/v1/slack/health` is the admin
health view for installation status, scopes, delivery time, and redacted errors.
Slack accepts only fresh HMAC-signed requests, persists them using a workspace
event idempotency key, acknowledges immediately, and invokes agents asynchronously
from the outbox. Result messages are updated in their original thread and offer
capability-checked Cancel, Retry, and View in Muster actions.

For Socket Mode, acknowledge Slack's `envelope_id` immediately and pass the
envelope payload to `SlackGovernanceAdapter.recordSocketEnvelope`. It shares the
same encrypted inbox and idempotency path as Events API delivery, so reconnects
cannot duplicate a run.
