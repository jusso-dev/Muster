# Homelab E2E bootstrap (Muster + Kelpie + Hermes + Slack)

This is the end-to-end map that is easy to miss. Muster is the **control plane**,
not the chat UI. The web app is a **health / wiring dashboard** (agents connected?,
Slack/Codex/Kelpie/MCP ok?). You talk to agents in **Slack** (Muster bot) or **Hermes**
(BlueBubbles / other Hermes platforms). Kelpie stays the **case system of record**.

See [ADR 0006](../architecture/0006-ops-control-plane-ui.md).

## Architecture (what talks to what)

```text
You ──Slack──► Muster Slack harness ──► Alfie / Jessie / Parker
                    │                      (Codex subscription via agent-gateway)
                    ├── worker (Socket Mode, deliveries)
                    ├── agent-gateway (Codex)
                    └── mcp-server :3013 (loopback)

You ──Hermes chat──► Hermes gateway ──MCP──► muster-mcp-server ──► Kelpie API
                     (BlueBubbles etc.)         bearer installation token

Muster connectors ──worker──► Kelpie / Tawny / UniFi (governed queries)
```

| Surface | Owner | Purpose |
| --- | --- | --- |
| Slack bot | **Muster** | Chat to Parker / Jessie / Alfie |
| Hermes gateway | **Hermes** | Your existing chat apps + Muster MCP tools |
| Kelpie UI / API | **Kelpie** | Cases, tokens, SoR |
| Muster web UI | **Muster** | Control-plane **health dashboard** + Slack/connectors/approvals — not chat |

When the bot is **invited to a channel**, subscribe to `member_joined_channel`
and Muster posts one pack intro (Parker / Jessie / Alfie, how to address them).
Same join event is never double-posted (inbox event idempotency).

## Dog pack agents

| Agent | Breed vibe | Default use | Tools (actor caps) |
| --- | --- | --- | --- |
| **Parker** | Border Collie — focused ops lead | Default Slack agent | alerts, investigations, Kelpie cases, audit |
| **Jessie** | Border Collie — hunter | Prefix `Jessie …` | Tawny, UniFi, Kelpie, sentinel hunts |
| **Alfie** | Bearded Collie — researcher | Prefix `Alfie …` | alerts, Kelpie, research feeds, sentinel rules |

Slack routing:

- bare message → **Parker** (default)
- natural address forms all work:
  - `Jessie list open cases`
  - `Hey Jessie you there`
  - `use Alfie …` / `talk to Jessie` / `chat with Alfie` / `/muster Parker …`
- DMs work when `allow_direct_messages=true`
- Your Slack user must be **identity-mapped** or events die as `identity_unmapped`

## One-command health + checklist

From the Muster repo on the homelab host (or any host with Docker + `.env.homelab`):

```bash
./scripts/bootstrap-e2e-homelab.sh
# or
./scripts/bootstrap-e2e-homelab.sh --check-only
```

The script prints a status board (pass / warn / fail) for:

1. Compose stack (web, worker, agent-gateway, mcp-server)
2. Kelpie reachability + API token
3. Kelpie connector `homelab-kelpie`
4. Slack installation, exposures, Socket Mode metrics
5. Agent-gateway Codex authentication
6. MCP installation + loopback `/health`
7. Hermes MCP server `muster` (if Hermes container present)

Optional apply steps (explicit flags only):

```bash
# Create / refresh Hermes MCP installation + write Hermes config (interactive secrets)
./scripts/bootstrap-e2e-homelab.sh --wire-hermes-mcp

# Print Slack how-to only
./scripts/bootstrap-e2e-homelab.sh --print-slack-howto
```

## Manual first-time path (if you prefer steps)

### A. Kelpie

1. Deploy Kelpie (`apps/Kelpie-deploy` or root compose) so project network is `kelpie_default`.
2. Create an API token under **Settings → API tokens** with at least  
   `cases:read`, `cases:write`, `observables:read|write`, `comments:read|write`.
3. Put token + base URL into Muster:

```dotenv
KELPIE_BASE_URL=http://kelpie-app-1:3000
KELPIE_API_TOKEN=klp_…
```

4. Muster worker/agent-gateway/mcp-server must join `kelpie_default` (homelab compose already does).
5. Restart Muster so bootstrap registers connector **Kelpie homelab** (`instanceId=homelab-kelpie`).

