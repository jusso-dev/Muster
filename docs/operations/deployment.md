# Deployment

## Requirements

- Docker Compose **or** Node.js 22+ and pnpm 11  
- Network reachability to the upstream APIs you configure (endpoint, case, TI)  
- An LLM API key if you use `POST /api/v1/agent/generate` (Mastra model router)  

No PostgreSQL or Redis is required for the ops API path.

## Configuration

Copy [`.env.example`](../../.env.example) and set:

| Variable | Purpose |
|----------|---------|
| `TAWNY_BASE_URL` / `TAWNY_API_TOKEN` | Endpoint fleet API |
| `KELPIE_BASE_URL` / `KELPIE_API_TOKEN` | Case / IR API |
| `BROLGA_BASE_URL` / `BROLGA_API_TOKEN` | Threat-intel context API |
| `MUSTER_OPS_TOKEN` | Bearer token for `/api/v1/*` (recommended) |
| `OPENAI_API_KEY` (or other provider env) | Required for Mastra agent generate |
| `MUSTER_MASTRA_MODEL` | Model id, e.g. `openai/gpt-5-mini` |
| `MUSTER_FLEET_STALE_MINUTES` | Heartbeat staleness threshold (default 15) |
| `MUSTER_CASE_AGING_HOURS` | Open-case aging threshold (default 24) |

You may omit an upstream if you do not use that tool; the briefing will report it as unconfigured.

## Docker (API only)

```bash
cp .env.example .env
# edit secrets and upstream URLs

docker compose up -d --build ops
curl -sS http://127.0.0.1:3010/health
```

## Docker (API + status UI)

```bash
docker compose --profile ui up -d --build
# ops :3010, web :3000
```

Set `MUSTER_OPS_URL` for the web service (compose default is `http://ops:3010`).

## Local development

```bash
pnpm install
pnpm dev:ops          # API + Mastra
pnpm dev:web          # optional UI
```

## Network exposure

Prefer private networks (LAN, VPC, Tailscale, reverse proxy with auth). Do not expose the ops port to the public internet without TLS and a strong `MUSTER_OPS_TOKEN`.

## Health checks

```bash
curl -sS http://127.0.0.1:3010/health
curl -sS -H "Authorization: Bearer $MUSTER_OPS_TOKEN" \
  http://127.0.0.1:3010/api/v1/briefing
```
