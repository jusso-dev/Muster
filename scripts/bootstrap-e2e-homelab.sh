#!/usr/bin/env bash
# Homelab E2E status board + optional wiring helpers for
# Muster (control plane) + Kelpie + Hermes MCP + Slack agents.
#
# Usage (from Muster repo root on the host that runs Docker):
#   ./scripts/bootstrap-e2e-homelab.sh
#   ./scripts/bootstrap-e2e-homelab.sh --check-only
#   ./scripts/bootstrap-e2e-homelab.sh --wire-hermes-mcp
#   ./scripts/bootstrap-e2e-homelab.sh --print-slack-howto
#
# Does not print secrets. Tokens are written only to mode-600 files when wiring.
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."

env_file="${MUSTER_ENV_FILE:-.env.homelab}"
compose_file="${MUSTER_COMPOSE_FILE:-deploy/docker/docker-compose.homelab.yml}"
mcp_host_port="${MUSTER_MCP_PORT:-3013}"
muster_http_port="${MUSTER_HTTP_PORT:-3004}"
kelpie_health_url="${KELPIE_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
hermes_container="${HERMES_CONTAINER:-hermes}"

check_only=false
wire_hermes_mcp=false
print_slack_howto=false
for arg in "$@"; do
  case "$arg" in
    --check-only) check_only=true ;;
    --wire-hermes-mcp) wire_hermes_mcp=true ;;
    --print-slack-howto) print_slack_howto=true ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      printf 'Unknown flag: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

pass=0
warn=0
fail=0

green() { printf '\033[32m%s\033[0m' "$*"; }
yellow() { printf '\033[33m%s\033[0m' "$*"; }
red() { printf '\033[31m%s\033[0m' "$*"; }

ok() { pass=$((pass + 1)); printf '  [%s] %s\n' "$(green PASS)" "$*"; }
note() { warn=$((warn + 1)); printf '  [%s] %s\n' "$(yellow WARN)" "$*"; }
bad() { fail=$((fail + 1)); printf '  [%s] %s\n' "$(red FAIL)" "$*"; }
section() { printf '\n== %s ==\n' "$*"; }

env_value() {
  [[ -f "$env_file" ]] || return 0
  sed -n "s/^${1}=//p" "$env_file" | tail -n 1
}

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

container_running() {
  docker ps --format '{{.Names}}' | grep -Fxq "$1"
}

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || printf '000'
}

print_map() {
  cat <<'EOF'

Architecture (quick map)
------------------------
  Slack ──► Muster worker (Socket Mode) ──► Alfie / Jessie / Parker
              │                              └── agent-gateway (Codex)
              └── mcp-server 127.0.0.1:3013 ◄── Hermes MCP (bearer token)
                      └── Kelpie cases (governed connector)

  Kelpie = case SoR
  Muster = control plane (not daily chat UI)
  Hermes = your chat apps (e.g. BlueBubbles); optional Slack of its own

  Agents (Australian dog names, keen pack energy):
    Parker  Border Collie  default Slack agent  (exec / Kelpie briefs)
    Jessie  Border Collie  prefix "Jessie …"    (Tawny / UniFi hunts)
    Alfie   Bearded Collie prefix "Alfie …"     (research)
EOF
}

print_slack_howto_block() {
  cat <<'EOF'

Slack how-to
------------
  1. DM the Muster Slack bot (or post in a channel).
  2. Bare message → Parker (default).
  3. Name prefix routes agents:
       Jessie which Tawny hosts look unhealthy?
       Alfie summarise recent threat intel on …
       Parker what Kelpie cases are open?
  4. Your Slack user must be identity-mapped in Muster
     (otherwise inbox status = identity_unmapped).
  5. Worker metrics should show:
       muster_slack_socket_connections 1
       muster_slack_socket_envelope_failures 0
  6. Codex: agent-gateway /ready → authenticated: true
EOF
}

if [[ "$print_slack_howto" == true ]]; then
  print_map
  print_slack_howto_block
  exit 0
fi

printf 'Muster E2E homelab bootstrap\n'
printf 'env=%s compose=%s\n' "$env_file" "$compose_file"
print_map

