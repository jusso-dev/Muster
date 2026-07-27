#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

env_file=".env.homelab"
compose_file="deploy/docker/docker-compose.homelab.yml"
requested_public_url="${MUSTER_PUBLIC_URL:-http://muster.example.lan:3004}"
requested_http_port="${MUSTER_HTTP_PORT:-3004}"
requested_version="${MUSTER_VERSION:-}"
requested_image="${MUSTER_IMAGE:-}"

read_env_value() {
  sed -n "s|^$1=||p" "$env_file" | tail -n 1
}

if [[ -n "$requested_version" && -n "$requested_image" ]]; then
  printf 'Set either MUSTER_VERSION or MUSTER_IMAGE, not both.\n' >&2
  exit 2
fi
if [[ ! -f "$env_file" && -z "$requested_version" && -z "$requested_image" ]]; then
  printf 'A reviewed immutable MUSTER_IMAGE digest or MUSTER_VERSION sha tag is required for a fresh install.\n' >&2
  exit 2
fi
if [[ -n "$requested_version" && ! "$requested_version" =~ ^sha-[0-9a-f]{7,40}$ ]]; then
  printf 'MUSTER_VERSION must be an immutable sha-<hex> tag.\n' >&2
  exit 2
fi
if [[ -n "$requested_image" && ! "$requested_image" =~ ^ghcr\.io/jusso-dev/muster@sha256:[0-9a-f]{64}$ ]]; then
  printf 'MUSTER_IMAGE must be the reviewed ghcr.io/jusso-dev/muster@sha256:<digest> reference.\n' >&2
  exit 2
fi

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$env_file" | tail -n 1
}

upsert_env() {
  local key="$1"
  local value="$2"
  local temporary_file="${env_file}.tmp"

  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    printf 'Refusing multiline value for %s.\n' "$key" >&2
    exit 2
  fi

  awk -v key="$key" -v value="$value" '
    index($0, key "=") == 1 { print key "=" value; seen = 1; next }
    { print }
    END { if (!seen) print key "=" value }
  ' "$env_file" > "$temporary_file"
  mv "$temporary_file" "$env_file"
}

credentials_created=false
if [[ ! -f "$env_file" ]]; then
  cp deploy/docker/.env.homelab.example "$env_file"
  postgres_password="$(openssl rand -hex 24)"
  auth_secret="$(openssl rand -hex 32)"
  storage_secret="$(openssl rand -hex 24)"
  connector_encryption_key="$(openssl rand -hex 32)"
  agent_gateway_token="$(openssl rand -hex 32)"
  admin_password="Muster!$(openssl rand -hex 12)"

  sed -i.bak \
    -e "s|MUSTER_PUBLIC_URL=.*|MUSTER_PUBLIC_URL=${requested_public_url}|" \
    -e "s|MUSTER_HTTP_PORT=.*|MUSTER_HTTP_PORT=${requested_http_port}|" \
    -e "s|MUSTER_VERSION=.*|MUSTER_VERSION=${requested_version}|" \
    -e "s|AUTH_TRUSTED_ORIGINS=.*|AUTH_TRUSTED_ORIGINS=${AUTH_TRUSTED_ORIGINS:-${requested_public_url},http://homelab:${requested_http_port}}|" \
    -e "s|generate-postgres-password|${postgres_password}|" \
    -e "s|generate-better-auth-secret|${auth_secret}|" \
    -e "s|generate-object-storage-secret|${storage_secret}|" \
    -e "s|generate-connector-encryption-key|${connector_encryption_key}|" \
    -e "s|generate-agent-gateway-token|${agent_gateway_token}|" \
    "$env_file"
  rm "$env_file.bak"
  {
    printf 'MUSTER_LOCAL_ADMIN_EMAIL=%s\n' \
      "${MUSTER_LOCAL_ADMIN_EMAIL:-admin@muster.local}"
    printf 'MUSTER_LOCAL_ADMIN_PASSWORD=%s\n' "$admin_password"
  } >> "$env_file"
  chmod 600 "$env_file"
  credentials_created=true
fi

if [[ -z "$(env_value MUSTER_LOCAL_ADMIN_EMAIL)" ]]; then
  upsert_env MUSTER_LOCAL_ADMIN_EMAIL "${MUSTER_LOCAL_ADMIN_EMAIL:-admin@muster.local}"
  credentials_created=true
fi
if [[ -z "$(env_value MUSTER_LOCAL_ADMIN_PASSWORD)" ]]; then
  upsert_env MUSTER_LOCAL_ADMIN_PASSWORD "Muster!$(openssl rand -hex 12)"
  credentials_created=true
fi

if ! grep -q '^MUSTER_AGENT_GATEWAY_TOKEN=' "$env_file"; then
  printf 'MUSTER_AGENT_GATEWAY_TOKEN=%s\n' "$(openssl rand -hex 32)" \
    >> "$env_file"
  chmod 600 "$env_file"
fi

# Persist an explicitly requested reviewed image reference before sourcing the env
# file. Otherwise the template's `latest` value would silently win.
if [[ -n "$requested_version" ]]; then
  sed -i.bak \
    -e "s|^MUSTER_VERSION=.*|MUSTER_VERSION=${requested_version}|" \
    -e '/^MUSTER_IMAGE=/d' \
    "$env_file"
  if ! grep -q '^MUSTER_VERSION=' "$env_file"; then
    printf 'MUSTER_VERSION=%s\n' "$requested_version" >> "$env_file"
  fi
  rm "$env_file.bak"
