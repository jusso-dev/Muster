# Upgrade

## Container

```bash
docker compose pull   # if using published images
docker compose up -d --build ops
curl -sS http://127.0.0.1:3010/health
```

## From source

```bash
git pull
pnpm install
pnpm typecheck
pnpm test
pnpm dev:ops   # or rebuild/restart your process manager
```

## Breaking changes

- Watch release notes for env renames and REST path changes.  
- Upstream API shape changes may require connector updates in `packages/ops`.  
- Mastra and model ids change over time; verify `MUSTER_MASTRA_MODEL` against current Mastra docs.  

## Rollback

Redeploy the previous image tag or git revision and restore the previous env file. Because ops is stateless, rollback does not require database migration reverse steps.