# ── 0. Preconditions ─────────────────────────────────────────────────────────
section "0. Preconditions"
if ! command -v docker >/dev/null 2>&1; then
  bad "docker not on PATH"
  exit 1
fi
ok "docker available"

if [[ ! -f "$env_file" ]]; then
  bad "missing $env_file — run scripts/install-homelab.sh first"
  exit 1
fi
ok "env file present ($env_file)"

if [[ ! -f "$compose_file" ]]; then
  bad "missing $compose_file"
  exit 1
fi
ok "compose file present"

# ── 1. Containers ────────────────────────────────────────────────────────────
section "1. Muster containers"
for name in muster-web-1 muster-worker-1 muster-agent-gateway-1 muster-postgres-1 muster-redis-1; do
  if container_running "$name"; then
    ok "$name running"
  else
    bad "$name not running"
  fi
done

if container_running muster-mcp-server-1; then
  ok "muster-mcp-server-1 running"
else
  note "muster-mcp-server-1 not running — Hermes MCP path unavailable (compose service mcp-server)"
fi

# ── 2. Muster HTTP ───────────────────────────────────────────────────────────
section "2. Muster HTTP"
health_code="$(http_code "http://127.0.0.1:${muster_http_port}/api/v1/health")"
ready_code="$(http_code "http://127.0.0.1:${muster_http_port}/api/v1/ready")"
if [[ "$health_code" == "200" ]]; then ok "Muster /health HTTP $health_code"; else bad "Muster /health HTTP $health_code"; fi
if [[ "$ready_code" == "200" ]]; then ok "Muster /ready HTTP $ready_code"; else bad "Muster /ready HTTP $ready_code"; fi

# ── 3. Kelpie ────────────────────────────────────────────────────────────────
section "3. Kelpie"
kelpie_code="$(http_code "$kelpie_health_url")"
if [[ "$kelpie_code" == "200" ]]; then
  ok "Kelpie health $kelpie_health_url"
else
  note "Kelpie health not OK ($kelpie_code) at $kelpie_health_url — set KELPIE_HEALTH_URL if different"
fi

kelpie_base="$(env_value KELPIE_BASE_URL)"
kelpie_token="$(env_value KELPIE_API_TOKEN)"
if [[ -n "$kelpie_base" ]]; then
  ok "KELPIE_BASE_URL set ($kelpie_base)"
else
  bad "KELPIE_BASE_URL empty in $env_file"
fi
if [[ -n "$kelpie_token" ]]; then
  ok "KELPIE_API_TOKEN set (len=${#kelpie_token}, prefix=${kelpie_token:0:4}…)"
else
  bad "KELPIE_API_TOKEN empty — create klp_… in Kelpie Settings → API tokens"
fi

if [[ -n "$kelpie_token" ]]; then
  cases_code="$(
    curl -sS -o /tmp/kelpie-cases-bootstrap.json -w '%{http_code}' --max-time 8 \
      -H "Authorization: Bearer ${kelpie_token}" \
      -H "Accept: application/json" \
      "http://127.0.0.1:3000/api/v1/cases?limit=1" 2>/dev/null || printf '000'
  )"
  if [[ "$cases_code" == "200" ]]; then
    ok "Kelpie API token lists cases (HTTP 200)"
  else
    bad "Kelpie API token failed listing cases (HTTP $cases_code)"
  fi
fi

if docker network inspect kelpie_default >/dev/null 2>&1; then
  ok "docker network kelpie_default exists"
else
  note "kelpie_default network missing — start Kelpie compose project first"
fi

# ── 4. Kelpie connector in Muster DB ─────────────────────────────────────────
section "4. Muster Kelpie connector"
pg_pass="$(env_value POSTGRES_PASSWORD)"
if container_running muster-postgres-1 && [[ -n "$pg_pass" ]]; then
  connector_row="$(
    docker exec -e PGPASSWORD="$pg_pass" muster-postgres-1 \
      psql -U muster -d muster -t -A -c \
      "SELECT instance_id||'|'||status||'|'||coalesce(configuration->>'baseUrl','') FROM integration_records WHERE product='kelpie' AND archived_at IS NULL AND mock=false ORDER BY updated_at DESC LIMIT 1;" \
      2>/dev/null || true
  )"
  if [[ -n "$connector_row" ]]; then
    ok "live Kelpie connector: $connector_row"
  else
    note "no non-mock Kelpie connector row — restart web after setting KELPIE_* so bootstrap can register homelab-kelpie"
  fi
