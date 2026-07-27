#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "$temporary_directory"' EXIT

export PATH="$temporary_directory/bin:$PATH"
export PROMOTE_TEST_STATE="$temporary_directory/tags"
export PROMOTE_TEST_LOG="$temporary_directory/commands"
mkdir -p "$temporary_directory/bin"
touch "$PROMOTE_TEST_STATE" "$PROMOTE_TEST_LOG"

cat > "$temporary_directory/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$PROMOTE_TEST_LOG"

if [[ "$*" == *"imagetools inspect"* ]]; then
  tag="$4"
  if [[ "$tag" == *":v9.9.9" ]]; then
    printf 'registry transport unavailable\n' >&2
    exit 1
  fi
  digest="$(awk -F '|' -v tag="$tag" '$1 == tag { print $2 }' "$PROMOTE_TEST_STATE")"
  if [[ -z "$digest" ]]; then
    printf 'manifest unknown: not found\n' >&2
    exit 1
  fi
  printf '{"digest":"%s"}\n' "$digest"
  exit 0
fi

if [[ "$*" == *"imagetools create"* ]]; then
  tag="$5"
  source_ref="$6"
  digest="${source_ref##*@}"
  awk -F '|' -v tag="$tag" '$1 != tag' "$PROMOTE_TEST_STATE" \
    > "${PROMOTE_TEST_STATE}.tmp"
  printf '%s|%s\n' "$tag" "$digest" >> "${PROMOTE_TEST_STATE}.tmp"
  mv "${PROMOTE_TEST_STATE}.tmp" "$PROMOTE_TEST_STATE"
  exit 0
fi

printf 'unexpected docker invocation\n' >&2
exit 1
EOF
chmod +x "$temporary_directory/bin/docker"

verified_digest="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
different_digest="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
source_ref="ghcr.io/example/muster@${verified_digest}"
sha_tag="ghcr.io/example/muster:sha-1111111111111111111111111111111111111111"
version_tag="ghcr.io/example/muster:v1.2.3"
unavailable_tag="ghcr.io/example/muster:v9.9.9"
latest_tag="ghcr.io/example/muster:latest"

"$root/scripts/promote-image-tag.sh" "$sha_tag" "$source_ref" immutable check
if grep -q 'imagetools create' "$PROMOTE_TEST_LOG"; then
  printf 'immutable preflight created a missing tag\n' >&2
  exit 1
fi
"$root/scripts/promote-image-tag.sh" "$sha_tag" "$source_ref" immutable
grep -qx "${sha_tag}|${verified_digest}" "$PROMOTE_TEST_STATE"

: > "$PROMOTE_TEST_LOG"
"$root/scripts/promote-image-tag.sh" "$sha_tag" "$source_ref" immutable
if grep -q 'imagetools create' "$PROMOTE_TEST_LOG"; then
  printf 'matching immutable tag was rewritten\n' >&2
  exit 1
fi

printf '%s|%s\n' "$version_tag" "$different_digest" >> "$PROMOTE_TEST_STATE"
if "$root/scripts/promote-image-tag.sh" \
  "$version_tag" "$source_ref" immutable >/dev/null 2>&1; then
  printf 'different immutable version tag was moved\n' >&2
  exit 1
fi
grep -qx "${version_tag}|${different_digest}" "$PROMOTE_TEST_STATE"

if "$root/scripts/promote-image-tag.sh" \
  "$unavailable_tag" "$source_ref" immutable >/dev/null 2>&1; then
  printf 'registry transport failure was treated as a missing tag\n' >&2
  exit 1
fi

printf '%s|%s\n' "$latest_tag" "$different_digest" >> "$PROMOTE_TEST_STATE"
"$root/scripts/promote-image-tag.sh" "$latest_tag" "$source_ref" movable
grep -qx "${latest_tag}|${verified_digest}" "$PROMOTE_TEST_STATE"

printf 'promote-image-tag test passed\n'