fi

if [[ -n "$requested_image" ]]; then
  sed -i.bak \
    -e "s|^MUSTER_IMAGE=.*|MUSTER_IMAGE=${requested_image}|" \
    -e '/^MUSTER_VERSION=/d' \
    "$env_file"
  if ! grep -q '^MUSTER_IMAGE=' "$env_file"; then
    printf 'MUSTER_IMAGE=%s\n' "$requested_image" >> "$env_file"
  fi
  rm "$env_file.bak"
fi

effective_version="$(read_env_value MUSTER_VERSION)"
effective_image="$(read_env_value MUSTER_IMAGE)"
if [[ -n "$effective_version" && -n "$effective_image" ]]; then
  printf 'The persisted homelab configuration contains conflicting image references.\n' >&2
  exit 2
fi
if [[ -n "$effective_version" ]]; then
  if [[ ! "$effective_version" =~ ^sha-[0-9a-f]{7,40}$ ]]; then
    printf 'The persisted MUSTER_VERSION is not an immutable sha-<hex> tag.\n' >&2
    exit 2
  fi
elif [[ -n "$effective_image" ]]; then
  if [[ ! "$effective_image" =~ ^ghcr\.io/jusso-dev/muster@sha256:[0-9a-f]{64}$ ]]; then
    printf 'The persisted MUSTER_IMAGE is not a reviewed GHCR digest.\n' >&2
    exit 2
  fi
else
  printf 'The persisted homelab configuration has no immutable image reference.\n' >&2
  exit 2
fi

MUSTER_HTTP_PORT="$(read_env_value MUSTER_HTTP_PORT)"
MUSTER_PUBLIC_URL="$(read_env_value MUSTER_PUBLIC_URL)"
MUSTER_LOCAL_ADMIN_EMAIL="$(read_env_value MUSTER_LOCAL_ADMIN_EMAIL)"
MUSTER_LOCAL_ADMIN_PASSWORD="$(read_env_value MUSTER_LOCAL_ADMIN_PASSWORD)"
if [[ -z "$MUSTER_LOCAL_ADMIN_EMAIL" || -z "$MUSTER_LOCAL_ADMIN_PASSWORD" ]]; then
  printf 'Homelab administrator credentials are missing from %s.\n' "$env_file" >&2
  exit 2
fi

for external_network in tawny_default kelpie_default; do
  if ! docker network inspect "$external_network" >/dev/null 2>&1; then
    docker network create "$external_network" >/dev/null
  fi
done

http_port="$MUSTER_HTTP_PORT"
admin_email="$MUSTER_LOCAL_ADMIN_EMAIL"
admin_password="$MUSTER_LOCAL_ADMIN_PASSWORD"

docker compose --env-file "$env_file" -f "$compose_file" pull
docker compose --env-file "$env_file" -f "$compose_file" up -d

wait_for_endpoint() {
  local endpoint="$1"
  local label="$2"
  local attempt

  for attempt in $(seq 1 60); do
    if curl --fail --silent "$endpoint" >/dev/null; then
      return 0
    fi
    if [[ "$attempt" == "60" ]]; then
      printf '%s failed after waiting for 180 seconds.\n' "$label" >&2
      docker compose --env-file "$env_file" -f "$compose_file" ps
      return 1
    fi
    sleep 3
  done
}

base_url="http://127.0.0.1:${http_port}"
wait_for_endpoint "${base_url}/api/v1/health" "Health check"
wait_for_endpoint "${base_url}/api/v1/ready" "Readiness check"

gateway_authentication="$(
  docker compose --env-file "$env_file" -f "$compose_file" exec -T agent-gateway \
    /nodejs/bin/node -e '
      fetch("http://127.0.0.1:3002/ready")
        .then((response) => response.json())
        .then((body) => process.stdout.write(body.authenticated === true ? "authenticated" : "authentication_required"))
        .catch(() => process.exit(1));
    ' 2>/dev/null || true
)"

signup_status="$(
  curl --silent \
    --output /dev/null \
    --write-out '%{http_code}' \
    -H "content-type: application/json" \
    -d "{\"name\":\"Muster Administrator\",\"email\":\"${admin_email}\",\"password\":\"${admin_password}\"}" \
    "${base_url}/api/auth/sign-up/email"
)"
if [[ "$signup_status" != "200" && "$signup_status" != "201" && "$signup_status" != "422" ]]; then
  printf 'Administrator creation failed with HTTP %s.\n' "$signup_status" >&2
  exit 1
fi

printf '%s\n' \
  "Muster is ready: ${MUSTER_PUBLIC_URL:-$requested_public_url}" \
  "Administrator: ${admin_email}" \
  "External products are local mocks and are labelled as such."
if [[ "$gateway_authentication" == "authenticated" ]]; then
  printf '%s\n' 'Codex authentication: verified.'
else
  printf '%s\n' \
    "Codex authentication: pending. Run docker compose --env-file .env.homelab -f ${compose_file} --profile setup run --rm codex-login."
fi
if [[ "$credentials_created" == "true" ]]; then
  printf 'New private homelab administrator password: %s\n' "$admin_password"
fi
