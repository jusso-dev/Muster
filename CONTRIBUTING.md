# Contributing

## Product

Muster is an **ops brain** (HTTP API + Mastra tools). Chat lives in Slack or another bot host.  
See [PRODUCT.md](./PRODUCT.md) and [AGENTS.md](./AGENTS.md).

## Local setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev:ops
```

Optional status UI:

```bash
export MUSTER_OPS_URL=http://127.0.0.1:3010
pnpm dev:web
```

## Layout

| Path | Role |
|------|------|
| `packages/ops` | Upstream clients and domain logic |
| `apps/ops` | REST + Mastra agent/tools |
| `apps/web` | Optional `/ops` status page |

Do not reintroduce rooms, DMs, or in-app agent chat as product features.

## Pull requests

- Keep changes focused.  
- Add or update tests for domain logic when behaviour changes.  
- Update public docs when APIs or env vars change.  
- Do not commit secrets or production data.  

## Code of conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
