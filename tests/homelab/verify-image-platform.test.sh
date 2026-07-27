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
        "vnd.docker.reference.type": "attestation-manifest",
        "vnd.docker.reference.digest": "sha256:application"
      }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:sbom",
      "platform": { "os": "unknown", "architecture": "unknown" },
      "annotations": {
        "vnd.docker.reference.type": "attestation-manifest",
        "vnd.docker.reference.digest": "sha256:application"
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
      "digest": "sha256:amd64",
      "platform": { "os": "linux", "architecture": "amd64" }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:arm64",
      "platform": { "os": "linux", "architecture": "arm64" }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:attestation",
      "platform": { "os": "unknown", "architecture": "unknown" },
      "annotations": {
        "vnd.docker.reference.type": "attestation-manifest",
        "vnd.docker.reference.digest": "sha256:amd64"
      }
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
      "digest": "sha256:arm64",
      "platform": { "os": "linux", "architecture": "arm64" }
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:attestation",
      "platform": { "os": "unknown", "architecture": "unknown" },
      "annotations": {
        "vnd.docker.reference.type": "attestation-manifest",
        "vnd.docker.reference.digest": "sha256:arm64"
      }
    }
  ]
}
JSON
then
  printf 'platform verifier accepted a non-amd64 application manifest\n' >&2
  exit 1
fi

if "$verify" <<'JSON'
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
      "digest": "sha256:malicious-arm64",
      "platform": { "os": "linux", "architecture": "arm64" },
      "annotations": {
        "vnd.docker.reference.type": "attestation-manifest",
        "vnd.docker.reference.digest": "sha256:application"
      }
    }
  ]
}
JSON
then
  printf 'platform verifier trusted an arm64 attestation label\n' >&2
  exit 1
fi

if "$verify" <<'JSON'
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
      "digest": "sha256:mismatched-attestation",
      "platform": { "os": "unknown", "architecture": "unknown" },
      "annotations": {
        "vnd.docker.reference.type": "attestation-manifest",
        "vnd.docker.reference.digest": "sha256:different-application"
      }
    }
  ]
}
JSON
then
  printf 'platform verifier accepted an unrelated attestation manifest\n' >&2
  exit 1
fi

if "$verify" <<'JSON'
{
  "mediaType": "application/vnd.oci.image.index.v1+json",
  "manifests": [
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:application",
      "platform": { "os": "linux", "architecture": "amd64" }
    },
    {
      "mediaType": "application/vnd.oci.artifact.manifest.v1+json",
      "digest": "sha256:unexpected",
      "artifactType": "application/example"
    },
    {
      "mediaType": "application/vnd.oci.image.manifest.v1+json",
      "digest": "sha256:attestation",
      "platform": { "os": "unknown", "architecture": "unknown" },
      "annotations": {
        "vnd.docker.reference.type": "attestation-manifest",
        "vnd.docker.reference.digest": "sha256:application"
      }
    }
  ]
}
JSON
then
  printf 'platform verifier accepted an unexpected descriptor\n' >&2
  exit 1
fi

printf 'verify-image-platform test passed\n'
