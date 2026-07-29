# ADR 0006 — Ops control-plane UI (chat out of web)

## Status

Accepted (2026-07-29)

## Context

Muster shipped residual room/chat UI that competed with Slack and Hermes. Operators
needed a place to verify agents, connectors, Slack, Codex, and MCP — not another
chat surface. Product reality: chat is Slack (Muster bot) and Hermes; Kelpie is
case SoR; Muster is the governed control plane.

## Decision

1. **Web UI purpose** — organisation admin control plane: health, agent pack status,
   connector/Slack/MCP wiring, approvals. Not collaborative chat.
2. **Primary route** — `/` is a control-plane health dashboard.
3. **Chat UI** — rooms, composer, channel browser, and related chrome are removed
   from the default product surface (APIs may remain until a later deprecation).
4. **Interaction model** — Parker / Jessie / Alfie talk in Slack; Hermes uses MCP.
5. **Visual language** — dense admin shell inspired by modern shadcn dashboards
   (sidebar + cards + tables), still Muster brand tokens and anti-hype rules.
6. **Channel onboarding** — when the bot joins a Slack channel, post one pack intro
   (separate delivery; see agent-harness).

## Consequences

- PRODUCT/DESIGN/README must not describe rooms as primary.
- Operators use `./scripts/bootstrap-e2e-homelab.sh` plus the health UI.
- Slack `agent_view` migration remains a separate track.
- Room message APIs are not deleted in the first cut.

## Alternatives considered

- Keep rooms as primary and add a health page — rejected; dilutes the product.
- Full shadcn-dashboard Vite port — rejected; Muster is Next.js modular monolith.
