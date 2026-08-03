# ADR 0005: Ops brain + Mastra tools (not a chat product)

Status: Accepted  
Date: 2026-08-03

## Context

Muster began as a full security collaboration workspace (rooms, in-app agents, investigation UI). In practice, operators already chat in Slack (or similar), and authoritative data already lives in:

- an endpoint / fleet product  
- a case / IR product  
- a threat-intel context API  

Duplicating chat inside Muster adds little value. The valuable layer is a **small, toolable query surface** over those systems.

## Decision

1. **Muster is headless-first**: HTTP API + Mastra tools/agent.  
2. **No product chat UI** — conversation stays in the operator’s workspace (for example Slack).  
3. **Mastra** (`@mastra/core`) owns tool definitions and ops-agent instructions. Bot hosts call those tools; they do not reimplement connectors.  
4. **Systems of record stay systems of record** — Muster may cache short-lived snapshots for briefing speed; it is not a second case or TI store.  
5. Optional **read-only status UI** only (`/ops`).  

## Consequences

- Default contribution path: `packages/ops` + `apps/ops`.  
- Slack (or Teams, etc.) is the human chat surface.  
- Integration tests target real API contracts or explicitly labelled mocks.  
- Older collaboration-oriented modules are removed from the tree.  
