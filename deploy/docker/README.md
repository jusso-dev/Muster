# Docker

## Ops API

```bash
cp ../../.env.example ../../.env
# edit upstream URLs and tokens

cd ../..
docker compose up -d --build ops
curl -sS http://127.0.0.1:3010/health
```

## With optional status UI

```bash
docker compose --profile ui up -d --build
```

The CI pipeline publishes the `ops` image target to GHCR on pushes to `main`.
