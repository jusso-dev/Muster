# Authentication and capabilities

## Ops API

| Mechanism | Behaviour |
|-----------|-----------|
| No `MUSTER_OPS_TOKEN` | Open access to `/api/v1/*` (local dev only) |
| `MUSTER_OPS_TOKEN` set | Require `Authorization: Bearer <token>` on `/api/v1/*` |
| `/health` | Unauthenticated liveness |

There is no end-user login on the ops API. Identity is the shared service token held by the bot host.

## Optional web UI

The status page reads `MUSTER_OPS_URL` server-side and may forward `MUSTER_OPS_TOKEN`. Do not expose the UI publicly without an authenticating reverse proxy.

## Upstream credentials

| Variable | Used for |
|----------|----------|
| `TAWNY_API_TOKEN` | Endpoint fleet API |
| `KELPIE_API_TOKEN` | Case API |
| `BROLGA_API_TOKEN` | TI context API |
| Provider keys (e.g. `OPENAI_API_KEY`) | Mastra model router for `/api/v1/agent/generate` |

Grant **read** scopes where the upstream supports them. Muster ops tools are designed for read-oriented queries.

## Capabilities (product intent)

| Capability | Tools / routes |
|------------|----------------|
| Fleet read | `fleet_list`, `fleet_host`, `GET /api/v1/fleet` |
| Cases read | `cases_open`, `GET /api/v1/cases/open` |
| TI read | `ti_lookup`, `brolga_stats`, related routes |
| Briefing | `ops_briefing`, `GET /api/v1/briefing` |
| Agent NL | `POST /api/v1/agent/generate` |

Fine-grained per-tool tokens are not implemented yet; one ops bearer unlocks all tools. Split tokens can be added later if required.
