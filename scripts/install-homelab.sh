#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."

env_file=".env.homelab"
compose_file="deploy/docker/docker-compose.homelab.yml"
default_public_url="http://muster.example.lan:3004"
default_http_port="3004"
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

environment_created=false
admin_password_created=false
if [[ ! -f "$env_file" ]]; then
  cp deploy/docker/.env.homelab.example "$env_file"
  environment_created=true
  upsert_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  upsert_env BETTER_AUTH_SECRET "$(openssl rand -hex 32)"
  upsert_env OBJECT_STORAGE_SECRET_KEY "$(openssl rand -hex 24)"
  upsert_env CONNECTOR_ENCRYPTION_KEY "$(openssl rand -hex 32)"
  upsert_env MUSTER_LOCAL_ADMIN_EMAIL "${MUSTER_LOCAL_ADMIN_EMAIL:-admin@muster.local}"
  upsert_env MUSTER_LOCAL_ADMIN_PASSWORD "Muster!$(openssl rand -hex 12)"
  admin_password_created=true
fi

if [[ -z "$(env_value MUSTER_LOCAL_ADMIN_EMAIL)" ]]; then
  upsert_env MUSTER_LOCAL_ADMIN_EMAIL "${MUSTER_LOCAL_ADMIN_EMAIL:-admin@muster.local}"
fi
if [[ -z "$(env_value MUSTER_LOCAL_ADMIN_PASSWORD)" ]]; then
  upsert_env MUSTER_LOCAL_ADMIN_PASSWORD "Muster!$(openssl rand -hex 12)"
  admin_password_created=true
fi

existing_public_url="$(env_value MUSTER_PUBLIC_URL)"
existing_http_port="$(env_value MUSTER_HTTP_PORT)"
existing_origins="$(env_value AUTH_TRUSTED_ORIGINS)"

if [[ "${MUSTER_PUBLIC_URL+x}" == "x" ]]; then
  requested_public_url="$MUSTER_PUBLIC_URL"
elif [[ "$environment_created" == "false" && -n "$existing_public_url" ]]; then
  requested_public_url="$existing_public_url"
else
  requested_public_url="$default_public_url"
fi

if [[ "${MUSTER_HTTP_PORT+x}" == "x" ]]; then
  requested_http_port="$MUSTER_HTTP_PORT"
elif [[ "$environment_created" == "false" && -n "$existing_http_port" ]]; then
  requested_http_port="$existing_http_port"
else
  requested_http_port="$default_http_port"
fi

if [[ "${AUTH_TRUSTED_ORIGINS+x}" == "x" ]]; then
  requested_origins="$AUTH_TRUSTED_ORIGINS"
elif [[ "$environment_created" == "false" && -n "$existing_origins" ]]; then
  requested_origins="$existing_origins"
else
  requested_origins="${requested_public_url},http://homelab:${requested_http_port}"
fi
upsert_env MUSTER_PUBLIC_URL "$requested_public_url"
upsert_env MUSTER_HTTP_PORT "$requested_http_port"
upsert_env AUTH_TRUSTED_ORIGINS "$requested_origins"

if ! grep -q '^MUSTER_AGENT_GATEWAY_TOKEN=' "$env_file"; then
  printf 'MUSTER_AGENT_GATEWAY_TOKEN=%s\n' "$(openssl rand -hex 32)" \
    >> "$env_file"
  chmod 600 "$env_file"
fi
if ! grep -q '^SLACK_OAUTH_STATE_SECRET=' "$env_file"; then
  printf 'SLACK_OAUTH_STATE_SECRET=%s\n' "$(openssl rand -hex 32)" \
    >> "$env_file"
  chmod 600 "$env_file"
fi

# Persist an explicitly requested reviewed image reference before reading the
# environment file so a prior installation cannot silently override it.
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
  "External products use configured governed connectors."
if [[ "$gateway_authentication" == "authenticated" ]]; then
  printf '%s\n' 'Codex authentication: verified.'
else
  printf '%s\n' \
    "Codex authentication: pending. Run docker compose --env-file .env.homelab -f ${compose_file} --profile setup run --rm codex-login."
fi
if [[ "$admin_password_created" == "true" ]]; then
  printf 'New private homelab administrator password: %s\n' "$admin_password"
fi
