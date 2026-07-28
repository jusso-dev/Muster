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
  reasoning is ever written to it.

## Consequences

Hermes gets exactly four stable, schema-validated read-only tools
(`muster_get_status`, `muster_list_capabilities`,
`muster_search_kelpie_cases`, `muster_get_kelpie_case`) and a starter skill
(`skills/muster-soc-operations/SKILL.md`) describing how to use them safely.
Provisioning is deliberately not a chat- or UI-driven flow in this slice —
an operator runs `pnpm --filter @muster/mcp create-installation` /
`revoke-installation` directly, which is consistent with "no arbitrary MCP
registration from chat" and "no broad administration UI" for a first slice.
A future write/approval-bearing slice (tracker item 2) can extend
`packages/mcp` with additional tools and idempotency-keyed action requests
using the same installation/capability model, without changing this ADR's
credential or connector-routing decisions.
