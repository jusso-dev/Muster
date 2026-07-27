# Docker deployment

The root `Dockerfile` builds web, worker, and agent-gateway artifacts. The root Compose file is the reference single-node local topology. Pin and scan the resulting image digest in production.

The homelab profile pulls the public GHCR image and keeps PostgreSQL, Redis,
MinIO, Mailpit, and synthetic product mocks on the internal Compose network:

```bash
./scripts/install-homelab.sh
```

The installer creates a mode-600 `.env.homelab`, generates independent
database, authentication, storage, and administrator secrets, pulls the public
image, starts the stack, waits for health, and creates the local administrator.
Only Muster's configured HTTP port is published. The example uses
`http://muster.example.lan:3004`; replace it with the exact trusted browser
origin. Use an HTTPS reverse proxy and set `AUTH_SECURE_COOKIES=true` when
exposing Muster beyond a trusted local network.
