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
For example, Hermes submits the signed actor's `agentKey`, structured input, and
`mode: "hermes"`; an MCP server exposes `agents/list`, `agents/invoke`,
`agents/get`, and `agents/cancel` as thin calls to these routes. A CLI uses the
same HTTP contract and must supply a new idempotency key per logical request.
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
- Bot scopes: `app_mentions:read`, `assistant:write`, `chat:write`, `commands`,
  and `im:history`
- Subscribe to app mentions and direct messages; add the Slack Assistant event
  subscriptions when Assistant Threads are enabled for the workspace.

Administrators map each Slack user to an active Muster human actor with
`POST /api/v1/slack/identities`, then expose approved agents and channel policy
using `PUT /api/v1/slack/exposures`. `GET /api/v1/slack/health` is the admin
health view for installation status, scopes, delivery time, and redacted errors.
The default exposed agent handles ordinary mentions and DMs; users can explicitly
switch with `/muster AgentName …`, `use AgentName …`, or a slash-command argument
beginning with the exposed agent name.
Slack accepts only fresh HMAC-signed requests, persists them using a workspace
event idempotency key, acknowledges immediately, and invokes agents asynchronously
from the outbox. One bounded execution-progress update and the terminal typed
result are updated in the original thread and offer
capability-checked Cancel, Retry, Approval Review, and View in Muster actions.
Approval Review verifies the mapped approver and opens the authoritative Muster
approval record; only the existing Muster approval decision flow can approve or
execute a dangerous action.

Slack Assistant lifecycle events `assistant_thread_started` and
`assistant_thread_context_changed` start a governed run in the assistant DM
thread and use `assistant.threads.setStatus` for queued and terminal status.
Thread context is retained only when that exposed agent explicitly allows it.
Reconnecting repeats OAuth and atomically rotates the encrypted bot token. An
administrator can revoke an installation with `DELETE /api/v1/slack/install`
and `installationId`; this revokes Slack access and cryptographically replaces
the locally stored token.

For Socket Mode, acknowledge Slack's `envelope_id` immediately and pass the
envelope payload to `SlackGovernanceAdapter.recordSocketEnvelope`. It shares the
same encrypted inbox and idempotency path as Events API delivery, so reconnects
cannot duplicate a run.

## Verification

The fast harness suite verifies signature replay handling, Assistant lifecycle
normalisation, typed Block Kit actions, and the portable adapter contract. The
database-backed deterministic Slack flow is opt-in because it uses the local
synthetic PostgreSQL fixture only:

```sh
MUSTER_INTEGRATION_TESTS=true pnpm --dir packages/agent-harness test
```

It asserts signed event replay, an exact-once inbox/run, bounded progress and
terminal updates, approval review, cancel/retry, Assistant status lifecycle, and
out-of-order terminal delivery without Slack credentials.
