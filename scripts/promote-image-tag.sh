#!/usr/bin/env bash
set -euo pipefail

target_tag="${1:-}"
source_ref="${2:-}"
policy="${3:-immutable}"
operation="${4:-apply}"
source_digest="${source_ref##*@}"

if [[ -z "$target_tag" || ! "$source_ref" =~ @sha256:[0-9a-f]{64}$ ]]; then
  printf 'Usage: %s <target-tag> <image@sha256:digest> [immutable|movable] [check|apply]\n' \
    "$0" >&2
  exit 2
fi
if [[ "$policy" != "immutable" && "$policy" != "movable" ]]; then
  printf 'Promotion policy must be immutable or movable.\n' >&2
  exit 2
fi
if [[ "$operation" != "check" && "$operation" != "apply" ]]; then
  printf 'Promotion operation must be check or apply.\n' >&2
  exit 2
fi

inspect_tag() {
  local tag="$1"
  local error_file
  local manifest
  error_file="$(mktemp)"
  if manifest="$(
    docker buildx imagetools inspect "$tag" \
      --format '{{json .Manifest}}' 2>"$error_file"
  )"; then
    rm "$error_file"
    jq -er '.digest' <<<"$manifest"
    return 0
  fi
  if grep -Eiq \
    'manifest unknown|MANIFEST_UNKNOWN|name unknown|not found: manifest|^ERROR: .*: not found$' \
    "$error_file"; then
    rm "$error_file"
    return 3
  fi
  rm "$error_file"
  printf 'Unable to determine current digest for %s.\n' "$tag" >&2
  return 1
}

existing_digest=""
inspect_status=0
existing_digest="$(inspect_tag "$target_tag")" || inspect_status=$?

if [[ "$inspect_status" == "0" && "$existing_digest" == "$source_digest" ]]; then
  printf '%s already points to verified digest.\n' "$target_tag"
  exit 0
fi
if [[ "$policy" == "immutable" && "$inspect_status" == "0" ]]; then
  printf 'Refusing to move immutable tag %s from %s to %s.\n' \
    "$target_tag" "$existing_digest" "$source_digest" >&2
  exit 1
fi
if [[ "$inspect_status" != "0" && "$inspect_status" != "3" ]]; then
  exit "$inspect_status"
fi
if [[ "$operation" == "check" ]]; then
  exit 0
fi

docker buildx imagetools create --tag "$target_tag" "$source_ref"

promoted_digest="$(inspect_tag "$target_tag")"
if [[ "$promoted_digest" != "$source_digest" ]]; then
  printf 'Promotion verification failed for %s.\n' "$target_tag" >&2
  exit 1
fi
