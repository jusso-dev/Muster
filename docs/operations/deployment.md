# Production deployment

Docker Compose is the supported development and single-node evaluation topology. Production may use equivalent containers or Helm/Terraform modules after local security review.

Required services: PostgreSQL, Redis, private S3-compatible object storage, web replicas, worker replicas, agent gateway, SMTP, and configured product connectors. Terminate TLS at a trusted proxy. Keep PostgreSQL/object storage private; Redis must not be internet reachable.

Before go-live:

- replace every example secret and disable all mocks
- enforce SSO/MFA, approved domains, and least privilege
- configure malware scanning, object lock, lifecycle, legal hold, and egress policy
- set connector timeouts/rate limits and test idempotent retries
- centralise JSON logs, metrics, traces, and hash-chain audit exports
- test backup/restore and response kill switches

Scale web processes independently. SSE fan-out uses Redis pub/sub; durable events remain in PostgreSQL. Scale workers per queue policy and integration rate limit.

## Codex subscription authentication

The Codex credential is runtime state, not image content. Authenticate once:

```bash
docker compose --profile setup run --rm codex-login
```

Compose stores the resulting `auth.json` in the private `codex-state` volume.
Restrict Docker access, never publish or log this file, and revoke the Codex
session if the host is compromised. The gateway reports
`authentication_required` until the credential exists.
