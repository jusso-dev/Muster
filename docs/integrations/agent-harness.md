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
`mode: "hermes"`; the MCP server exposes `muster_agents_list`,
`muster_agents_invoke`, `muster_agents_get`, and `muster_agents_cancel` as thin
calls to these routes. A CLI uses the same HTTP contract and must supply a new
idempotency key per logical request.
Adapters must never pass prompts, connector tokens, or restricted evidence to a
different tenant.

### CLI, MCP, Hermes, and custom tools

`@muster/agent-harness` ships two first-party executables after its normal
build: `muster-agent-harness` and `muster-agent-harness-mcp`. Both require an
already authenticated Muster session forwarded as an opaque header or cookie;
they do not perform login, mint identities, or store credentials. Configure the
process environment outside source control:

```sh
export MUSTER_HARNESS_URL="https://muster.example"
export MUSTER_HARNESS_AUTHORIZATION="Bearer <session-token>"
# Or: export MUSTER_HARNESS_COOKIE="muster.session_token=<session-cookie>"
```

The CLI exposes every agent the authoritative manifest allows for that actor:

```sh
muster-agent-harness list
muster-agent-harness invoke --agent=Jessie --prompt="Summarise this bounded investigation." --idempotency=case-123:jessie:1
muster-agent-harness get 00000000-0000-4000-8000-000000000001
muster-agent-harness cancel 00000000-0000-4000-8000-000000000001
```

The MCP executable uses stdio and provides `muster_agents_list`,
`muster_agents_invoke`, `muster_agents_get`, and `muster_agents_cancel`.
`muster_agents_invoke` requires an idempotency key so a client can reconnect or
retry without creating another run. Example client configuration:

```json
{
  "mcpServers": {
    "muster": {
      "command": "muster-agent-harness-mcp",
      "env": {
        "MUSTER_HARNESS_URL": "https://muster.example",
        "MUSTER_HARNESS_AUTHORIZATION": "Bearer <session-token>"
      }
    }
  }
}
```

There is no direct Hermes wire protocol in this repository. Hermes and custom
tools use `AgentHarnessHttpClient` from
`@muster/agent-harness/portable-client`, forward their actor's opaque session
credentials, and invoke the same endpoint with `mode: "hermes"` or
`mode: "http"`. This preserves the server-side identity, organisation scope,
capability checks, approval records, idempotency key, and durable run state.
Never put a token in an MCP config committed to source control or in tool
arguments, logs, manifests, prompts, or Slack metadata.

## Slack

An organisation administrator starts OAuth at `GET /api/v1/slack/install`.
Muster requires `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`,
`SLACK_SIGNING_SECRET`, `SLACK_OAUTH_STATE_SECRET`, and
`CONNECTOR_ENCRYPTION_KEY`. Set `MUSTER_PUBLIC_URL` to the browser-reachable
Muster origin used by Slack result links; it falls back to `BETTER_AUTH_URL`.
Bot tokens and inbound payloads are encrypted before they reach PostgreSQL;
only hashes, bounded error text, and audit metadata are available for
operations.

Configure Slack as follows:

- Redirect URL: `/api/v1/slack/oauth/callback`
- Events URL: `/api/v1/slack/events`
- Interactivity URL: `/api/v1/slack/interactions`
- Slash command URL: `/api/v1/slack/commands`
- Bot scopes: `app_mentions:read`, `assistant:write`, `chat:write`,
  `chat:write.customize` (per-agent username/icon for Parker/Jessie/Alfie),
  `commands`, and `im:history`
- Subscribe to app mentions and direct messages; add the Slack Assistant event
  subscriptions when Assistant Threads are enabled for the workspace.
- Subscribe to `member_joined_channel` so the bot posts a one-shot pack intro
  (Parker / Jessie / Alfie how-to) when it is added to a channel. Inbox
  `(installation_id, event_id)` uniqueness prevents duplicate posts for the
  same join event.
- Add a message shortcut with callback id `muster.review` when users should be
  able to submit an existing message as untrusted evidence for governed review.
- Subscribe to `app_uninstalled` and `tokens_revoked` so Slack-side revocation
  immediately disables the local installation and cryptographically replaces
  its stored token.

### Operator installation checklist

1. Create or select the Slack app for the intended workspace. Configure the
   redirect, Events API, interactivity, slash-command, event subscriptions,
   shortcut callback, and exact bot scopes listed above.
2. Store the Slack client id, client secret, signing secret, OAuth state secret,
   redirect URI, connector encryption key, and public Muster URL in the
   deployment secret store. Never put an `xoxb-` or `xapp-` token in source,
   Compose files, screenshots, logs, or issue comments.
3. Deploy the web and worker with the same database and encryption key. Keep
   Socket Mode disabled for the normal public HTTPS Events API deployment.
4. From Muster's Slack settings, connect the workspace through OAuth. Muster
   rejects the exchange if any required bot scope is absent.
5. Map Slack identities to existing active human actors, then expose only the
   approved agents, channels, DM policy, and optional thread-context policy.
