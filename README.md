# Muster

> **Ask the stack. Chat stays in Slack.**

Muster is an **ops brain** for security tooling — not a chat product and not a case or EDR platform.

It watches upstream systems of record, then exposes a small **HTTP API** and **[Mastra](https://mastra.ai/)** tools so a Slack (or other) agent can answer operational questions with real data.

Typical questions:

- Which endpoints are healthy, stale, or offline?
- Which incident cases need attention, and what is the MTTR signal?
- Does this IP, domain, or hash have threat-intelligence context?
- What is on fire right now? (structured briefing)

Humans talk to **one agent in their workspace chat** (for example Slack). That agent calls Muster tools. Muster does **not** host rooms, DMs, or an in-app conversation UI.

## Companion products

Muster is designed to sit alongside (not replace):

| Role | Example open-source projects |
|------|------------------------------|
| Endpoint fleet / detections | [Tawny](https://github.com/jusso-dev/tawny) |
| Incident cases / IR queue | [Kelpie](https://github.com/jusso-dev/Kelpie) |
| Threat-intel context API | [Brolga](https://github.com/jusso-dev/Brolga) (often fed by OpenCTI or similar) |
| Chat UX | Slack, Teams, or any bot host |

Connectors are configured with base URLs and API tokens. You can point them at those projects or any compatible APIs.

See [PRODUCT.md](./PRODUCT.md) and [architecture](./docs/architecture/README.md).

## Repository layout

```text
packages/ops/     # Upstream clients + fleet / cases / TI / briefing domain
apps/ops/         # REST API + Mastra agent and tools  ← start here
apps/web/         # Optional read-only /ops status page
```

## Quick start (ops API)

Requirements: Node.js 22+, pnpm 11.

```bash
pnpm install
cp .env.example .env
# Set TAWNY_*, KELPIE_*, BROLGA_* (as needed), OPENAI_API_KEY, MUSTER_OPS_TOKEN

pnpm dev:ops
# → http://localhost:3010
```

### REST

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `GET` | `/api/v1/briefing` | Combined “what’s on fire” payload |
| `GET` | `/api/v1/fleet` | Endpoint fleet health |
| `GET` | `/api/v1/cases/open` | Open / aging cases |
| `GET` | `/api/v1/brolga/stats` | TI store volume |
| `POST` | `/api/v1/ti/lookup` | Body `{ "kind", "value" }` → TI context |
| `POST` | `/api/v1/agent/generate` | Body `{ "message" }` → Mastra agent reply |
| `GET` | `/api/v1/tools` | Tool ids for bot wiring |

If `MUSTER_OPS_TOKEN` is set, send `Authorization: Bearer <token>` on `/api/v1/*`.

### Mastra tools

| Tool | Use |
|------|-----|
| `fleet_list` / `fleet_host` | Host healthy / stale / offline |
| `cases_open` | Open cases, aging, MTTR hint |
| `ti_lookup` | Observable TI via Brolga-compatible API |
| `brolga_stats` | TI store counts |
| `ops_briefing` | Single digest for Slack or cron |

Wire a Slack bot to `POST /api/v1/agent/generate`, or import tools from `apps/ops/src/mastra` into your own Mastra host. See [docs/operations/slack.md](./docs/operations/slack.md) and [Mastra docs](https://mastra.ai/docs).

## Docker

```bash
cp .env.example .env
# fill upstream URLs and tokens

docker compose up -d --build ops
curl -sS http://127.0.0.1:3010/health
```

Optional status UI:

```bash
docker compose --profile ui up -d --build
```

See [docs/operations/deployment.md](./docs/operations/deployment.md).

## Optional web UI

```bash
export MUSTER_OPS_URL=http://127.0.0.1:3010
pnpm dev:web
# open http://localhost:3000/ops
```

Read-only briefing only. Chat remains in Slack.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev:ops
```

## Security

- Prefer private networks (LAN, VPC, Tailscale) for the ops API.
- Require `MUSTER_OPS_TOKEN` outside local dev.
- Upstream tokens need only read scopes where possible.
- Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