### B. Muster stack

```bash
# Preferred: reviewed GHCR digest
MUSTER_IMAGE=ghcr.io/jusso-dev/muster@sha256:… ./scripts/install-homelab.sh

# Local build (homelab engineering):
# docker build -t muster:homelab-e2e -f Dockerfile .
# set MUSTER_IMAGE=muster:homelab-e2e and pull_policy=if_not_present
docker compose --env-file .env.homelab -f deploy/docker/docker-compose.homelab.yml up -d
```

Services that matter for E2E:

| Service | Port (host) | Role |
| --- | --- | --- |
| `web` | `3004` | Admin API / UI |
| `worker` | internal | Slack Socket Mode + jobs |
| `agent-gateway` | internal | Codex runtime |
| `mcp-server` | `127.0.0.1:3013` | Hermes Streamable HTTP MCP |

Codex: one-time `docker compose … --profile setup run --rm codex-login` until  
`GET agent-gateway /ready` shows `authenticated: true`.

### C. Slack (Muster bot)

1. Slack app with Socket Mode + bot scopes (see `docs/integrations/agent-harness.md`).
   Subscribe to `member_joined_channel` for the one-shot pack intro when the bot
   is invited into a channel.
2. Env: `SLACK_SOCKET_MODE_ENABLED=true`, `SLACK_APP_TOKEN=xapp-…`, signing secret, OAuth install.
3. Confirm:

```bash
# worker metrics (from inside muster network)
# muster_slack_socket_connections 1
# envelope_failures 0
```

4. Map your Slack user → Muster actor (admin once). Without this: `identity_unmapped`.
5. Expose Alfie / Jessie / Parker (`slack_agent_exposures`): DMs on; empty channel list = all channels.

**Chat:** DM the bot or message in a channel. Prefix agent name when not Parker.

### D. Hermes → Muster MCP → Kelpie

1. MCP server healthy: `curl -fsS http://127.0.0.1:3013/health`
2. Create installation (admin session or script `--wire-hermes-mcp`):

```bash
# scopes: read tools + optional propose_kelpie_action / get_action_status
POST /api/v1/mcp-installations
```

3. Hermes `config.yaml`:

```yaml
mcp_servers:
  muster:
    url: "http://127.0.0.1:3013/mcp"
    headers:
      Authorization: "Bearer ${MCP_MUSTER_API_KEY}"
    timeout: 180
    connect_timeout: 60
```

4. Hermes `.env`: `MCP_MUSTER_API_KEY=muster_mcp_…`
5. Restart Hermes; `hermes mcp test muster` should list tools including `muster_search_kelpie_cases`.

Hermes **Slack** is separate (not required). Homelab Hermes today is often **BlueBubbles** only.

## Smoke tests

```bash
./scripts/bootstrap-e2e-homelab.sh --check-only

# Kelpie via Muster connector (admin session) — or use script checks
# Slack: DM "hello" then "Jessie list open Kelpie cases"
# Hermes: ask agent to search Kelpie cases via MCP
```

## Common failures

| Symptom | Cause |
| --- | --- |
| Slack silent / `identity_unmapped` | Slack user not mapped to Muster actor |
| `No typed result was produced` | Old Slack renderer; rebuild/hotpatch agent-harness |
| Hello blames Tawny/UniFi revoked | Old live-context fan-out; upgrade agent-gateway |
| MCP 401 | Bad/missing installation token in Hermes |
| MCP connection refused | mcp-server down or wrong host port (use `3013`, not `3003` if collie owns 3003) |
| Connector never appears | Missing `KELPIE_API_TOKEN` or `CONNECTOR_ENCRYPTION_KEY` |
| Codex not authenticated | Run `codex-login` profile |
| Wrong agent | No name prefix → Parker default |

## Related docs

- [release-homelab.md](release-homelab.md) — image install / rollback  
- [hermes-mcp-runbook.md](hermes-mcp-runbook.md) — MCP install/revoke  
- [docs/integrations/agent-harness.md](../integrations/agent-harness.md) — Slack harness  
- [docs/integrations/kelpie-certification.md](../integrations/kelpie-certification.md) — live vs mock  