6. Send one synthetic mention, slash command, and message shortcut. Confirm the
   queued and terminal thread updates, then inspect Slack health and worker
   metrics before enabling broader use.

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
View in Muster opens the authenticated, organisation-scoped run page.
Recommended next steps are bounded to three items. Evidence links are emitted
only for UUID evidence records and point back to Muster's capability-checked
evidence endpoint; untrusted external references are never rendered as links.
Approval Review verifies the mapped approver and opens the authoritative Muster
approval record; only the existing Muster approval decision flow can approve or
execute a dangerous action.

Slack Assistant lifecycle events `assistant_thread_started` and
`assistant_thread_context_changed` start a governed run in the assistant DM
thread and use `assistant.threads.setStatus` for queued and terminal status.
Thread context is retained only when that exposed agent explicitly allows it.
Message shortcuts bind the selected message as bounded, untrusted evidence;
message content is never interpreted as agent or system instructions.
Reconnecting repeats OAuth and atomically rotates the encrypted bot token. An
administrator can revoke an installation with `DELETE /api/v1/slack/install`
and `installationId`; this revokes Slack access and cryptographically replaces
the locally stored token. Slack `tokens_revoked` and `app_uninstalled` events
perform the same local disablement. Reconnect through OAuth after an intentional
token rotation; do not copy a replacement bot token into the database. Use the
Agents screen kill switch to stop new runs immediately. Existing queued Slack
delivery records become blocked when their installation is inactive, and a
killed agent is excluded from exposure selection before invocation.

The production baseline is Slack's HTTP Events API and the signed ingress URLs
above. Socket Mode is optional, primarily for deployments that cannot expose an
HTTPS request URL. Enable it on the worker with
`SLACK_SOCKET_MODE_ENABLED=true` and an app-level `SLACK_APP_TOKEN` beginning
with `xapp-`. The listener obtains each WebSocket URL from
`apps.connections.open`, writes the envelope through
`SlackGovernanceAdapter.recordSocketEnvelope`, and only then acknowledges its
`envelope_id`. If persistence fails, it does not acknowledge, allowing Slack to
retry. Reconnects use bounded exponential delay and share the HTTP transport's
encrypted inbox and payload-based idempotency path, so a worker restart or a new
envelope id cannot duplicate a run.

Slack API HTTP 429 responses honor `Retry-After` once when the requested delay
is at most 30 seconds. Further or longer throttles return control to BullMQ.
After three failed delivery executions the delivery becomes `dead_letter`
instead of retrying forever. Worker metrics expose API throttles, delivery
failures/dead letters, Socket Mode connections/reconnects, and envelope
persistence failures.

### Diagnostics and recovery

- `GET /api/v1/slack/health` shows organisation-scoped installation state,
  granted scopes, last delivery time, and bounded last error. A missing scope
  requires updating the Slack app and reconnecting through OAuth.
- The worker `/metrics` endpoint exposes
  `muster_slack_api_rate_limits`, `muster_slack_delivery_failures`,
  `muster_slack_delivery_dead_letters`, and the Socket Mode connection,
  reconnect, and envelope-failure counters.
- An HTTP 401 from an ingress URL means the signing secret, request timestamp,
  or public route is wrong. Check clock synchronisation and Slack's configured
  URL; never disable signature verification.
- A `dead_letter` delivery has exhausted three worker executions. Correct the
  workspace token, scopes, Slack availability, or channel access before
  explicitly replaying it. Do not blindly reset every delivery.
- With HTTP Events API, confirm Slack can reach all three signed ingress URLs.
  With optional Socket Mode, zero connections usually means the worker lacks a
  valid `xapp-` token or outbound WebSocket access. Do not enable both transports
  to troubleshoot a signing error; their shared inbox deduplicates events, but
  the extra path obscures the failing boundary.
- After revocation or uninstall, the expected state is `revoked`, no new durable
  inbox rows, and no Slack API delivery. Reconnect through OAuth only after an
  administrator confirms the workspace should be trusted again.

## Verification

The fast harness suite verifies signature replay handling, Assistant lifecycle
normalisation, typed Block Kit actions, and the portable adapter contract. The
database-backed deterministic Slack flow is opt-in because it uses the local
synthetic PostgreSQL fixture only:

```sh
MUSTER_INTEGRATION_TESTS=true pnpm --dir packages/agent-harness test
MUSTER_INTEGRATION_TESTS=true pnpm --dir apps/web test -- lifecycle.integration.test.ts
```

It asserts signed event replay across adapter restarts, an exact-once inbox/run,
bounded progress and terminal updates, approval review, cancel/retry, Assistant
status lifecycle, installation revocation, message shortcuts, bounded 429
handling, dead-letter delivery, and out-of-order terminal delivery without Slack
credentials. These synthetic tests are not proof of a live Slack installation.
The web lifecycle suite adds real local HTTP boundaries for the fake Slack Web
API and Muster ingress routes, including OAuth scope rejection and rotation,
restart replay, durable outbox-to-worker processing, one 429 retry, kill switch,
token revocation, uninstall, and blocked post-revocation delivery.
