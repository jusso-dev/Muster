# ADR 0004: Codex subscription runtime

Status: accepted

## Context

Muster is TypeScript-first and must use an operator's existing ChatGPT Codex
subscription rather than requiring separate OpenAI API billing. Agents still
need typed output, cancellation, isolation, tenant-scoped context, audit, and
approval boundaries.

## Decision

The agent gateway uses `@openai/codex-sdk`, which wraps the Codex CLI. Codex
authenticates with ChatGPT and stores its credential in a private persistent
Docker volume. A setup-only Compose service performs the one-time Codex login.

The gateway loads the investigation and agent from organisation-scoped
PostgreSQL queries. Raw database content is placed only in a labelled
`UNTRUSTED EVIDENCE` prompt section. Each run receives an empty workspace,
read-only sandbox, disabled network access, disabled web search, and no Codex
action approvals. The selected agent determines the required JSON output
schema, which Muster validates again before accepting the result.

Codex does not receive direct production shell access or credentials for
Kelpie, Tawny, Bower, Entra, or Sentinel. Mutating operations remain explicit
Muster tool calls guarded by capabilities and persisted human approvals.

## Consequences

Single-user and private-team deployments can use ChatGPT-managed Codex
entitlements and workspace policy. The credential volume must be treated as a
high-value secret, backed up only through an encrypted secret process, and
never baked into images. Multi-user hosted deployments must not share one
person's subscription credential; each deployment needs an authorised
workspace identity or a separately reviewed provider adapter.
