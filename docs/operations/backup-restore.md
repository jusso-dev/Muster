# Backup and restore

The ops API is **stateless** with respect to fleet, case, and TI data. Authoritative data lives in the upstream systems you configure.

## What to back up

| Item | Notes |
|------|--------|
| Deployment config / secrets | `.env` or secret manager entries (`MUSTER_OPS_TOKEN`, upstream tokens, model keys) |
| Compose / reverse-proxy config | Host networking, TLS, tunnels |
| Optional UI static config | `MUSTER_OPS_URL` for the web service |

There is no application database volume on the default ops path.

## Restore

1. Redeploy `apps/ops` (or the published image).  
2. Restore environment variables.  
3. Confirm upstream APIs are reachable.  
4. `GET /health` and `GET /api/v1/briefing` with a valid bearer token.  

## Upstream backups

Back up endpoint, case, and TI platforms according to their own runbooks. Muster does not replace those backups.