else
  note "skip connector DB check (postgres or password unavailable)"
fi

# ── 5. Agent gateway / Codex ─────────────────────────────────────────────────
section "5. Agent gateway (Codex)"
if container_running muster-agent-gateway-1; then
  gateway_json="$(
    docker exec muster-agent-gateway-1 /nodejs/bin/node -e \
      "fetch('http://127.0.0.1:3002/ready').then(r=>r.text()).then(t=>process.stdout.write(t)).catch(e=>{process.stdout.write(String(e)); process.exit(1)})" \
      2>/dev/null || true
  )"
  if printf '%s' "$gateway_json" | grep -q '"authenticated":true'; then
    ok "agent-gateway Codex authenticated"
  elif printf '%s' "$gateway_json" | grep -q authenticated; then
    bad "agent-gateway reachable but Codex not authenticated — run: docker compose --env-file $env_file -f $compose_file --profile setup run --rm codex-login"
  else
    bad "agent-gateway /ready failed: $gateway_json"
  fi
else
  bad "agent-gateway not running"
fi

# ── 6. Slack ─────────────────────────────────────────────────────────────────
section "6. Slack harness"
if container_running muster-postgres-1 && [[ -n "$pg_pass" ]]; then
  slack_install="$(
    docker exec -e PGPASSWORD="$pg_pass" muster-postgres-1 \
      psql -U muster -d muster -t -A -c \
      "SELECT team_name||'|'||status||'|bot='||coalesce(bot_user_id,'') FROM slack_installations WHERE status='active' LIMIT 1;" \
      2>/dev/null || true
  )"
  if [[ -n "$slack_install" ]]; then
    ok "Slack install active: $slack_install"
  else
    note "no active Slack installation — OAuth install required for Muster bot"
  fi

  exposures="$(
    docker exec -e PGPASSWORD="$pg_pass" muster-postgres-1 \
      psql -U muster -d muster -t -A -c \
      "SELECT a.name||'(default='||e.is_default||',dm='||e.allow_direct_messages||')' FROM slack_agent_exposures e JOIN agent_definitions a ON a.id=e.agent_id WHERE e.enabled ORDER BY a.name;" \
      2>/dev/null || true
  )"
  if [[ -n "$exposures" ]]; then
    ok "agent exposures: $(printf '%s' "$exposures" | tr '\n' ' ')"
  else
    note "no enabled slack_agent_exposures"
  fi

  mapped="$(
    docker exec -e PGPASSWORD="$pg_pass" muster-postgres-1 \
      psql -U muster -d muster -t -A -c \
      "SELECT count(*) FROM slack_identity_mappings WHERE status='active';" \
      2>/dev/null || printf '0'
  )"
  if [[ "${mapped:-0}" -gt 0 ]]; then
    ok "Slack identity mappings: $mapped active"
  else
    bad "no Slack identity mappings — your user will get identity_unmapped"
  fi
fi

socket_enabled="$(env_value SLACK_SOCKET_MODE_ENABLED)"
if [[ "$socket_enabled" == "true" ]]; then
  ok "SLACK_SOCKET_MODE_ENABLED=true"
else
  note "SLACK_SOCKET_MODE_ENABLED is not true"
fi

