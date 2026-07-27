#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

fixture="$temporary_directory/muster"
mkdir -p "$fixture" "$temporary_directory/bin"
cp -R "$root/deploy" "$fixture/deploy"
cp -R "$root/scripts" "$fixture/scripts"

export TEST_LOG="$temporary_directory/commands.log"
export PATH="$temporary_directory/bin:$PATH"
unset MUSTER_PUBLIC_URL MUSTER_HTTP_PORT AUTH_TRUSTED_ORIGINS

cat > "$temporary_directory/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_LOG"
EOF
cat > "$temporary_directory/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_LOG"
for argument in "$@"; do
  if [[ "$argument" == "--write-out" ]]; then
    printf '201'
    exit 0
  fi
done
EOF
cat > "$temporary_directory/bin/openssl" <<'EOF'
#!/usr/bin/env bash
printf 'synthetic-%s' "$2"
EOF
chmod +x "$temporary_directory/bin/docker" \
  "$temporary_directory/bin/curl" \
  "$temporary_directory/bin/openssl"

immutable_tag="sha-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
next_immutable_tag="sha-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
override_immutable_tag="sha-cccccccccccccccccccccccccccccccccccccccc"

if (
  cd "$fixture"
  bash ./scripts/install-homelab.sh >/dev/null 2>&1
); then
  printf 'installer accepted a missing immutable tag\n' >&2
  exit 1
fi

first_output="$(
  cd "$fixture"
  MUSTER_VERSION="$immutable_tag" \
    MUSTER_PUBLIC_URL="http://192.168.1.19:3004" \
    MUSTER_HTTP_PORT=3004 \
    bash ./scripts/install-homelab.sh
)"

grep -qx "MUSTER_VERSION=${immutable_tag}" "$fixture/.env.homelab"
grep -qx 'AUTH_TRUSTED_ORIGINS=http://192.168.1.19:3004,http://homelab:3004' \
  "$fixture/.env.homelab"
grep -q -- '--env-file .env.homelab -f deploy/docker/docker-compose.homelab.yml pull' \
  "$TEST_LOG"
grep -q '/api/auth/sign-up/email' "$TEST_LOG"
grep -q 'New private homelab administrator password:' <<<"$first_output"
grep -q 'Codex authentication: pending.' <<<"$first_output"
existing_admin_password="$(
  sed -n 's/^MUSTER_LOCAL_ADMIN_PASSWORD=//p' "$fixture/.env.homelab"
)"

second_output="$(
  cd "$fixture"
  MUSTER_VERSION="$next_immutable_tag" bash ./scripts/install-homelab.sh
)"

grep -qx "MUSTER_VERSION=${next_immutable_tag}" "$fixture/.env.homelab"
grep -qx 'MUSTER_PUBLIC_URL=http://192.168.1.19:3004' "$fixture/.env.homelab"
grep -qx 'MUSTER_HTTP_PORT=3004' "$fixture/.env.homelab"
grep -qx 'AUTH_TRUSTED_ORIGINS=http://192.168.1.19:3004,http://homelab:3004' \
  "$fixture/.env.homelab"
if grep -q 'New private homelab administrator password:' <<<"$second_output"; then
  printf 'installer reprinted an existing administrator password\n' >&2
  exit 1
fi
if grep -Fq "$existing_admin_password" <<<"$second_output"; then
  printf 'installer leaked an existing administrator password\n' >&2
  exit 1
fi

sed -i.bak '/^MUSTER_LOCAL_ADMIN_EMAIL=/d' "$fixture/.env.homelab"
rm "$fixture/.env.homelab.bak"
partial_output="$(
  cd "$fixture"
  MUSTER_VERSION="$next_immutable_tag" bash ./scripts/install-homelab.sh
)"

grep -qx 'MUSTER_LOCAL_ADMIN_EMAIL=admin@muster.local' "$fixture/.env.homelab"
grep -qx "MUSTER_LOCAL_ADMIN_PASSWORD=${existing_admin_password}" \
  "$fixture/.env.homelab"
if grep -q 'New private homelab administrator password:' <<<"$partial_output" ||
  grep -Fq "$existing_admin_password" <<<"$partial_output"; then
  printf 'email repair printed an existing administrator password\n' >&2
  exit 1
fi

(
  cd "$fixture"
  MUSTER_VERSION="$override_immutable_tag" \
    MUSTER_PUBLIC_URL="http://192.168.1.20:3014" \
    MUSTER_HTTP_PORT=3014 \
    AUTH_TRUSTED_ORIGINS="http://192.168.1.20:3014,http://homelab:3014" \
    bash ./scripts/install-homelab.sh >/dev/null
)

grep -qx "MUSTER_VERSION=${override_immutable_tag}" "$fixture/.env.homelab"
grep -qx 'MUSTER_PUBLIC_URL=http://192.168.1.20:3014' "$fixture/.env.homelab"
grep -qx 'MUSTER_HTTP_PORT=3014' "$fixture/.env.homelab"
grep -qx 'AUTH_TRUSTED_ORIGINS=http://192.168.1.20:3014,http://homelab:3014' \
  "$fixture/.env.homelab"

printf 'install-homelab test passed\n'
