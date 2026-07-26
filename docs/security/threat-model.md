# Threat model

## Assets

Credentials and sessions; organisation membership and capabilities; alerts, messages, findings, decisions, cases and timelines; evidence objects and hashes; agent instructions and tool grants; connector credentials; audit-chain integrity; availability of triage and response workflows.

## Trust boundaries

- Browser ↔ web over authenticated HTTP/SSE
- Web/worker/gateway ↔ PostgreSQL, Redis, and object storage
- Muster ↔ Kelpie, Tawny, Bower, Sentinel, mail, and model runtimes
- Trusted policy/instructions ↔ untrusted telemetry, files, URLs, comments, and tool results
- Organisation A ↔ organisation B
- Human request ↔ approval-gated side effect

## Primary threats and controls

| Threat | Controls |
|---|---|
| Cross-tenant IDOR | organisation required in services/repositories, compound indexes, non-global lookup, negative tests |
| Session theft/CSRF | HttpOnly SameSite cookies, origin checks, CSP, bounded sessions, MFA/SSO policies |
| Stored XSS | TipTap schema validation, React escaping, CSP, no untrusted HTML rendering |
| Webhook forgery/replay | HMAC signature, issuer configuration, constant-time verification, event ID idempotency, timestamp window |
| Approval bypass | server-side action policy, required capability/count, expiry, distinct actors, execution binds approval target |
| Duplicate response | PostgreSQL idempotency record, stable external key, connector result reconciliation |
| Prompt injection | typed trust segments, untrusted evidence isolation, no raw telemetry in system policy, tool/argument/output validation |
| Agent privilege growth | immutable definition/version, fixed capability ceiling, approval-gated tool mutation, kill switch, audit |
| Evidence exfiltration | classification allowance, private bucket, presigned expiry, object keys scoped by organisation, export approval |
| Audit tampering | append-only repository, per-organisation sequence and hash chain, verification/export |
| Queue loss/duplication | transactional outbox, retry/backoff, identifier-only jobs, authoritative reload, idempotent processors |
| Connector compromise | scoped credentials, egress hooks, rate/range limits, delivery log, no general shell |

## Residual risks

Application-level tenant predicates are defence in depth, not PostgreSQL RLS. A future RLS layer should be evaluated after operational migration tooling is established. Agent-runtime sandbox strength depends on the selected adapter. Real deployments must supply network policy, secret management, malware scanning, encrypted backup, object-lock, and external audit export.

Review this model for every new public contract, tool, connector action, evidence renderer, authentication provider, or data classification.
