# Kelpie integration certification matrix

Tracker #78 item 4 requires real Kelpie integration to be certified
**separately** from mock contract success. This document is the authoritative
report surface for that split.

## Status legend

| Status | Meaning |
| --- | --- |
| `mock` | Local Kelpie mock (`integrations/kelpie/mock.mjs`) or fixture-backed test |
| `local` | Live Muster stack talking to a local/non-prod Kelpie with synthetic data |
| `deployed` | Deployed Muster environment with a real connector config |
| `live-verified` | Human-confirmed against a production-like Kelpie release/commit |
| `not-run` | Not executed in this certification pass |

Never promote a `mock` result to `live-verified`.

## Certification matrix (2026-07-28)

| Capability | Path | Mock | Local | Deployed | Live-verified | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `kelpie.cases.list` query template | governed connector → worker | mock | not-run | not-run | not-run | Covered by `@muster/mcp` integration suite when `MUSTER_INTEGRATION_TESTS=true` |
| `kelpie.case.get` query template | governed connector → worker | mock | not-run | not-run | not-run | Same suite; `source_unavailable` maps to MCP `not_found` |
| MCP `muster_search_kelpie_cases` | MCP → queue → worker → mock | mock | not-run | not-run | not-run | Bounds, redaction, injection canaries in integration tests |
| MCP `muster_get_kelpie_case` | MCP → queue → worker → mock | mock | not-run | not-run | not-run | Same |
| MCP `muster_propose_kelpie_action` | MCP → delivery + approval | mock | not-run | not-run | not-run | Approval-gated; does not execute until human approve |
| Case create/update/comment/observable delivery | worker action path | mock | not-run | not-run | not-run | Uses shared `IntegrationActionRequestSchema` |
| Cross-tenant isolation | installation credential | mock | not-run | not-run | not-run | Org FK + resolveInstallation fail-closed |
| Secret redaction / injection resistance | tool boundary | mock | not-run | not-run | not-run | Canaries in MCP integration suite |

## Upstream pin

Contract reference:

- [current-upstream-contracts.md](current-upstream-contracts.md)
- Kelpie commit pin recorded there (update when re-certifying live)

## How to re-run mock certification

```bash
# Requires DATABASE_URL + CONNECTOR_ENCRYPTION_KEY against a migrated DB.
export MUSTER_INTEGRATION_TESTS=true
pnpm --filter @muster/mcp test
```

Optional helper (prints a machine-readable summary; does not claim live status):

```bash
pnpm kelpie:certify-mock
```

## How to certify local / live Kelpie

1. Point an organisation's Kelpie connector at the target Kelpie base URL with a
   real `klp_…` token (never commit the token).
2. Run governed list/get through either the web connector path or MCP with a
   read-scoped installation credential.
3. Record in this file:
   - Kelpie base URL host (not the token)
   - Kelpie release/commit if known
   - Muster commit SHA
   - Operator name and date
   - Result per row as `local` / `deployed` / `live-verified`
4. Keep `mock` rows unchanged unless the mock suite itself regressed.

## Hard rules

- Mock success is not live success.
- Live certification must use synthetic or operator-owned cases only.
- Connector credentials never enter Hermes prompts, skills, memory, or MCP tool
  output.
- Failures must be reported with their environment label (`mock` vs `live`).
