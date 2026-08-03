# Architecture

Muster is an **ops brain**, not a chat product.

## Processes

| Process | Path | Role |
|---------|------|------|
| **ops API** | `apps/ops` | REST + Mastra agent/tools for bots |
| **web (optional)** | `apps/web` | Read-only `/ops` briefing |
| **domain** | `packages/ops` | Upstream clients + briefing logic |

## Data flow

```text
Endpoint API ──┐
Case API ──────┼──► packages/ops ──► apps/ops (REST + Mastra) ──► Slack / bots
TI context API ┘                              │
                                              └── apps/web /ops (optional)
```

Default open-source companions (configurable URLs):

- Endpoint: Tawny-compatible `/api/agents`, `/api/alerts`  
- Cases: Kelpie-compatible `/api/v1/cases`  
- TI: Brolga-compatible `/api/v1/health`, `/stats`, `/context`  

Chat UX lives outside Muster. See [0005-ops-brain-mastra.md](./0005-ops-brain-mastra.md) and [PRODUCT.md](../../PRODUCT.md).
