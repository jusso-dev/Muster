#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
verify="$root/scripts/verify-image-platform.sh"

"$verify" <<'JSON'
{
  "mediaType": "application/vnd.oci.image.index.v1+json",
  "manifests": [
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:application",
      "platform": { "os": "linux", "architecture": "amd64" }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:provenance",
      "platform": { "os": "unknown", "architecture": "unknown" },
      "annotations": {
        "vnd.docker.reference.type": "attestation-manifest"
      }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:sbom",
      "platform": { "os": "unknown", "architecture": "unknown" },
      "annotations": {
        "vnd.docker.reference.type": "attestation-manifest"
      }
    }
  ]
}
JSON

if "$verify" <<'JSON'
{
  "mediaType": "application/vnd.oci.image.index.v1+json",
  "manifests": [
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "platform": { "os": "linux", "architecture": "amd64" }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "platform": { "os": "linux", "architecture": "arm64" }
    }
  ]
}
JSON
then
  printf 'platform verifier accepted multiple application manifests\n' >&2
  exit 1
fi

if "$verify" <<'JSON'
{
  "mediaType": "application/vnd.oci.image.index.v1+json",
  "manifests": [
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "platform": { "os": "linux", "architecture": "arm64" }
    }
  ]
}
JSON
then
  printf 'platform verifier accepted a non-amd64 application manifest\n' >&2
  exit 1
fi

printf 'verify-image-platform test passed\n'