if container_running muster-worker-1; then
  metrics="$(
    docker exec muster-web-1 /nodejs/bin/node -e \
      "fetch('http://worker:3001/metrics').then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))" \
      2>/dev/null || true
  )"
  if [[ -n "$metrics" ]]; then
    conns="$(printf '%s\n' "$metrics" | sed -n 's/^muster_slack_socket_connections //p' | head -1)"
    fails="$(printf '%s\n' "$metrics" | sed -n 's/^muster_slack_socket_envelope_failures //p' | head -1)"
    recon="$(printf '%s\n' "$metrics" | sed -n 's/^muster_slack_socket_reconnects //p' | head -1)"
    if [[ "${conns:-0}" -ge 1 ]]; then
      ok "Socket Mode connections=${conns:-?} reconnects=${recon:-?} envelope_failures=${fails:-?}"
    else
      bad "Socket Mode connections=${conns:-0} (want >=1)"
    fi
    if [[ "${fails:-0}" -gt 0 ]]; then
      note "envelope_failures=${fails} — control-frame bugs or bad payloads"
    fi
  else
    note "could not scrape worker Slack metrics"
  fi
fi

# ── 7. MCP ───────────────────────────────────────────────────────────────────
section "7. MCP server (Hermes path)"
mcp_health="$(http_code "http://127.0.0.1:${mcp_host_port}/health")"
if [[ "$mcp_health" == "200" ]]; then
  ok "MCP /health on 127.0.0.1:${mcp_host_port}"
else
  note "MCP /health HTTP $mcp_health on 127.0.0.1:${mcp_host_port}"
fi

if container_running muster-postgres-1 && [[ -n "$pg_pass" ]]; then
  mcp_installs="$(
    docker exec -e PGPASSWORD="$pg_pass" muster-postgres-1 \
      psql -U muster -d muster -t -A -c \
      "SELECT name||'|'||status||'|'||token_prefix FROM mcp_installations WHERE status='active' AND revoked_at IS NULL;" \
      2>/dev/null || true
  )"
  if [[ -n "$mcp_installs" ]]; then
    ok "active MCP installations: $(printf '%s' "$mcp_installs" | tr '\n' ' ')"
  else
    note "no active MCP installations — Hermes cannot call Muster tools yet"
  fi
fi

# ── 8. Hermes ────────────────────────────────────────────────────────────────
section "8. Hermes"
if container_running "$hermes_container"; then
  ok "container $hermes_container running"
  if docker exec "$hermes_container" hermes mcp list 2>/dev/null | grep -qi muster; then
    ok "Hermes mcp list includes muster"
  else
    note "Hermes has no muster MCP server — run with --wire-hermes-mcp or configure manually"
  fi
else
  note "Hermes container '$hermes_container' not running (optional for Slack-only path)"
fi

# ── Wire Hermes MCP ──────────────────────────────────────────────────────────
if [[ "$wire_hermes_mcp" == true ]]; then
  section "Wire Hermes MCP"
  if [[ "$check_only" == true ]]; then
    bad "--wire-hermes-mcp incompatible with --check-only"
    exit 2
  fi
  if ! container_running muster-web-1; then
    bad "muster-web-1 required to create installation"
    exit 1
  fi
  email="$(env_value MUSTER_LOCAL_ADMIN_EMAIL)"
  password="$(env_value MUSTER_LOCAL_ADMIN_PASSWORD)"
  if [[ -z "$email" || -z "$password" ]]; then
    bad "MUSTER_LOCAL_ADMIN_EMAIL/PASSWORD required in $env_file"
    exit 1
  fi
  cookie_jar="$(mktemp)"
  trap 'rm -f "$cookie_jar"' RETURN
  base="http://127.0.0.1:${muster_http_port}"
  origin="$(env_value MUSTER_PUBLIC_URL)"
  origin="${origin:-$base}"
  curl -sS -c "$cookie_jar" -b "$cookie_jar" -X POST "$base/api/auth/sign-in/email" \
    -H 'Content-Type: application/json' \
    -H "Origin: $origin" \
    -d "{\"email\":$(printf '%s' "$email" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"password\":$(printf '%s' "$password" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}" \
    >/dev/null

  # Prefer admin actor id if known; else first human with administration.manage
  bound_actor="$(
    docker exec -e PGPASSWORD="$pg_pass" muster-postgres-1 \
      psql -U muster -d muster -t -A -c \
      "SELECT id FROM actors WHERE identity_reference=$(printf '%s' "$email" | python3 -c 'import json,sys; print(chr(39)+sys.stdin.read().replace(chr(39),chr(39)+chr(39))+chr(39))') AND actor_type='human' LIMIT 1;" \
      2>/dev/null | tr -d '[:space:]'
  )"
  if [[ -z "$bound_actor" ]]; then
    bad "could not resolve human actor for $email"
    exit 1
  fi

  scopes_json='["muster_get_status","muster_list_capabilities","muster_search_kelpie_cases","muster_get_kelpie_case","muster_search_knowledge","muster_get_knowledge","muster_list_invocations","muster_list_missions","muster_get_mission_run","muster_propose_kelpie_action","muster_get_action_status"]'
  create_body="$(python3 - <<PY
