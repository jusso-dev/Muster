# Operational runbook: Hermes + remote Muster MCP

For the full homelab path (Kelpie connector + Slack agents + Hermes MCP), use
[e2e-homelab-bootstrap.md](e2e-homelab-bootstrap.md) and
`./scripts/bootstrap-e2e-homelab.sh`.

## Package layout

| Component | Path | Role |
| --- | --- | --- |
| MCP domain | `packages/mcp` | Auth, tools, audit, Kelpie gateway, knowledge, missions |
| MCP HTTP app | `apps/mcp-server` | Streamable HTTP + `/health` |
| Skills | `skills/` | Hermes skill packs + `policy-bundle.json` |
| Connectors | `packages/integrations` | Governed Kelpie (and other) connector path |
| Worker | `apps/worker` | Executes queued connector queries/actions |

## Local stack (operator)

```bash
# Migrate + bootstrap synthetic org (never use production secrets in docs)
pnpm db:migrate
pnpm db:bootstrap

# Start MCP server (requires DATABASE_URL, CONNECTOR_ENCRYPTION_KEY)
pnpm --filter @muster/mcp-server dev

# Health (no auth)
curl -sS http://127.0.0.1:<port>/health
```

## Provision installation credential

```bash
pnpm --filter @muster/mcp create-installation \
  --org=<organisationId> \
  --actor=<boundActorId> \
  --installed-by=<administratorActorId> \
  --name="Hermes production"
```

Store the printed token in Hermes secret storage only. Revoke:

```bash
pnpm --filter @muster/mcp revoke-installation \
  --org=<organisationId> \
  --installation=<installationId> \
  --actor=<revokingActorId>
```

Admin API (session + `administration.manage`):

- `GET /api/v1/mcp-installations`
- `POST /api/v1/mcp-installations` body `{ name, boundActorId, scopes? }`
- `POST /api/v1/mcp-installations/{id}/revoke`

## Hermes remote MCP configuration

See [docs/integrations/hermes-mcp.md](../integrations/hermes-mcp.md). Placeholder only:

```json
{
  "mcpServers": {
    "muster": {
      "url": "https://<muster-host>/mcp",
      "transport": "streamable-http",
      "headers": {
        "authorization": "Bearer <installation-token-placeholder>"
      }
    }
  }
}
```

Validate skills before packaging Hermes profiles:

```bash
pnpm skills:validate
pnpm kelpie:certify-mock
```

## Kill switches

- Per-agent kill switches remain on `agent_definitions.killSwitch`.
- Mission kill switch: `muster_upsert_mission` with `killSwitch: true` blocks new `muster_accept_mission_run` immediately.
- Revoking an MCP installation fails closed on the next request.

## Incident notes

- Audit export: `muster_export_audit` (requires `audit.export` + scope).
- Never paste installation tokens into tickets or skills.
- Report mock vs live Kelpie results using [kelpie-certification.md](../integrations/kelpie-certification.md).
