# ADR 0005: Remote Muster MCP server for Hermes

Status: accepted

## Context

The product direction changed: Muster is no longer a conversational agent
harness or chat UI. Hermes owns sessions, models, memory, delegation, and
Slack delivery. Muster becomes the authenticated governed control plane
Hermes calls into. The first vertical slice must prove that boundary with a
real remote MCP endpoint, revocable server-side credentials scoped to one
organisation, and read-only Kelpie access routed through the existing
governed connector path — without restoring the retired agent runtime, chat
UI, or Slack gateway.

## Decision

`apps/mcp-server` is a new, minimal raw `node:http` app (the same shape as
`apps/agent-gateway`/`apps/worker`, not a second copy of either) that speaks
MCP Streamable HTTP (`@modelcontextprotocol/sdk`, already a pinned
dependency via `packages/agent-harness`). It is deliberately not folded into
`apps/agent-gateway`: that app is the Codex agent-run runtime this slice
must not touch, and folding the two together would blur exactly the
boundary this ADR exists to draw.

`packages/mcp` holds the domain logic and has no HTTP framework dependency:

- **Installation credentials** (`mcp_installations`, modelled on the
  existing `slack_installations` shape): a random bearer token is hashed
  (SHA-256) at rest; only the hash and a short non-secret prefix are stored.
  Each row binds to exactly one organisation and one "policy subject" actor
  whose `capabilityAssignments` are re-read fresh on every request — the
  same `AuthorisationSubject`/`requireCapability` model every other domain
  service already uses. Revocation sets `status`/`revokedAt` and is
  effective on the next request; every failure path (unknown, malformed,
  revoked, or organisation-mismatched token, or a deactivated bound actor)
  returns the same generic denial, never distinguishing "does not exist"
  from "not authorised."
- **Tool scope**: an installation additionally carries a `scopes` allow-list
  of tool names, enforced independently of capability. No tool schema
  accepts an organisation id, actor id, or capability — there is nothing
  for a model-supplied argument to override.
- **Kelpie access reuses the existing governed connector path exactly**:
  `packages/mcp/src/kelpie-gateway.ts` inserts the same
  `integration_query_runs` row shape, the same audit event, and the same
  outbox row (`queueName: "muster-integrations"`,
  `eventType: "connector.query.queued"`) that
  `apps/web/lib/connector-domain.ts`'s `queueQuery()` already writes. The
  unmodified `apps/worker` BullMQ processor picks it up, decrypts the
  connector credential, and calls the same `executeGovernedQuery` (DNS
  pinning, SSRF/redirect denial, schema-validated request/response,
  `redactUntrusted` before persistence) as every other connector. The MCP
  tool call polls the authoritative row for a bounded window (8s) rather
  than blocking indefinitely; a still-processing run returns a `timeout`
  error, not a hang. No second execution path is introduced.
- **Output handling**: every Kelpie result is wrapped
  `classification: "untrusted_evidence"`, bounded to 25 records, with
  oversized strings truncated and secret-shaped keys/values redacted a
  second time at the tool boundary (on top of the redaction the worker
  already applies before persistence).
- **Invocation/audit records** reuse the existing hash-chained
  `audit_events` table (`appendAuditEvent`) rather than a new table: one
  `mcp.tool.invoked` event per call, carrying tool name, tool version,
  installation id, outcome, a SHA-256 hash of the returned payload, and
  evidence references (query run ids). No prompt, argument text, or model
  reasoning is ever written to it. A failure to write that event is logged
  (`mcp.audit.write_failed`), not silently swallowed, so an audit gap is
  detectable rather than invisible.
- **Actor/organisation integrity for installation lifecycle mutations**:
  `createInstallation`/`revokeInstallation` re-derive the acting actor's
  organisation membership and `administration.manage` capability from the
  database inside the same transaction as the mutation — never trusted from
  the caller — and a composite foreign key
  (`(actor_id, organisation_id) -> actors(id, organisation_id)`, backed by a
  new `actors_id_organisation_unique` index) makes a cross-organisation actor
  binding impossible at the schema level too, as defence in depth.
  Provisioning a credential is still not gated behind a multi-party approval
  record; see "Deferred" below.
- **Reliability hardening**: the HTTP server drains in-flight requests
  (awaits `server.close()`'s callback) before closing the database pool on
  shutdown; `/health` performs a real `select 1` against Postgres rather
  than a static stub; `requestTimeout`/`headersTimeout`/`keepAliveTimeout`
  are set explicitly (with headroom over the 8s Kelpie poll bound) so a
  burst of concurrent bounded polls can't hold connections open
  indefinitely; and `@muster/database`'s pool now has an `error` listener —
  without one, an idle-client error (the database restarting) is an
  unhandled Node `'error'` event that crashes the whole process, which is
  exactly what a dependency-aware health check will provoke during any real
  outage.

## Deferred

Two review findings described genuine architectural tensions rather than
bugs, and are deliberately not addressed by a larger protocol change in this
vertical slice:

- **Kelpie tool calls poll inside the HTTP request handler for up to 8s.**
  This is in tension with "keep long-running integration work out of
  request handlers," but MCP's tool-call contract in this SDK is
  synchronous request/response — returning immediately would mean either a
  second "fetch the result" tool (expanding the four-tool contract this
  issue specifies) or adopting the SDK's experimental async-tasks surface.
  Both are a real protocol-shape decision for a later slice, not a small
  fix. The request/socket timeouts above bound the resource cost in the
  meantime.
- **The per-integration rate-limit check is a soft limit**, not a hard
  concurrency-safe one: it now runs inside the same transaction and under
  an advisory lock scoped to the integration (mirroring
  `appendAuditEvent`'s org-scoped lock), which closes the read-then-insert
  race that existed before. A determined caller opening many concurrent
  connections could still contend on that lock rather than being rejected
  outright; a dedicated token-bucket limiter would be a heavier addition
  reserved for if Kelpie rate limits become an operational problem in
  practice.

## Consequences

Hermes gets stable, schema-validated read-only tools by default, including
status/capabilities, Kelpie case search/get, and Tawny endpoint inventory,
alerts, and bounded hunt tools. Opt-in write/proposal tools
(`muster_propose_kelpie_action`, `muster_get_action_status`) cover tracker
item 2. Connector product reads share one governed queue/worker path. Write tools reuse the same
`integration_deliveries` + `approvals` + worker path as the web integration
action domain: proposals are always approval-gated, client-supplied
idempotency keys resume prior deliveries, and resumption is a status read
that never re-executes external work. A starter skill
(`skills/muster-soc-operations/SKILL.md`) describes how to use them safely.
Provisioning is deliberately not a chat- or UI-driven flow — an operator
runs `pnpm --filter @muster/mcp create-installation` /
`revoke-installation` directly, which is consistent with "no arbitrary MCP
registration from chat" and "no broad administration UI" for this slice.