import json
print(json.dumps({
  "name": "Hermes homelab",
  "boundActorId": "$bound_actor",
  "scopes": json.loads('''$scopes_json'''),
}))
PY
)"
  create_resp="$(
    curl -sS -b "$cookie_jar" -H 'Content-Type: application/json' -H "Origin: $origin" \
      -X POST "$base/api/v1/mcp-installations" \
      -d "$create_body"
  )"
  token="$(printf '%s' "$create_resp" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("data") or {}; print(d.get("token") or "")')"
  install_id="$(printf '%s' "$create_resp" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("data") or {}; print(d.get("id") or "")')"
  if [[ -z "$token" ]]; then
    bad "installation create failed: $(printf '%s' "$create_resp" | head -c 300)"
    exit 1
  fi
  token_path=".hermes-muster-mcp.token"
  printf '%s\n' "$token" > "$token_path"
  chmod 600 "$token_path"
  ok "created MCP installation $install_id — token in $token_path (mode 600)"

  if container_running "$hermes_container"; then
    docker cp "$token_path" "${hermes_container}:/tmp/muster-mcp.token"
    docker exec -u 0 "$hermes_container" chown hermes:hermes /tmp/muster-mcp.token 2>/dev/null || true
    docker exec "$hermes_container" /opt/hermes/.venv/bin/python - <<'PY' || note "Hermes config write failed — set mcp_servers.muster manually"
from pathlib import Path
import re
config_path = Path("/opt/data/config.yaml")
env_path = Path("/opt/data/.env")
token = Path("/tmp/muster-mcp.token").read_text().strip()
text = config_path.read_text() if config_path.exists() else ""
text = re.sub(r"(?ms)^mcp_servers:\n(?:^[ \t].*\n)*", "", text)
block = """
mcp_servers:
  muster:
    url: "http://127.0.0.1:3013/mcp"
    headers:
      Authorization: "Bearer ${MCP_MUSTER_API_KEY}"
    timeout: 180
    connect_timeout: 60
"""
config_path.write_text(text.rstrip() + "\n\n" + block.lstrip("\n"))
lines = [ln for ln in (env_path.read_text().splitlines() if env_path.exists() else []) if not ln.startswith("MCP_MUSTER_API_KEY=")]
lines.append(f"MCP_MUSTER_API_KEY={token}")
env_path.write_text("\n".join(lines) + "\n")
env_path.chmod(0o600)
print("hermes_config_ok")
PY
    docker restart "$hermes_container" >/dev/null
    sleep 8
    if docker exec "$hermes_container" hermes mcp test muster 2>&1 | grep -qi 'Tools discovered'; then
      ok "Hermes mcp test muster succeeded"
    else
      note "Hermes restarted; run: docker exec $hermes_container hermes mcp test muster"
    fi
  else
    note "Hermes container not running — token saved; configure Hermes when up"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
section "Summary"
printf '  pass=%s warn=%s fail=%s\n' "$pass" "$warn" "$fail"
print_slack_howto_block
cat <<EOF

Next steps
----------
  Full write-up: docs/operations/e2e-homelab-bootstrap.md
  Recheck:       ./scripts/bootstrap-e2e-homelab.sh --check-only
  Wire Hermes:   ./scripts/bootstrap-e2e-homelab.sh --wire-hermes-mcp
  Slack howto:   ./scripts/bootstrap-e2e-homelab.sh --print-slack-howto

EOF

if [[ "$fail" -gt 0 ]]; then
  exit 1
fi
exit 0
