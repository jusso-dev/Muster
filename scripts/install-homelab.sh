#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

env_file=".env.homelab"
compose_file="deploy/docker/docker-compose.homelab.yml"
requested_public_url="${MUSTER_PUBLIC_URL:-http://192.168.1.19:3004}"
requested_http_port="${MUSTER_HTTP_PORT:-3004}"
requested_version="${MUSTER_VERSION:-}"
requested_image="${MUSTER_IMAGE:-}"

if [[ ! -f "$env_file" ]]; then
  cp deploy/docker/.env.homelab.example "$env_file"
  postgres_password="$(openssl rand -hex 24)"
  auth_secret="$(openssl rand -hex 32)"
  storage_secret="$(openssl rand -hex 24)"
  connector_encryption_key="$(openssl rand -hex 32)"
  admin_password="Muster!$(openssl rand -hex 12)"

  sed -i.bak \
    -e "s|MUSTER_PUBLIC_URL=.*|MUSTER_PUBLIC_URL=${requested_public_url}|" \
    -e "s|MUSTER_HTTP_PORT=.*|MUSTER_HTTP_PORT=${requested_http_port}|" \
    -e "s|AUTH_TRUSTED_ORIGINS=.*|AUTH_TRUSTED_ORIGINS=${AUTH_TRUSTED_ORIGINS:-${requested_public_url},http://homelab:${requested_http_port}}|" \
    -e "s|generate-postgres-password|${postgres_password}|" \
    -e "s|generate-better-auth-secret|${auth_secret}|" \
    -e "s|generate-object-storage-secret|${storage_secret}|" \
    -e "s|generate-connector-encryption-key|${connector_encryption_key}|" \
    "$env_file"
  rm "$env_file.bak"
  {
    printf 'MUSTER_LOCAL_ADMIN_EMAIL=%s\n' \
      "${MUSTER_LOCAL_ADMIN_EMAIL:-admin@muster.local}"
    printf 'MUSTER_LOCAL_ADMIN_PASSWORD=%s\n' "$admin_password"
  } >> "$env_file"
  chmod 600 "$env_file"
fi

if ! grep -q '^AUTH_TRUSTED_ORIGINS=' "$env_file"; then
  printf 'AUTH_TRUSTED_ORIGINS=%s,http://homelab:%s\n' \
    "$requested_public_url" "$requested_http_port" >> "$env_file"
fi

# Persist an explicitly requested reviewed image tag before sourcing the env
# file. Otherwise the template's `latest` value would silently win.
if [[ -n "$requested_version" ]]; then
  sed -i.bak \
    -e "s|^MUSTER_VERSION=.*|MUSTER_VERSION=${requested_version}|" \
    "$env_file"
  rm "$env_file.bak"
fi

if [[ -n "$requested_image" ]]; then
  sed -i.bak \
    -e "s|^MUSTER_IMAGE=.*|MUSTER_IMAGE=${requested_image}|" \
    "$env_file"
  if ! grep -q '^MUSTER_IMAGE=' "$env_file"; then
    printf 'MUSTER_IMAGE=%s\n' "$requested_image" >> "$env_file"
  fi
  rm "$env_file.bak"
fi

set -a
source "$env_file"
set +a

docker compose --env-file "$env_file" -f "$compose_file" pull
docker compose --env-file "$env_file" -f "$compose_file" up -d

health_url="http://127.0.0.1:${MUSTER_HTTP_PORT:-3004}/api/v1/health"
for attempt in $(seq 1 60); do
  if curl --fail --silent "$health_url" >/dev/null; then
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    docker compose --env-file "$env_file" -f "$compose_file" ps
    exit 1
  fi
  sleep 3
done

signup_status="$(
  curl --silent \
    --output /dev/null \
    --write-out '%{http_code}' \
    -H "content-type: application/json" \
    -d "{\"name\":\"Muster Administrator\",\"email\":\"${MUSTER_LOCAL_ADMIN_EMAIL}\",\"password\":\"${MUSTER_LOCAL_ADMIN_PASSWORD}\"}" \
    "http://127.0.0.1:${MUSTER_HTTP_PORT:-3004}/api/auth/sign-up/email"
)"
if [[ "$signup_status" != "200" && "$signup_status" != "201" && "$signup_status" != "422" ]]; then
  printf 'Administrator creation failed with HTTP %s.\n' "$signup_status" >&2
  exit 1
fi

printf '%s\n' \
  "Muster is ready." \
  "Web: ${MUSTER_PUBLIC_URL}" \
  "Administrator: ${MUSTER_LOCAL_ADMIN_EMAIL}" \
  "Password: ${MUSTER_LOCAL_ADMIN_PASSWORD}" \
  "Codex: copy an authorised auth.json into the private codex-state volume or run the setup profile." \
  "External products are local mocks and are labelled as such."
