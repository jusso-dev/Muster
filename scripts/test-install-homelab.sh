#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

mkdir -p "$fixture_root/scripts" "$fixture_root/deploy/docker" "$fixture_root/bin"
cp "$repo_root/scripts/install-homelab.sh" "$fixture_root/scripts/"
cp "$repo_root/deploy/docker/.env.homelab.example" "$fixture_root/deploy/docker/"
cp "$repo_root/deploy/docker/docker-compose.homelab.yml" "$fixture_root/deploy/docker/"

cat >"$fixture_root/bin/openssl" <<'EOF'
#!/usr/bin/env bash
length="${*: -1}"
printf '%*s\n' "$((length * 2))" '' | tr ' ' a
EOF

cat >"$fixture_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"${DOCKER_CALLS:?}"
if [[ "${1:-}" == "network" && "${2:-}" == "inspect" ]]; then
  grep -Fxq "${3:-}" "${DOCKER_NETWORKS:?}" 2>/dev/null
  exit
fi
if [[ "${1:-}" == "network" && "${2:-}" == "create" ]]; then
  printf '%s\n' "${3:-}" >>"${DOCKER_NETWORKS:?}"
fi
EOF

cat >"$fixture_root/bin/curl" <<'EOF'
#!/usr/bin/env bash
if [[ " $* " == *" --write-out "* ]]; then
  printf '200'
fi
EOF

cat >"$fixture_root/bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "$fixture_root/bin/"*
export PATH="$fixture_root/bin:$PATH"
export DOCKER_CALLS="$fixture_root/docker-calls"
export DOCKER_NETWORKS="$fixture_root/docker-networks"
touch "$DOCKER_CALLS" "$DOCKER_NETWORKS"

digest="ghcr.io/jusso-dev/muster@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
(
  cd "$fixture_root"
  MUSTER_PUBLIC_URL=http://muster.test:3004 \
    AUTH_TRUSTED_ORIGINS=http://muster.test:3004 \
    MUSTER_IMAGE="$digest" \
    ./scripts/install-homelab.sh >/dev/null
)
grep -Fxq "MUSTER_IMAGE=$digest" "$fixture_root/.env.homelab"
if grep -q '^MUSTER_VERSION=' "$fixture_root/.env.homelab"; then
  printf 'Digest install retained conflicting MUSTER_VERSION.\n' >&2
  exit 1
fi
grep -Fxq "tawny_default" "$DOCKER_NETWORKS"
grep -Fxq "kelpie_default" "$DOCKER_NETWORKS"

(
  cd "$fixture_root"
  MUSTER_VERSION=sha-bbbbbbb ./scripts/install-homelab.sh >/dev/null
)
grep -Fxq "MUSTER_VERSION=sha-bbbbbbb" "$fixture_root/.env.homelab"
if grep -q '^MUSTER_IMAGE=' "$fixture_root/.env.homelab"; then
  printf 'Tag transition retained conflicting MUSTER_IMAGE.\n' >&2
  exit 1
fi

second_digest="ghcr.io/jusso-dev/muster@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
(
  cd "$fixture_root"
  MUSTER_IMAGE="$second_digest" ./scripts/install-homelab.sh >/dev/null
)
grep -Fxq "MUSTER_IMAGE=$second_digest" "$fixture_root/.env.homelab"
if grep -q '^MUSTER_VERSION=' "$fixture_root/.env.homelab"; then
  printf 'Digest transition retained conflicting MUSTER_VERSION.\n' >&2
  exit 1
fi

printf 'Homelab installer transitions passed.\n'
