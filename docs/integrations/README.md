# Integrations

Connector clients use stable HTTP APIs, scoped credentials, timeouts, retries, delivery records, idempotency keys, and signed MSEP webhooks. Webhooks are preferred; polling cursors provide recovery.

- [Current Kelpie, Tawny, and Bower contracts](current-upstream-contracts.md)
- [Connecting Hermes to the remote Muster MCP endpoint](hermes-mcp.md)
- [Kelpie certification matrix (mock vs live)](kelpie-certification.md)
- **Kelpie:** case read/create/update, observables, evidence references, tasks, playbooks, and timeline. Kelpie remains authoritative.
- **Tawny:** endpoint inventory, alerts, telemetry search, hunts, agent health, and approval-gated bounded response. Tawny remains authoritative for endpoint state.
- **Bower:** collector/source coverage, queue pressure, policy decisions, delivery failures, canary evidence, and approval-gated policy publication. Bower remains authoritative for collection and delivery evidence.
- **Microsoft Sentinel:** Entra client credentials, workspace selection, incident polling, Log Analytics queries, templates, entity lookup, rule read, rate limiting, and query audit. No destructive Sentinel action is enabled.

Set `MUSTER_MOCK_INTEGRATIONS=false` and supply real connector URLs and secret references in production. Health status always states `Mock` or `Production`.
