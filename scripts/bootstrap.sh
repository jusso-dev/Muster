#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  cp .env.example .env
  auth_secret="$(openssl rand -hex 32)"
  storage_secret="$(openssl rand -hex 24)"
  admin_password="MusterDemo!$(openssl rand -hex 6)"
  sed -i.bak \
    -e "s|replace-with-at-least-32-random-bytes|${auth_secret}|" \
    -e "s|OBJECT_STORAGE_SECRET_KEY=replace-me|OBJECT_STORAGE_SECRET_KEY=${storage_secret}|" \
    -e "s|MUSTER_LOCAL_ADMIN_PASSWORD=replace-me|MUSTER_LOCAL_ADMIN_PASSWORD=${admin_password}|" \
    .env
  rm .env.bak
fi

set -a
source .env
set +a

docker compose up -d --build

for attempt in $(seq 1 60); do
  if curl --fail --silent http://localhost:3000/api/v1/health >/dev/null; then
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    docker compose ps
    exit 1
  fi
  sleep 3
done

curl --fail --silent \
  -H "content-type: application/json" \
  -d "{\"name\":\"Muster Administrator\",\"email\":\"${MUSTER_LOCAL_ADMIN_EMAIL}\",\"password\":\"${MUSTER_LOCAL_ADMIN_PASSWORD}\"}" \
  http://localhost:3000/api/auth/sign-up/email >/dev/null || true

printf '%s\n' \
  "Muster is ready." \
  "Web: http://localhost:3000" \
  "Mailpit: http://localhost:8025" \
  "MinIO console: http://localhost:9001" \
  "Administrator: ${MUSTER_LOCAL_ADMIN_EMAIL}" \
  "Password: ${MUSTER_LOCAL_ADMIN_PASSWORD}" \
  "External products are local mocks and are labelled as such."
